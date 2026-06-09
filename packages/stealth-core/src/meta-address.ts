import {
  COMPRESSED_PUBKEY_LENGTH,
  STEALTH_META_ADDRESS_LENGTH,
} from "./constants.js";
import type { Hex, StealthMetaAddressBytes } from "./types.js";

/**
 * Parse a 66-byte stealth meta-address from hex (`V || S`, compressed secp256k1).
 *
 * @param metaHex - `0x`-prefixed hex string (132 hex chars + prefix = 66 bytes).
 * @returns Viewing and spending compressed public keys.
 * @throws If the payload is shorter than {@link STEALTH_META_ADDRESS_LENGTH} bytes.
 *
 * @example
 * ```ts
 * const { viewPubKey, spendPubKey } = parseStealthMetaAddress("0x...");
 * ```
 */
export function parseStealthMetaAddress(metaHex: Hex): StealthMetaAddressBytes {
  const raw =
    typeof metaHex === "string" && metaHex.startsWith("0x")
      ? metaHex.slice(2)
      : metaHex;
  const bytes = hexToBytes(raw);
  if (bytes.length < STEALTH_META_ADDRESS_LENGTH) {
    throw new Error(
      `Invalid stealth meta-address: expected at least ${STEALTH_META_ADDRESS_LENGTH} bytes, got ${bytes.length}`,
    );
  }
  return {
    viewPubKey: bytes.slice(0, COMPRESSED_PUBKEY_LENGTH),
    spendPubKey: bytes.slice(
      COMPRESSED_PUBKEY_LENGTH,
      STEALTH_META_ADDRESS_LENGTH,
    ),
  };
}

/**
 * Encode a 66-byte meta-address as canonical `0x` hex for registry calls.
 *
 * @param metaAddress - Concatenation of compressed `V` and `S`.
 */
export function stealthMetaAddressToHex(metaAddress: Uint8Array): Hex {
  return (`0x${bytesToHex(metaAddress)}`) as Hex;
}

/**
 * Return the view tag byte from announcement metadata (first byte), or `undefined` if empty.
 *
 * Opaque follows the convention that `metadata[0]` is the EIP-5564 view tag for prefiltering.
 *
 * @param metadata - Raw metadata bytes from `Announcement` or local payloads.
 */
export function viewTagFromMetadata(metadata: Uint8Array): number | undefined {
  if (metadata.length === 0) return undefined;
  return metadata[0];
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
