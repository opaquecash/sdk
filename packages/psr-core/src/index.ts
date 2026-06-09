/**
 * `@opaquecash/psr-core` — Programmable Stealth Reputation types and deterministic scoping.
 *
 * Safe to import in Node, edge workers, and browsers (no snarkjs / WASM required).
 *
 * @packageDocumentation
 */

export { PSR_CIRCUIT_VERSION } from "./scope.js";
export { buildActionScope, externalNullifierFromScope } from "./scope.js";

export type {
  Attestation,
  DiscoveredTrait,
  MerkleRootMeta,
  ProofData,
} from "./types.js";

export {
  PsrError,
  ProofError,
  RootExpiredError,
  NullifierUsedError,
} from "./errors.js";

export { attestationsToDiscoveredTraits } from "./traits.js";
