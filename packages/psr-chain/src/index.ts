/**
 * `@opaquecash/psr-chain` — read Merkle roots, simulate, and submit `verifyReputation` via viem.
 *
 * Pair with `@opaquecash/psr-prover` for proof generation and `@opaquecash/psr-core` for scoping/nullifiers.
 *
 * @packageDocumentation
 */

export { opaqueReputationVerifierAbi } from "./abi.js";

export {
  fetchLatestValidRoot,
  isRootValid,
  fetchRootHistory,
} from "./roots.js";

export type { VerifyReputationArgs } from "./submit.js";
export {
  normalizeRootToBytes32,
  proofDataToSolidityTuple,
  simulateVerifyReputation,
  submitVerifyReputation,
  verifyReputationView,
  mapVerifierRevert,
} from "./submit.js";

export type { ReputationAddressBook } from "./addresses.js";
export { reputationVerifierAddress } from "./addresses.js";

// PSR V2 schema + attestation registry (the EVM counterpart to @opaquecash/psr-chain-solana).
export type { PsrV2Config } from "./registry-addresses.js";
export {
  getPsrV2Config,
  requirePsrV2Config,
  getPsrV2ChainIds,
} from "./registry-addresses.js";

export type { EvmPsrWriteClients } from "./registry.js";
export {
  adaptiveCollect,
  fetchAllSchemas,
  fetchSchema,
  fetchAllAttestations,
  fetchAttestation,
  fetchSchemasForWallet,
  fetchAttestationsIssuedBy,
  isAuthorizedIssuer,
  getCurrentBlock,
  registerSchema,
  addDelegate,
  removeDelegate,
  updateResolver,
  deprecateSchema,
  attest,
  revoke,
  announceV2Attestation,
} from "./registry.js";

export {
  SCHEMA_REGISTRY_ABI,
  ATTESTATION_ABI,
  ANNOUNCER_ABI,
  SCHEMA_REGISTERED_EVENT,
  ATTESTED_EVENT,
} from "./registry-abi.js";
