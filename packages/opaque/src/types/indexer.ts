import type { Address, Hex } from "viem";

/**
 * Announcement row shape from a typical Graph subgraph (field names preserved).
 *
 * `etherealPublicKey` is the **ephemeral** secp256k1 public key (33-byte compressed hex),
 * as commonly returned by indexers despite the name.
 */
export interface IndexerAnnouncement {
  __typename?: string;
  id?: string;
  blockNumber: string;
  etherealPublicKey: Hex;
  logIndex: number;
  metadata: Hex;
  stealthAddress: Address;
  transactionHash: Hex;
  viewTag: number;
}

/**
 * One output the recipient owns (from WASM `scan_attestations` + normalized context).
 */
export interface OwnedStealthOutput {
  stealthAddress: Address;
  transactionHash: Hex;
  blockNumber: number;
  logIndex: number;
  viewTag: number;
  ephemeralPublicKey: Hex;
  /** Present when announcement carried PSR attestation metadata. */
  attestationId?: number;
}

/**
 * Aggregated balance for a single tracked asset across all owned stealth addresses.
 */
export interface TokenBalanceSummary {
  /** `0x0000…0000` denotes native ETH when using {@link NATIVE_TOKEN_ADDRESS}. */
  tokenAddress: Address;
  symbol: string;
  decimals: number;
  /** Sum of raw units (wei for ETH, base units for ERC-20). */
  totalRaw: bigint;
}
