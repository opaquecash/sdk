import type { ArtifactPaths } from "./prove.js";

/**
 * Host for reputation Groth16 assets (same `/circuits/v2/...` paths as the Opaque frontend).
 */
export const DEFAULT_REPUTATION_ARTIFACTS_ORIGIN = "https://www.opaque.cash";

/**
 * Default V2 wasm + zkey URLs for `generateReputationProof` when `artifacts` is omitted.
 *
 * Security: these are fetched from a **remote origin** and snarkjs executes the wasm
 * over the secret witness (the reconstructed stealth private key). Prefer bundling the
 * artifacts and serving them **same-origin**, and always pass an `integrity`
 * digest so the fetched bytes are verified before use (OPQ-030). Using the default
 * remote origin without a digest logs a warning.
 */
export const DEFAULT_REPUTATION_ARTIFACT_PATHS: ArtifactPaths = {
  wasmPath: `${DEFAULT_REPUTATION_ARTIFACTS_ORIGIN}/circuits/v2/stealth_reputation.wasm`,
  zkeyPath: `${DEFAULT_REPUTATION_ARTIFACTS_ORIGIN}/circuits/v2/stealth_reputation_final.zkey`,
};
