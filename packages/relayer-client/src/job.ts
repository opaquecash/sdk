/**
 * Job construction and payload commitments (spec/relayer-market.md §2.3, §3). A job
 * hides its payload behind a hash; the EVM payload is `abi.encode(target, calldata)`
 * and the Solana payload is an instruction descriptor. These helpers compute the
 * commitment the user passes to `createJob` and the box plaintext the winning relayer
 * decodes.
 */

import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

/** Wormhole-convention chain ids, matching spec/UAB.md and the contracts. */
export const CHAIN_ETHEREUM = 2;
export const CHAIN_SOLANA = 1;

/** Domain tag a bid signs (spec §3.2). */
export const BID_DOMAIN = "opaque-relayer-bid-v1";

/** A market message tag. */
export type MessageTag = "advert" | "bid" | "payload";

export interface Advert {
  t: "advert";
  v: 1;
  jobId: Hex;
  chain: number;
  /** decimal string, base units (wei / lamports). */
  fee: string;
  deadline: number;
  payloadHash: Hex;
}

export interface Bid {
  t: "bid";
  v: 1;
  jobId: Hex;
  chain: number;
  operator: string;
  x25519Pk: Hex;
  sig: string;
}

export interface PayloadEnvelope {
  t: "payload";
  v: 1;
  jobId: Hex;
  to: Hex;
  /** base64 of `epk ‖ nonce ‖ ct`. */
  box: string;
}

/** An EVM job: the relayer will `target.call(calldata)` from the escrow. */
export interface EvmJobPayload {
  chain: typeof CHAIN_ETHEREUM;
  target: Address;
  calldata: Hex;
}

/** A Solana job: the relayer will CPI this instruction (no inner signers allowed). */
export interface SolanaJobPayload {
  chain: typeof CHAIN_SOLANA;
  instruction: TransactionInstruction;
}

export type JobPayload = EvmJobPayload | SolanaJobPayload;

/** The box plaintext for an EVM job: `abi.encode(address target, bytes data)`. */
export function evmPayloadBytes(p: EvmJobPayload): Uint8Array {
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [p.target, p.calldata],
  );
  return hexToBytes(encoded);
}

/** The EVM payload commitment: `keccak256(abi.encode(target, data))`. */
export function evmPayloadHash(p: EvmJobPayload): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [p.target, p.calldata]),
  );
}

/**
 * The box plaintext for a Solana job: the self-describing instruction descriptor
 * `program_id(32) ‖ u32_le(n) ‖ [pubkey(32) ‖ is_writable(1)]×n ‖ u32_le(len) ‖ data`
 * that the relayer node decodes (see solana.rs `decode_descriptor`).
 */
export function solanaPayloadBytes(p: SolanaJobPayload): Uint8Array {
  const ix = p.instruction;
  if (ix.keys.some((k) => k.isSigner)) {
    throw new Error("Opaque relayer: inner instruction accounts must not be signers (spec §2.3)");
  }
  const parts: Uint8Array[] = [ix.programId.toBytes(), u32le(ix.keys.length)];
  for (const k of ix.keys) {
    parts.push(k.pubkey.toBytes(), Uint8Array.from([k.isWritable ? 1 : 0]));
  }
  const data = Uint8Array.from(ix.data);
  parts.push(u32le(data.length), data);
  return concat(parts);
}

/** The Solana payload commitment (spec §2.3): is_signer is committed false. */
export function solanaPayloadHash(p: SolanaJobPayload): Hex {
  const ix = p.instruction;
  const parts: Uint8Array[] = [ix.programId.toBytes(), u32le(ix.keys.length)];
  for (const k of ix.keys) {
    parts.push(k.pubkey.toBytes(), Uint8Array.from([0]), Uint8Array.from([k.isWritable ? 1 : 0]));
  }
  parts.push(Uint8Array.from(ix.data));
  return keccak256(concat(parts));
}

/** Payload commitment for any job. */
export function payloadHash(p: JobPayload): Hex {
  return p.chain === CHAIN_ETHEREUM ? evmPayloadHash(p) : solanaPayloadHash(p);
}

/** Box plaintext for any job. */
export function payloadBytes(p: JobPayload): Uint8Array {
  return p.chain === CHAIN_ETHEREUM ? evmPayloadBytes(p) : solanaPayloadBytes(p);
}

/** The 32-byte message a bid signs (spec §3.2). */
export function bidSigningHash(jobId: Hex, x25519Pk: Hex): Hex {
  return keccak256(concat([
    new TextEncoder().encode(BID_DOMAIN),
    hexToBytes(jobId),
    hexToBytes(x25519Pk),
  ]));
}

// --- small byte helpers (kept local; no extra deps) ---

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): Hex {
  return `0x${Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export { PublicKey };
