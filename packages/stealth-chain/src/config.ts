import type { Address } from "viem";
import type { Hex } from "@opaquecash/stealth-core";

/**
 * Merged configuration for stealth (and optional PSR) clients as described in SDK.md.
 *
 * Stealth fields are required for on-chain registry + announcer usage; PSR fields are additive.
 */
export interface OpaqueClientConfig {
  /** EVM chain id (scopes address books and PSR nullifiers). */
  chainId: number;
  /** `StealthMetaAddressRegistry` contract address. */
  registryAddress: Address;
  /** `StealthAddressAnnouncer` contract address. */
  announcerAddress: Address;
  /** EIP-5564 scheme id (typically `1` for secp256k1). */
  schemeId: bigint;
  /**
   * URL or path to wasm-pack `cryptography.js` (passed to `@opaquecash/stealth-wasm`).
   */
  stealthWasmUrl?: string;
  /** Optional HTTP RPC URL when you construct viem clients yourself. */
  rpcUrl?: string;
  /** PSR: `OpaqueReputationVerifier` address. */
  verifierAddress?: Address;
  /** PSR: Circom wasm artifact URL. */
  circuitWasmUrl?: string;
  /** PSR: Groth16 zkey URL. */
  zkeyUrl?: string;
  /** PSR: how Merkle roots are sourced (`onchain` vs indexer URL). */
  rootSource?: "onchain" | "indexer";
  /** PSR: indexer base URL when `rootSource === 'indexer'`. */
  indexerUrl?: string;
  /** Optional ERC-20 list for balance helpers. */
  tokens?: Array<{ address: Address; symbol: string; decimals: number }>;
}

/**
 * Per-chain deployed addresses for Opaque contracts (extend in your app).
 *
 * @example
 * ```ts
 * export const stealthAddresses: StealthChainAddresses = {
 *   11155111: {
 *     registry: "0x...",
 *     announcer: "0x...",
 *   },
 * };
 * ```
 */
export type StealthChainAddresses = Record<
  number,
  { registry: Address; announcer: Address; reputationVerifier?: Address }
>;

/**
 * Resolve registry + announcer addresses for a chain, or throw if unknown.
 *
 * @param book - Your address book keyed by `chainId`.
 * @param chainId - Active chain.
 */
export function requireStealthAddresses(
  book: StealthChainAddresses,
  chainId: number,
): { registry: Address; announcer: Address } {
  const row = book[chainId];
  if (!row) {
    throw new Error(`No stealth addresses configured for chainId ${chainId}`);
  }
  return { registry: row.registry, announcer: row.announcer };
}

/** Encode 66-byte meta-address bytes as `0x` hex for `registerKeys` calldata. */
export function metaAddressBytesToHex(bytes: Uint8Array): Hex {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s as Hex;
}
