import type { Hex } from "viem";

/**
 * Issuer attestation embedded in announcement metadata and discovered by the WASM scanner.
 */
export interface Attestation {
  /** Stealth address the trait is bound to (hex). */
  readonly stealth_address: string;
  /** Numeric attestation / trait id from issuer policy. */
  readonly attestation_id: number;
  /** Source transaction hash. */
  readonly tx_hash: string;
  /** Block number containing the announcement. */
  readonly block_number: number;
  /** Compressed ephemeral secp256k1 pubkey bytes. */
  readonly ephemeral_pubkey: number[];
}

/**
 * Trait discovered for the connected recipient (app-level view over {@link Attestation}).
 */
export interface DiscoveredTrait {
  /** Numeric attestation id (matches circuit public input). */
  attestationId: number;
  /** One-time stealth address. */
  stealthAddress: string;
  /** Announcement transaction hash. */
  txHash: string;
  blockNumber: number;
  /** Unix ms when the trait was discovered client-side. */
  discoveredAt: number;
  /** Ephemeral pubkey from the announcement (compressed bytes). */
  ephemeralPubkey?: number[];
}

/**
 * Metadata about an on-chain Merkle root (for indexers or `OpaqueReputationVerifier` history).
 */
export interface MerkleRootMeta {
  /** 32-byte root as hex. */
  root: Hex;
  /** Block or timestamp context from your indexer / contract. */
  blockNumber?: bigint;
  submittedAt?: bigint;
  /** Whether the verifier considers the root valid right now. */
  valid?: boolean;
}

/**
 * Groth16 proof bundle compatible with {@link submitVerifyReputation} in `@opaquecash/psr-chain`.
 */
export interface ProofData {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
  };
  publicSignals: string[];
  nullifier: string;
  attestationId: number;
}
