/**
 * Escrow funding: build the `createJob` transaction the user submits to lock the fee
 * against the payload commitment (spec/relayer-market.md §2.2). The user funds this
 * from an address ideally unlinked to their primary identity (§8).
 */

import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes } from "./job.js";

/** Minimal `createJob` ABI for the EVM `RelayerRegistry`. */
export const relayerRegistryCreateJobAbi = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "payable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "payloadHash", type: "bytes32" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

/** An EVM transaction request the caller signs and sends with their funding wallet. */
export interface EvmTxRequest {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Build the EVM `createJob` call (value = fee). */
export function buildEvmCreateJob(params: {
  registry: Address;
  jobId: Hex;
  payloadHash: Hex;
  deadline: number;
  fee: bigint;
}): EvmTxRequest {
  return {
    to: params.registry,
    data: encodeFunctionData({
      abi: relayerRegistryCreateJobAbi,
      functionName: "createJob",
      args: [params.jobId, params.payloadHash, BigInt(params.deadline)],
    }),
    value: params.fee,
  };
}

/** Anchor global instruction discriminator: `sha256("global:<name>")[..8]`. */
function disc(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8);
}

/** Derive the job escrow PDA: `["job", jobId]`. */
export function solanaJobPda(program: PublicKey, jobId: Hex): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("job"), hexToBytes(jobId)],
    program,
  )[0];
}

/** Build the Solana `create_job` instruction (creator signs and pays the fee). */
export function buildSolanaCreateJob(params: {
  program: PublicKey;
  creator: PublicKey;
  jobId: Hex;
  payloadHash: Hex;
  deadline: number;
  fee: bigint;
}): TransactionInstruction {
  const data = concat([
    disc("create_job"),
    hexToBytes(params.jobId),
    hexToBytes(params.payloadHash),
    i64le(BigInt(params.deadline)),
    u64le(params.fee),
  ]);
  return new TransactionInstruction({
    programId: params.program,
    keys: [
      { pubkey: solanaJobPda(params.program, params.jobId), isSigner: false, isWritable: true },
      { pubkey: params.creator, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

function i64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
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
