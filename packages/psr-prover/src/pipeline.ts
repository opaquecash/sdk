import type { DiscoveredTrait, ProofData } from "@opaquecash/psr-core";
import type { StealthWasmModule } from "@opaquecash/stealth-wasm";
import { DEFAULT_REPUTATION_ARTIFACT_PATHS } from "./defaultReputationArtifacts.js";
import type { ArtifactPaths, ProofProgressCallback } from "./prove.js";
import { generateGroth16Proof } from "./prove.js";
import {
  buildWitnessCircuitConsistent,
  buildWitnessFromWasm,
  type CircuitWitness,
} from "./witness.js";

/**
 * High-level inputs for {@link generateReputationProof}.
 */
export interface GenerateReputationProofParams {
  /** Initialized WASM module. */
  wasm: StealthWasmModule;
  /** Trait to prove (from scanner). */
  trait: DiscoveredTrait;
  /**
   * When set, witness is built via Rust `generate_reputation_witness` using this JSON string.
   * Otherwise {@link buildWitnessCircuitConsistent} is used (zero-hash tree dev mode).
   */
  attestationsJson?: string;
  /** 32-byte reconstructed one-time stealth private key for the trait output. */
  stealthPrivKeyBytes: Uint8Array;
  /** External nullifier as decimal string (see {@link externalNullifierFromScope} in `@opaquecash/psr-core`). */
  externalNullifier: string;
  /**
   * Circom wasm + zkey paths/URLs.
   * Defaults to {@link DEFAULT_REPUTATION_ARTIFACT_PATHS} (opaque.cash).
   */
  artifacts?: ArtifactPaths;
  onProgress?: ProofProgressCallback;
}

/**
 * End-to-end: build witness (WASM or circomlib placeholder tree) + Groth16 prove.
 */
export async function generateReputationProof(
  params: GenerateReputationProofParams,
): Promise<ProofData> {
  params.onProgress?.("preparing-witness", 5);
  let witness: CircuitWitness;
  if (params.attestationsJson !== undefined) {
    witness = buildWitnessFromWasm(
      params.wasm,
      params.attestationsJson,
      String(params.trait.attestationId),
      params.stealthPrivKeyBytes,
      params.externalNullifier,
    );
    params.onProgress?.("preparing-witness", 60);
  } else {
    witness = await buildWitnessCircuitConsistent(
      params.trait.attestationId,
      params.stealthPrivKeyBytes,
      params.externalNullifier,
    );
    params.onProgress?.("preparing-witness", 60);
  }
  return generateGroth16Proof(
    witness,
    params.artifacts ?? DEFAULT_REPUTATION_ARTIFACT_PATHS,
    params.onProgress,
  );
}
