/**
 * Reputation verifier (Solana) — PDA derivation, Groth16 proof encoding, root lookup, and the
 * `verify_reputation` submission. Ported from `solana/frontend/src/lib/reputationProver.ts`.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { bigIntToBytes32, encodeU64 } from "./codec.js";

/**
 * `verify_reputation` instruction discriminator as shipped by the deployed devnet program
 * (a fixed dispatch tag, not the standard `sha256("global:verify_reputation")`). Pass a custom
 * value to {@link buildVerifyReputationInstruction} if the program is redeployed with Anchor's
 * default discriminator.
 */
export const VERIFY_REPUTATION_DISCRIMINATOR = Uint8Array.from([
  0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89,
]);

const ROOT_HISTORY_SEED = "root_history";
const MERKLE_ROOT_SEED = "merkle_root";
const NULLIFIER_SEED = "nullifier";
const VERIFIER_CONFIG_SEED = "verifier_config";

export function deriveRootHistoryPda(reputationProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ROOT_HISTORY_SEED)],
    reputationProgramId,
  )[0];
}

export function deriveVerifierConfigPda(reputationProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VERIFIER_CONFIG_SEED)],
    reputationProgramId,
  )[0];
}

export function deriveMerkleRootPda(
  reputationProgramId: PublicKey,
  rootBytes: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(MERKLE_ROOT_SEED), Buffer.from(rootBytes)],
    reputationProgramId,
  )[0];
}

export function deriveNullifierPda(
  reputationProgramId: PublicKey,
  nullifierBytes: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(NULLIFIER_SEED), Buffer.from(nullifierBytes)],
    reputationProgramId,
  )[0];
}

/** snarkjs-shaped Groth16 proof (decimal-string or bigint coordinates). */
export interface Groth16ProofInput {
  pi_a: Array<string | bigint>;
  pi_b: Array<Array<string | bigint>>;
  pi_c: Array<string | bigint>;
}

/** Flatten a Groth16 proof into the verifier's 64/128/64-byte big-endian layout. */
export function encodeGroth16Proof(proof: Groth16ProofInput): {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
} {
  const a = proof.pi_a.map((v) => BigInt(v));
  const bFlat = proof.pi_b.flatMap((pair) => [BigInt(pair[1]), BigInt(pair[0])]);
  const c = proof.pi_c.map((v) => BigInt(v));

  const proofA = new Uint8Array(64);
  proofA.set(bigIntToBytes32(a[0]), 0);
  proofA.set(bigIntToBytes32(a[1]), 32);

  const proofB = new Uint8Array(128);
  for (let i = 0; i < 4; i++) proofB.set(bigIntToBytes32(bFlat[i]), i * 32);

  const proofC = new Uint8Array(64);
  proofC.set(bigIntToBytes32(c[0]), 0);
  proofC.set(bigIntToBytes32(c[1]), 32);

  return { proofA, proofB, proofC };
}

/** Read the most recent Merkle root from the on-chain `root_history` account. */
export async function fetchLatestValidMerkleRoot(
  connection: Connection,
  reputationProgramId: PublicKey,
): Promise<Uint8Array> {
  const info = await connection.getAccountInfo(deriveRootHistoryPda(reputationProgramId));
  if (!info?.data) throw new Error("No root history account found on-chain.");
  const data = Buffer.from(info.data);
  // 8 (discriminator) + 4 (vec len) + N * 32 (roots).
  const vecLen = data.readUInt32LE(8);
  if (vecLen === 0) throw new Error("No Merkle roots found on verifier program.");
  const offset = 12 + (vecLen - 1) * 32;
  return new Uint8Array(data.slice(offset, offset + 32));
}

/** Build a `verify_reputation` instruction. PDAs are derived by the caller (or {@link submitReputationProof}). */
export function buildVerifyReputationInstruction(params: {
  reputationProgramId: PublicKey;
  groth16ProgramId: PublicKey;
  configPda: PublicKey;
  rootPda: PublicKey;
  nullifierPda: PublicKey;
  payer: PublicKey;
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  rootBytes: Uint8Array;
  attestationId: number | bigint;
  externalNullifier: string | bigint;
  nullifierBytes: Uint8Array;
  discriminator?: Uint8Array;
}): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from(params.discriminator ?? VERIFY_REPUTATION_DISCRIMINATOR),
    Buffer.from(params.proofA),
    Buffer.from(params.proofB),
    Buffer.from(params.proofC),
    Buffer.from(params.rootBytes),
    encodeU64(params.attestationId),
    encodeU64(BigInt(params.externalNullifier)),
    Buffer.from(params.nullifierBytes),
  ]);
  return new TransactionInstruction({
    programId: params.reputationProgramId,
    keys: [
      { pubkey: params.configPda, isSigner: false, isWritable: false },
      { pubkey: params.rootPda, isSigner: false, isWritable: false },
      { pubkey: params.nullifierPda, isSigner: false, isWritable: true },
      { pubkey: params.groth16ProgramId, isSigner: false, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Submit a reputation proof to the verifier: derives PDAs, checks the root is registered and the
 * nullifier is unused, builds the instruction, then signs (via `signTransaction`) and sends.
 */
export async function submitReputationProof(
  connection: Connection,
  params: {
    reputationProgramId: PublicKey;
    groth16ProgramId: PublicKey;
    proof: Groth16ProofInput;
    /** Merkle root as a decimal string or bigint (field element). */
    merkleRoot: string | bigint;
    /** Circuit nullifier output as a decimal string or bigint. */
    nullifier: string | bigint;
    externalNullifier: string | bigint;
    attestationId: number | bigint;
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  },
): Promise<string> {
  const rootBytes = bigIntToBytes32(BigInt(params.merkleRoot));
  const nullifierBytes = bigIntToBytes32(BigInt(params.nullifier));

  const rootPda = deriveMerkleRootPda(params.reputationProgramId, rootBytes);
  if (!(await connection.getAccountInfo(rootPda))) {
    throw new Error("Merkle root is not registered on-chain.");
  }
  const nullifierPda = deriveNullifierPda(params.reputationProgramId, nullifierBytes);
  if (await connection.getAccountInfo(nullifierPda)) {
    throw new Error("Nullifier has already been used.");
  }
  const configPda = deriveVerifierConfigPda(params.reputationProgramId);

  const { proofA, proofB, proofC } = encodeGroth16Proof(params.proof);
  const ix = buildVerifyReputationInstruction({
    reputationProgramId: params.reputationProgramId,
    groth16ProgramId: params.groth16ProgramId,
    configPda,
    rootPda,
    nullifierPda,
    payer: params.publicKey,
    proofA,
    proofB,
    proofC,
    rootBytes,
    attestationId: params.attestationId,
    externalNullifier: params.externalNullifier,
    nullifierBytes,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = params.publicKey;
  const latest = await connection.getLatestBlockhash();
  tx.recentBlockhash = latest.blockhash;

  const signed = await params.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ signature, ...latest });
  return signature;
}
