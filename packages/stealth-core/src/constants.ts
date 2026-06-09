/**
 * Protocol constants for the EIP-5564 / dual-key stealth address layer.
 *
 * @packageDocumentation
 */

/**
 * EIP-5564 scheme identifier for secp256k1 (DKSAP) as used by Opaque.
 *
 * @see {@link https://eips.ethereum.org/EIPS/eip-5564 | EIP-5564}
 */
export const EIP5564_SCHEME_SECP256K1 = 1 as const;

/**
 * Compressed secp256k1 public key length (33 bytes: 0x02/0x03 prefix + 32-byte x).
 */
export const COMPRESSED_PUBKEY_LENGTH = 33;

/**
 * Stealth meta-address byte length: compressed viewing pubkey `V` + compressed spending pubkey `S`.
 */
export const STEALTH_META_ADDRESS_LENGTH = COMPRESSED_PUBKEY_LENGTH * 2;
