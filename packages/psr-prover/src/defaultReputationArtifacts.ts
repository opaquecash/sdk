import type { ArtifactPaths } from "./prove.js";

/**
 * Host for reputation Groth16 assets (same `/circuits/...` paths as the Opaque frontend).
 */
export const DEFAULT_REPUTATION_ARTIFACTS_ORIGIN = "https://www.opaque.cash";

/**
 * Default wasm + zkey URLs for `generateReputationProof` when `artifacts` is omitted.
 */
export const DEFAULT_REPUTATION_ARTIFACT_PATHS: ArtifactPaths = {
  wasmPath: `${DEFAULT_REPUTATION_ARTIFACTS_ORIGIN}/circuits/stealth_attestation_js/stealth_attestation.wasm`,
  zkeyPath: `${DEFAULT_REPUTATION_ARTIFACTS_ORIGIN}/circuits/sa_final.zkey`,
};
