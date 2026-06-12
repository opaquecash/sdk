/**
 * Withdrawal witness assembly + Groth16 proof generation (spec/privacy-pool.md §4.1).
 * The witness binds the spent commitment's openings, both Merkle inclusion paths, the
 * value accounting, and the contract-supplied `context`. Public-signal order matches
 * the circuit: withdrawn_value, state_root, asp_root, nullifier_hash, new_commitment,
 * context.
 */

// @ts-expect-error snarkjs is untyped
import * as snarkjs from "snarkjs";
import { PoolMerkleTree, POOL_LEVELS, type PoolCrypto } from "./crypto.js";

/** Paths/URLs to the withdrawal circuit artifacts (Node: file paths; browser: static URLs). */
export interface PoolArtifacts {
  wasmPath: string;
  zkeyPath: string;
}

/** The opening of a spendable commitment the user holds. */
export interface CommitmentNote {
  value: bigint;
  label: bigint;
  nullifier: bigint;
  secret: bigint;
}

export interface BuildWithdrawalWitnessParams {
  note: CommitmentNote;
  /** Amount to pay out (≤ note.value). */
  withdrawnValue: bigint;
  /** Fresh openings for the remainder commitment. */
  newNullifier: bigint;
  newSecret: bigint;
  /** Ordered state-tree leaves (all commitments) and the note's leaf index. */
  stateLeaves: bigint[];
  stateIndex: number;
  /** Ordered association-tree leaves (approved labels) and the note's label index. */
  aspLeaves: bigint[];
  aspIndex: number;
  /** The pool's `context(params)` value for this withdrawal (read from the contract). */
  context: bigint;
}

export interface WithdrawalWitness {
  input: Record<string, string | string[]>;
  /** Public values the caller passes to `withdraw` alongside the proof. */
  publics: {
    withdrawnValue: bigint;
    stateRoot: bigint;
    aspRoot: bigint;
    nullifierHash: bigint;
    newCommitment: bigint;
    context: bigint;
  };
}

/** Assemble the circuit input + the public values for an on-chain `withdraw` call. */
export function buildWithdrawalWitness(
  crypto: PoolCrypto,
  p: BuildWithdrawalWitnessParams,
): WithdrawalWitness {
  if (p.withdrawnValue > p.note.value) {
    throw new Error("Opaque pool: withdrawnValue exceeds the note value");
  }
  const stateTree = new PoolMerkleTree(crypto, p.stateLeaves);
  const aspTree = new PoolMerkleTree(crypto, p.aspLeaves);
  const statePath = stateTree.proof(p.stateIndex);
  const aspPath = aspTree.proof(p.aspIndex);

  const remainder = p.note.value - p.withdrawnValue;
  const newCommitment = crypto.commitment(
    remainder,
    p.note.label,
    crypto.precommitment(p.newNullifier, p.newSecret),
  );
  const nullifierHash = crypto.nullifierHash(p.note.nullifier);
  const stateRoot = stateTree.root();
  const aspRoot = aspTree.root();

  const input: Record<string, string | string[]> = {
    value: p.note.value.toString(),
    label: p.note.label.toString(),
    nullifier: p.note.nullifier.toString(),
    secret: p.note.secret.toString(),
    new_nullifier: p.newNullifier.toString(),
    new_secret: p.newSecret.toString(),
    state_siblings: statePath.siblings.map(String),
    state_index: statePath.pathIndices.map(String),
    asp_siblings: aspPath.siblings.map(String),
    asp_index: aspPath.pathIndices.map(String),
    withdrawn_value: p.withdrawnValue.toString(),
    state_root: stateRoot.toString(),
    asp_root: aspRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    new_commitment: newCommitment.toString(),
    context: p.context.toString(),
  };

  return {
    input,
    publics: {
      withdrawnValue: p.withdrawnValue,
      stateRoot,
      aspRoot,
      nullifierHash,
      newCommitment,
      context: p.context,
    },
  };
}

/** Groth16 proof formatted for the Solidity verifier's `verifyProof` argument order. */
export interface SolidityProof {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
}

/** Generate a withdrawal proof and format it for the on-chain verifier. */
export async function generateWithdrawalProof(
  witness: WithdrawalWitness,
  artifacts: PoolArtifacts,
): Promise<{ proof: SolidityProof; publicSignals: string[] }> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness.input,
    artifacts.wasmPath,
    artifacts.zkeyPath,
  );
  return { proof: toSolidityProof(proof), publicSignals };
}

/** Convert a snarkjs proof object to the verifier's (a, b, c) calldata shape. */
export function toSolidityProof(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): SolidityProof {
  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    // G2 point coordinates are swapped for the EVM pairing precompile.
    b: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  };
}

export { POOL_LEVELS };
