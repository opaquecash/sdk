import type { Address } from "viem";

/**
 * Example address book shape: extend per deployment.
 *
 * Keys are `chainId` (e.g. `11155111` for Sepolia).
 */
export type ReputationAddressBook = Record<number, { OpaqueReputationVerifier: Address }>;

/**
 * Resolve verifier address or throw.
 */
export function reputationVerifierAddress(
  book: ReputationAddressBook,
  chainId: number,
): Address {
  const row = book[chainId];
  if (!row) {
    throw new Error(`No OpaqueReputationVerifier configured for chainId ${chainId}`);
  }
  return row.OpaqueReputationVerifier;
}
