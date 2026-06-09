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
