import type { DiscoveredTrait, ProofData } from "@opaquecash/psr-core";
import {
  DEFAULT_REPUTATION_ARTIFACT_PATHS,
  DEFAULT_REPUTATION_ARTIFACTS_ORIGIN,
} from "./defaultReputationArtifacts.js";
import type { ArtifactIntegrity } from "./integrity.js";
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
  /** Issuer's BabyJubJub x-coordinate (field element). Defaults to `trait.merkleLeafPreimage.issuerPkX`. */
  issuerPkX?: string | bigint;
  /** Poseidon hash of the attestation data payload. Defaults to `trait.merkleLeafPreimage.traitDataHash`. */
  traitDataHash?: string | bigint;
  /** Random leaf-blinding secret from issuance. Defaults to `trait.merkleLeafPreimage.nonceField`. */
  nonce?: string | bigint;
  /**
   * Circom V2 wasm + zkey paths/URLs.
   * Defaults to {@link DEFAULT_REPUTATION_ARTIFACT_PATHS} (opaque.cash, `/circuits/v2/...`).
   */
  artifacts?: ArtifactPaths;
  /**
   * Expected SHA-256 digests for the proving artifacts. Verified before snarkjs
   * runs the wasm over the secret witness (OPQ-030). Takes precedence over
   * `artifacts.integrity`. Strongly recommended when loading from a remote origin.
   */
  integrity?: ArtifactIntegrity;
  /**
   * Development-only: allow deterministic dev-mode leaf-preimage defaults when the
   * real preimage is absent. NEVER enable on a production path (OPQ-038).
   */
  devMode?: boolean;
  onProgress?: ProofProgressCallback;
}

/**
 * End-to-end V2 prove: build the Merkle witness, then Groth16 prove.
 *
 * The leaf preimage (`issuerPkX`, `traitDataHash`, `nonce`) is taken from the
 * explicit params or the trait's `merkleLeafPreimage` and is **mandatory** on the
 * production path — a missing preimage throws unless `devMode: true` is set. The
 * `nonce` is a random blinding factor and is never derived from public data (OPQ-038).
 *
 * The returned proof's public signals are
 * `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`; submit
 * `publicSignals[0]` as the Merkle root after registering it with the verifier admin.
 */
export async function generateReputationProof(
  params: GenerateReputationProofParams,
): Promise<ProofData> {
  params.onProgress?.("preparing-witness", 5);

  const preimage = params.trait.merkleLeafPreimage;
  const issuerPkX = params.issuerPkX ?? preimage?.issuerPkX;
  const traitDataHash = params.traitDataHash ?? preimage?.traitDataHash;
  const nonce = params.nonce ?? preimage?.nonceField;

  if (!params.devMode && (issuerPkX === undefined || traitDataHash === undefined || nonce === undefined)) {
    throw new Error(
      "generateReputationProof: missing attestation leaf preimage. Provide trait.merkleLeafPreimage " +
        "(discoverTraitsV2 populates it) or explicit issuerPkX/traitDataHash/nonce. Pass devMode: true " +
        "only for local development — the leaf nonce must be random, not derived from public data (OPQ-038).",
    );
  }

  const witness = await buildWitnessV2({
    attestationId: params.trait.attestationId,
    stealthPrivKeyBytes: params.stealthPrivKeyBytes,
    externalNullifier: params.externalNullifier,
    issuerPkX,
    traitDataHash,
    nonce,
    devMode: params.devMode,
  });
  params.onProgress?.("preparing-witness", 60);

  const usingDefaultOrigin = params.artifacts === undefined;
  const baseArtifacts = params.artifacts ?? DEFAULT_REPUTATION_ARTIFACT_PATHS;
  const integrity = params.integrity ?? baseArtifacts.integrity;

  if (usingDefaultOrigin && integrity === undefined) {
    console.warn(
      `[psr-prover] Proving artifacts are being fetched from the default remote origin ` +
        `(${DEFAULT_REPUTATION_ARTIFACTS_ORIGIN}) with NO integrity digest. snarkjs will run this ` +
        `wasm over your secret stealth private key, so a compromised host could exfiltrate it. ` +
        `Pin the artifacts by passing integrity: { wasmSha256, zkeySha256 }, or bundle them same-origin.`,
    );
  }

  const artifacts: ArtifactPaths = { ...baseArtifacts, integrity };
  return generateGroth16Proof(witness, artifacts, params.onProgress);
}
