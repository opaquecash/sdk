/**
 * Shared TypeScript types for the stealth protocol (no chain or WASM).
 *
 * @packageDocumentation
 */

/** `0x`-prefixed hex string (Ethereum / ABI encoding). */
export type Hex = `0x${string}`;

/** Ethereum address as checksummed or lower-case hex. */
export type Address = Hex;

/**
 * Decoded {@link https://eips.ethereum.org/EIPS/eip-5564 | EIP-5564} stealth meta-address:
 * `V || S` as compressed secp256k1 points (66 bytes).
 */
export interface StealthMetaAddressBytes {
  /** Compressed viewing public key (33 bytes). */
  readonly viewPubKey: Uint8Array;
  /** Compressed spending public key (33 bytes). */
  readonly spendPubKey: Uint8Array;
}

/**
 * Normalized `Announcement` event payload (after decoding logs).
 * Matches {@link IStealthAddressAnnouncer.Announcement} on-chain shape.
 */
export interface AnnouncementDecoded {
  /** EIP-5564 scheme id (e.g. {@link EIP5564_SCHEME_SECP256K1}). */
  readonly schemeId: bigint;
  /** One-time stealth recipient address. */
  readonly stealthAddress: Address;
  /** On-chain `msg.sender` of `announce`. */
  readonly caller: Address;
  /** Ephemeral secp256k1 public key bytes (typically 33-byte compressed). */
  readonly ephemeralPubKey: Uint8Array;
  /**
   * Opaque metadata; by convention `metadata[0]` is the **view tag** (single byte)
   * for cheap client-side filtering before full ECDH.
   */
  readonly metadata: Uint8Array;
  /** Log index within the block (when sourced from an event). */
  readonly logIndex?: number;
  /** Block number when the announcement was included. */
  readonly blockNumber?: bigint;
  /** Transaction hash that emitted the announcement. */
  readonly transactionHash?: Hex;
}

/**
 * Locally stored manual “ghost” send: one-time stealth material without an on-chain
 * announcement (app must persist ciphertext / material; not recoverable from chain alone).
 */
export interface ManualGhostEntry {
  /** One-time stealth address shown to the sender. */
  readonly stealthAddress: Address;
  /** Ephemeral secret or key material scope (never log raw secrets). */
  readonly deviceScope?: string;
  /** Optional user label in the host app. */
  readonly label?: string;
  /** Unix ms when the entry was created. */
  readonly createdAtMs: number;
}
