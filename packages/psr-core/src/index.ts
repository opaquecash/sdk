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
  AttestationIdentifier,
  DiscoveredTrait,
  MerkleRootMeta,
  ProofData,
  V2Attestation,
  V2MerkleLeafPreimage,
} from "./types.js";

export {
  PsrError,
  ProofError,
  RootExpiredError,
  NullifierUsedError,
} from "./errors.js";

export {
  attestationsToDiscoveredTraits,
  v2AttestationsToDiscoveredTraits,
} from "./traits.js";

// PSR V2 schema + attestation codecs (chain-neutral).
export {
  type FieldType,
  type FieldDef,
  type SchemaV2,
  SCHEMA_VERSION,
  ZERO_ADDRESS,
  parseFieldDefs,
  fieldDefsToString,
  computeSchemaId,
  packSchemaIdToField,
} from "./schema.js";
export {
  type AttestationField,
  type AttestationV2,
  ZERO_BYTES32,
  computeUid,
  encodeAttestationData,
  decodeAttestationData,
  encodeV2AttestationMetadata,
  randomNonce,
  isZeroUid,
} from "./attestation.js";
