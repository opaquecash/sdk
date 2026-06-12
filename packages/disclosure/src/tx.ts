/**
 * Disclosure transaction builders — spec/conditional-disclosure.md §6.
 * Ethereum: calldata for OpaqueDisclosureRegistry. Solana: raw instructions for the
 * conditional-disclosure program (no IDL dependency; matches the program's borsh
 * layout exactly).
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { toSolidityProof, type SolidityProof } from "@opaquecash/privacy-pool";
import { createHash } from "node:crypto";
import type { QuorumSignature } from "./schnorr.js";

export const opaqueDisclosureRegistryAbi = [
  {
    type: "function",
    name: "registerPolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "groupKeyX", type: "uint256" },
      { name: "threshold", type: "uint128" },
      { name: "m", type: "uint8" },
      { name: "n", type: "uint8" },
    ],
    outputs: [{ name: "policyId", type: "uint256" }],
  },
  {
    type: "function",
    name: "disclose",
    stateMutability: "nonpayable",
    inputs: [
      { name: "a", type: "uint256[2]" },
      { name: "b", type: "uint256[2][2]" },
      { name: "c", type: "uint256[2]" },
      { name: "signals", type: "uint256[6]" },
      { name: "policyId", type: "uint256" },
      { name: "caseId", type: "bytes32" },
      {
        name: "sig",
        type: "tuple",
        components: [
          { name: "rx", type: "uint256" },
          { name: "ry", type: "uint256" },
          { name: "s", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "context",
    stateMutability: "pure",
    inputs: [
      { name: "policyId", type: "uint256" },
      { name: "caseId", type: "bytes32" },
      { name: "requester", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "policies",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "pool", type: "address" },
      { name: "groupKeyX", type: "uint256" },
      { name: "threshold", type: "uint128" },
      { name: "m", type: "uint8" },
      { name: "n", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "nullifierConsumed",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "Disclosure",
    inputs: [
      { name: "policyId", type: "uint256", indexed: true },
      { name: "caseId", type: "bytes32", indexed: true },
      { name: "requester", type: "address", indexed: true },
      { name: "label", type: "uint256", indexed: false },
      { name: "value", type: "uint256", indexed: false },
      { name: "disclosureNullifier", type: "bytes32", indexed: false },
    ],
  },
] as const;

export interface EvmTxRequest {
  to: Address;
  data: Hex;
}

export function buildRegisterPolicyTx(
  registry: Address,
  p: { pool: Address; groupKeyX: bigint; threshold: bigint; m: number; n: number },
): EvmTxRequest {
  return {
    to: registry,
    data: encodeFunctionData({
      abi: opaqueDisclosureRegistryAbi,
      functionName: "registerPolicy",
      args: [p.pool, p.groupKeyX, p.threshold, p.m, p.n],
    }),
  };
}

export function buildDiscloseTx(
  registry: Address,
  p: {
    proof: SolidityProof;
    signals: [bigint, bigint, bigint, bigint, bigint, bigint];
    policyId: bigint;
    caseId: Hex;
    sig: QuorumSignature;
  },
): EvmTxRequest {
  return {
    to: registry,
    data: encodeFunctionData({
      abi: opaqueDisclosureRegistryAbi,
      functionName: "disclose",
      args: [
        p.proof.a,
        p.proof.b,
        p.proof.c,
        p.signals,
        p.policyId,
        p.caseId,
        { rx: p.sig.rx, ry: p.sig.ry, s: p.sig.s },
      ],
    }),
  };
}

// ----------------------------------------------------------------- Solana

const disc = (name: string): Buffer =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const be32 = (x: bigint) => Buffer.from(x.toString(16).padStart(64, "0"), "hex");
const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export function policyPda(program: PublicKey, groupKeyX: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), be32(groupKeyX)],
    program,
  )[0];
}

export function disclosureNullifierPda(program: PublicKey, nullifier: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), be32(nullifier)],
    program,
  )[0];
}

export function buildRegisterPolicyIx(
  program: PublicKey,
  p: { pool: PublicKey; groupKeyX: bigint; threshold: bigint; m: number; n: number; payer: PublicKey },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: policyPda(program, p.groupKeyX), isSigner: false, isWritable: true },
      { pubkey: p.pool, isSigner: false, isWritable: false },
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc("register_policy"),
      be32(p.groupKeyX),
      u64le(p.threshold),
      Buffer.from([p.m, p.n]),
    ]),
  });
}

/** Groth16 proof in the program's byte encoding (negated-A handled on-chain). */
export interface SolanaProofBytes {
  a: Uint8Array; // 64
  b: Uint8Array; // 128
  c: Uint8Array; // 64
}

/** snarkjs proof object → the program's G1/G2 byte encoding. */
export function toSolanaProof(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): SolanaProofBytes {
  const g1 = (p: string[]) => Buffer.concat([be32(BigInt(p[0])), be32(BigInt(p[1]))]);
  const g2 = (p: string[][]) =>
    Buffer.concat([
      be32(BigInt(p[0][1])),
      be32(BigInt(p[0][0])),
      be32(BigInt(p[1][1])),
      be32(BigInt(p[1][0])),
    ]);
  return { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) };
}

export function buildDiscloseIx(
  program: PublicKey,
  p: {
    pool: PublicKey;
    groupKeyX: bigint;
    proof: SolanaProofBytes;
    value: bigint;
    label: bigint;
    stateRoot: bigint;
    disclosureNullifier: bigint;
    caseId: Uint8Array; // 32 bytes
    sig: QuorumSignature;
    requester: PublicKey;
  },
): TransactionInstruction {
  if (p.caseId.length !== 32) throw new Error("caseId must be 32 bytes");
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: policyPda(program, p.groupKeyX), isSigner: false, isWritable: false },
      { pubkey: p.pool, isSigner: false, isWritable: false },
      {
        pubkey: disclosureNullifierPda(program, p.disclosureNullifier),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: p.requester, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc("disclose"),
      p.proof.a,
      p.proof.b,
      p.proof.c,
      u64le(p.value),
      be32(p.label),
      be32(p.stateRoot),
      be32(p.disclosureNullifier),
      p.caseId,
      be32(p.sig.rx),
      be32(p.sig.ry),
      be32(p.sig.s),
    ]),
  });
}

export { toSolidityProof, type SolidityProof };
