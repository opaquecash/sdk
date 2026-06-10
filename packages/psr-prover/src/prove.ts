import type { ProofData } from "@opaquecash/psr-core";
import { ProofError } from "@opaquecash/psr-core";
import type { CircuitWitness } from "./witness.js";

// snarkjs ships without TypeScript types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SnarkGroth16 = { fullProve: (...args: any[]) => Promise<any>; verify: (...args: any[]) => Promise<boolean> };

/**
 * Paths or URLs to Circom wasm + final zkey (Groth16).
 */
export interface ArtifactPaths {
  /** Path/URL to `stealth_reputation.wasm` (V2). */
  wasmPath: string;
  /** Path/URL to final `.zkey`. */
  zkeyPath: string;
}

/**
 * Progress callback for long-running prove steps.
 */
export type ProofProgressCallback = (stage: string, percent: number) => void;

/**
 * Run `snarkjs.groth16.fullProve` on a prepared V2 witness.
 *
 * V2 public signals: `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`.
 * The returned {@link ProofData}'s `nullifier` field carries `nullifier_hash`
 * (`publicSignals[3]`) — the value the on-chain verifiers consume.
 *
 * @param witness - JSON object accepted by the V2 Circom wasm.
 * @param artifacts - Wasm + zkey locations (browser: serve static files; Node: file paths).
 * @param onProgress - Optional UI hook.
 */
export async function generateGroth16Proof(
  witness: CircuitWitness,
  artifacts: ArtifactPaths,
  onProgress?: ProofProgressCallback,
): Promise<ProofData> {
  onProgress?.("generating-proof", 10);
  const snarkjs = (await import("snarkjs")).groth16 as SnarkGroth16;
  const { proof, publicSignals } = await snarkjs.fullProve(
    witness,
    artifacts.wasmPath,
    artifacts.zkeyPath,
  );
  onProgress?.("generating-proof", 90);

  if (publicSignals.length !== 4) {
    throw new ProofError(
      `Expected 4 V2 public signals, got ${publicSignals.length} — the configured artifacts appear to be the retired V1 circuit.`,
    );
  }

  const nullifierHash = publicSignals[3];
  const attestationIdFromProof = Number(publicSignals[1]);

  return {
    proof: {
      pi_a: proof.pi_a.slice(0, 2),
      pi_b: proof.pi_b.slice(0, 2),
      pi_c: proof.pi_c.slice(0, 2),
    },
    publicSignals,
    nullifier: nullifierHash,
    attestationId: Number.isFinite(attestationIdFromProof)
      ? attestationIdFromProof
      : Number(witness.attestation_id),
  };
}

/**
 * Verify a proof locally with snarkjs (development / diagnostics).
 *
 * @param proofData - Output of {@link generateGroth16Proof}.
 * @param vkeyPath - Path/URL to verification key JSON from the trusted setup.
 */
export async function verifyProofLocally(
  proofData: ProofData,
  vkeyPath: string,
): Promise<boolean> {
  const snarkjs = (await import("snarkjs")).groth16 as SnarkGroth16;
  return snarkjs.verify(vkeyPath, proofData.publicSignals, {
    pi_a: proofData.proof.pi_a,
    pi_b: proofData.proof.pi_b,
    pi_c: proofData.proof.pi_c,
  });
}
