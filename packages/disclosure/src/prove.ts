/**
 * Disclosure witness assembly + Groth16 proof generation
 * (spec/conditional-disclosure.md §4). The witness binds a pool note's openings,
 * its state-tree inclusion path, the policy threshold, and the request `context`.
 * Public-signal order matches the circuit:
 * value, label, threshold, state_root, disclosure_nullifier, context.
 */

// @ts-expect-error snarkjs is untyped
import * as snarkjs from "snarkjs";
import {
  PoolMerkleTree,
  POOL_LEVELS,
  type PoolCrypto,
  type CommitmentNote,
} from "@opaquecash/privacy-pool";
import { DOMAIN_DISCLOSURE } from "./context.js";

/** Paths/URLs to the conditional_disclosure circuit artifacts. */
export interface DisclosureArtifacts {
  wasmPath: string;
  zkeyPath: string;
}

export interface BuildDisclosureWitnessParams {
  /** The note being disclosed (its openings stay private). */
  note: CommitmentNote;
  /** The policy's qualification threshold; note.value must exceed it. */
  threshold: bigint;
  /** Ordered state-tree leaves (all commitments) and the note's leaf index. */
  stateLeaves: bigint[];
  stateIndex: number;
  /** The request context (computeContextEvm / computeContextSolana). */
  context: bigint;
}

export interface DisclosureWitness {
  input: Record<string, string | string[] | number[]>;
  /** Public values submitted to `disclose` alongside the proof. */
  publics: {
    value: bigint;
    label: bigint;
    threshold: bigint;
    stateRoot: bigint;
    disclosureNullifier: bigint;
    context: bigint;
  };
}

/** disclosure_nullifier = Poseidon(nullifier, context, DOMAIN_DISCLOSURE) (spec §7). */
export function disclosureNullifier(
  crypto: PoolCrypto,
  nullifier: bigint,
  context: bigint,
): bigint {
  return crypto.hash([nullifier, context, DOMAIN_DISCLOSURE]);
}

/** Assemble the circuit input + public values for an on-chain `disclose` call. */
export function buildDisclosureWitness(
  crypto: PoolCrypto,
  p: BuildDisclosureWitnessParams,
): DisclosureWitness {
  if (p.note.value <= p.threshold) {
    throw new Error(
      `note does not qualify: value ${p.note.value} <= threshold ${p.threshold} ` +
        "(the circuit would be unsatisfiable)",
    );
  }
  const commitment = crypto.commitment(
    p.note.value,
    p.note.label,
    crypto.precommitment(p.note.nullifier, p.note.secret),
  );
  if (p.stateLeaves[p.stateIndex] !== commitment) {
    throw new Error("stateLeaves[stateIndex] is not the note's commitment");
  }
  const tree = new PoolMerkleTree(crypto, p.stateLeaves);
  const path = tree.proof(p.stateIndex);
  const nullifier = disclosureNullifier(crypto, p.note.nullifier, p.context);

  return {
    input: {
      nullifier: p.note.nullifier.toString(),
      secret: p.note.secret.toString(),
      state_siblings: path.siblings.map(String),
      state_index: path.pathIndices,
      value: p.note.value.toString(),
      label: p.note.label.toString(),
      threshold: p.threshold.toString(),
      state_root: tree.root().toString(),
      disclosure_nullifier: nullifier.toString(),
      context: p.context.toString(),
    },
    publics: {
      value: p.note.value,
      label: p.note.label,
      threshold: p.threshold,
      stateRoot: tree.root(),
      disclosureNullifier: nullifier,
      context: p.context,
    },
  };
}

export interface DisclosureProof {
  proof: unknown;
  publicSignals: string[];
}

/** Generate the Groth16 proof (snarkjs; Node paths or browser URLs). */
export async function generateDisclosureProof(
  witness: DisclosureWitness,
  artifacts: DisclosureArtifacts,
): Promise<DisclosureProof> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness.input,
    artifacts.wasmPath,
    artifacts.zkeyPath,
  );
  return { proof, publicSignals };
}

export { POOL_LEVELS };
