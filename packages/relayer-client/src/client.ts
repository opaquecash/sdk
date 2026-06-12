/**
 * `submitGasPrivate` and the building blocks behind it (spec/relayer-market.md). The
 * flow: commit the payload, fund the escrow, advertise, collect + verify bids, pick a
 * stake-weighted winner, and deliver the payload sealed to the winner's key. The
 * relayer then accepts and submits on-chain; gas and submitter identity are theirs,
 * not the user's.
 */

import { randomBytes } from "@noble/hashes/utils";
import { PublicKey } from "@solana/web3.js";
import type { Address, Hex } from "viem";

import { sealBox } from "./crypto.js";
import {
  bytesToHex,
  hexToBytes,
  payloadBytes,
  payloadHash,
  type Advert,
  type Bid,
  type JobPayload,
  type PayloadEnvelope,
} from "./job.js";
import {
  buildEvmCreateJob,
  buildSolanaCreateJob,
  type EvmTxRequest,
} from "./escrow.js";
import {
  collectBids,
  postAdvert,
  postPayload,
  type GatewayOptions,
} from "./gateway.js";
import {
  selectWinner,
  verifyBids,
  type RegistryReaders,
  type VerifiedBid,
} from "./select.js";
import type { TransactionInstruction } from "@solana/web3.js";

export interface PreparedJob {
  jobId: Hex;
  payloadHash: Hex;
  deadline: number;
  fee: bigint;
  advert: Advert;
  /** Funding artifact for the user's wallet (one of these, by chain). */
  evmCreateJob?: EvmTxRequest;
  solanaCreateJob?: TransactionInstruction;
}

/** Options shared by the prepare + submit flow. */
export interface PrepareOptions {
  fee: bigint;
  /** Absolute unix-seconds deadline; relayers must submit before it. */
  deadline: number;
  /** EVM `RelayerRegistry` address, or Solana `relayer-registry` program id. */
  registry: string;
  /** Solana only: the funding (creator) pubkey for the create_job instruction. */
  creator?: PublicKey;
  /** 32-byte job id; random if omitted. */
  jobId?: Hex;
  randomBytes?: (n: number) => Uint8Array;
}

/** Commit the payload and produce the advert + escrow funding artifact. */
export function prepareJob(payload: JobPayload, opts: PrepareOptions): PreparedJob {
  const rand = opts.randomBytes ?? randomBytes;
  const jobId = opts.jobId ?? bytesToHex(rand(32));
  const hash = payloadHash(payload);
  const advert: Advert = {
    t: "advert",
    v: 1,
    jobId,
    chain: payload.chain,
    fee: opts.fee.toString(),
    deadline: opts.deadline,
    payloadHash: hash,
  };
  const prepared: PreparedJob = {
    jobId,
    payloadHash: hash,
    deadline: opts.deadline,
    fee: opts.fee,
    advert,
  };
  if (payload.chain === 2) {
    prepared.evmCreateJob = buildEvmCreateJob({
      registry: opts.registry as Address,
      jobId,
      payloadHash: hash,
      deadline: opts.deadline,
      fee: opts.fee,
    });
  } else {
    if (!opts.creator) throw new Error("Opaque relayer: Solana jobs need opts.creator");
    prepared.solanaCreateJob = buildSolanaCreateJob({
      program: new PublicKey(opts.registry),
      creator: opts.creator,
      jobId,
      payloadHash: hash,
      deadline: opts.deadline,
      fee: opts.fee,
    });
  }
  return prepared;
}

/** Seal the payload to the winner's advertised x25519 key into a delivery envelope. */
export function buildPayloadEnvelope(
  winner: Bid,
  payload: JobPayload,
  rand: (n: number) => Uint8Array = randomBytes,
): PayloadEnvelope {
  const recipient = hexToBytes(winner.x25519Pk);
  const sealed = sealBox(recipient, payloadBytes(payload), rand);
  return {
    t: "payload",
    v: 1,
    jobId: winner.jobId,
    to: winner.x25519Pk,
    box: bytesToHexBase64(sealed),
  };
}

/** End-to-end orchestration over an injected funding step and registry readers. */
export interface SubmitGasPrivateOptions extends PrepareOptions {
  payload: JobPayload;
  gateway: GatewayOptions;
  readers: RegistryReaders;
  /** Submit + confirm the escrow funding tx (the user's wallet). */
  fundEscrow: (job: PreparedJob) => Promise<void>;
  /** Per-chain bid signature verifier (default EVM). */
  verifySig?: (bid: Bid) => Promise<boolean>;
  minBids?: number;
  timeoutMs?: number;
  random?: () => number;
}

export interface SubmitGasPrivateResult {
  jobId: Hex;
  payloadHash: Hex;
  winner: VerifiedBid;
}

/**
 * Run the whole flow. Throws if the escrow is not funded, no valid bid arrives, or
 * the gateway is unreachable. On success the winning relayer will accept + submit;
 * watch the escrow's `JobSubmitted` event (or poll `jobs(jobId).submitted`) to confirm.
 */
export async function submitGasPrivate(
  opts: SubmitGasPrivateOptions,
): Promise<SubmitGasPrivateResult> {
  const prepared = prepareJob(opts.payload, opts);
  await opts.fundEscrow(prepared);
  await postAdvert(opts.gateway, prepared.advert);

  const bids = await collectBids(opts.gateway, prepared.jobId, {
    minBids: opts.minBids ?? 1,
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
  const verified = await verifyBids(bids, opts.fee, opts.readers, opts.verifySig);
  const winner = selectWinner(verified, opts.random);
  if (!winner) {
    throw new Error(
      `Opaque relayer: no valid bid for job ${prepared.jobId} (${bids.length} raw bid(s))`,
    );
  }

  const envelope = buildPayloadEnvelope(winner.bid, opts.payload, opts.randomBytes);
  await postPayload(opts.gateway, envelope);
  return { jobId: prepared.jobId, payloadHash: prepared.payloadHash, winner };
}

function bytesToHexBase64(b: Uint8Array): string {
  // base64 without a Buffer dependency (works in browser + node).
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  // eslint-disable-next-line no-undef
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(b).toString("base64");
}
