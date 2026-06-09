/**
 * `@opaquecash/psr-prover` — witness construction and Groth16 proving for the stealth attestation circuit.
 *
 * Depends on `snarkjs` and `circomlibjs`; browser apps should polyfill `Buffer` (see {@link ensureBufferPolyfill}).
 *
 * @packageDocumentation
 */

export type { CircuitWitness } from "./witness.js";
export {
  buildWitnessCircuitConsistent,
  buildWitnessFromWasm,
  ensureBufferPolyfill,
} from "./witness.js";

export type { ArtifactPaths, ProofProgressCallback } from "./prove.js";
export {
  generateGroth16Proof,
  verifyProofLocally,
} from "./prove.js";

export {
  DEFAULT_REPUTATION_ARTIFACT_PATHS,
  DEFAULT_REPUTATION_ARTIFACTS_ORIGIN,
} from "./defaultReputationArtifacts.js";

export type { GenerateReputationProofParams } from "./pipeline.js";
export { generateReputationProof } from "./pipeline.js";
