import type { Hex } from "viem";

/** Public identifier used by the reputation circuit. V1 uses a u64 number; V2 uses schema_id. */
export type AttestationIdentifier = number | string;

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
  attestationId: AttestationIdentifier;
  /** One-time stealth address. */
  stealthAddress: string;
  /** Announcement transaction hash. */
  txHash: string;
  blockNumber: number;
  /** Unix ms when the trait was discovered client-side. */
  discoveredAt: number;
  /** Ephemeral pubkey from the announcement (compressed bytes). */
  ephemeralPubkey?: number[];
  /** V2 schema id, when discovered from a schema-bound attestation announcement. */
  schemaId?: string;
  /** Optional schema display name from the registry snapshot. */
  schemaName?: string | null;
  /** V2 issuer identity encoded as 32-byte hex. */
  issuer?: string;
  /** V2 attestation UID as bytes32 hex. */
  attestationUid?: string;
  /** Encoded V2 attestation payload, if available. */
  dataHex?: string;
  /** V2 leaf nonce as bytes32 hex. */
  nonce?: string;
  /** V2 leaf preimage fields needed by the prover. */
  merkleLeafPreimage?: V2MerkleLeafPreimage;
  /** Scanner-side validity and authorization checks. */
  isValid?: boolean;
  issuerAuthorized?: boolean;
}

/** V2 leaf preimage fields emitted by the Rust scanner. */
export interface V2MerkleLeafPreimage {
  stealthPkField: string;
  schemaIdField: string;
  issuerPkX: string;
  traitDataHash: string;
  nonceField: string;
}

/** Raw JSON row emitted by `scan_attestations_v2_wasm`. */
export interface V2Attestation {
  readonly stealth_address: string;
  readonly schema_id: string;
  readonly schema_name?: string | null;
  readonly issuer: string;
  readonly attestation_uid: string;
  readonly data_hex: string;
  readonly nonce: string;
  readonly merkle_leaf_preimage: {
    readonly stealth_pk_field: string;
    readonly schema_id_field: string;
    readonly issuer_pk_x: string;
    readonly trait_data_hash: string;
    readonly nonce_field: string;
  };
  readonly tx_hash: string;
  readonly slot: number;
  readonly ephemeral_pubkey: number[];
  readonly is_valid: boolean;
  readonly issuer_authorized: boolean;
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
 *
 * V2 public signals: `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`.
 */
export interface ProofData {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
  };
  publicSignals: string[];
  /** V2 `nullifier_hash` (`publicSignals[3]` = `Poseidon(stealth_pk, external_nullifier)`). */
  nullifier: string;
  attestationId: AttestationIdentifier;
}
