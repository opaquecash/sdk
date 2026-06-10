import type { DiscoveredTrait, ProofData } from "@opaquecash/psr-core";
import { DEFAULT_REPUTATION_ARTIFACT_PATHS } from "./defaultReputationArtifacts.js";
import type { ArtifactPaths, ProofProgressCallback } from "./prove.js";
import { generateGroth16Proof } from "./prove.js";
import { buildWitnessV2 } from "./witness.js";

/**
 * High-level inputs for {@link generateReputationProof}.
 */
export interface GenerateReputationProofParams {
  /** Trait to prove (from scanner). */
  trait: DiscoveredTrait;
  /** 32-byte reconstructed one-time stealth private key for the trait output. */
  stealthPrivKeyBytes: Uint8Array;
  /** External nullifier as decimal string (see `externalNullifierFromScope` in `@opaquecash/psr-core`). */
  externalNullifier: string;
  /** Issuer's BabyJubJub x-coordinate (field element). Omit for the deterministic dev-mode value. */
  issuerPkX?: string | bigint;
  /** Poseidon hash of the attestation data payload. Omit for the deterministic dev-mode value. */
  traitDataHash?: string | bigint;
  /** Leaf-blinding secret from issuance. Omit for the deterministic dev-mode value. */
  nonce?: string | bigint;
  /**
   * Circom V2 wasm + zkey paths/URLs.
   * Defaults to {@link DEFAULT_REPUTATION_ARTIFACT_PATHS} (opaque.cash, `/circuits/v2/...`).
   */
  artifacts?: ArtifactPaths;
  onProgress?: ProofProgressCallback;
}

/**
 * End-to-end V2 prove: build the dev-mode zero-hash-tree witness, then Groth16 prove.
 *
 * The returned proof's public signals are
 * `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`; submit
 * `publicSignals[0]` as the Merkle root after registering it with the verifier admin.
 */
export async function generateReputationProof(
  params: GenerateReputationProofParams,
): Promise<ProofData> {
  params.onProgress?.("preparing-witness", 5);
  const witness = await buildWitnessV2({
    attestationId: params.trait.attestationId,
    stealthPrivKeyBytes: params.stealthPrivKeyBytes,
    externalNullifier: params.externalNullifier,
    issuerPkX: params.issuerPkX,
    traitDataHash: params.traitDataHash,
    nonce: params.nonce,
  });
  params.onProgress?.("preparing-witness", 60);
  return generateGroth16Proof(
    witness,
    params.artifacts ?? DEFAULT_REPUTATION_ARTIFACT_PATHS,
    params.onProgress,
  );
}
