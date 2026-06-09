/**
 * `@opaquecash/stealth-core` — EIP-5564 stealth types and pure TypeScript helpers (no WASM, no chain RPC).
 *
 * Use this package in workers and servers when you only need parsing, constants, and
 * JSON shapes for the Rust WASM scanner. Heavy curve operations live in `@opaquecash/stealth-wasm`.
 *
 * @packageDocumentation
 */

export {
  EIP5564_SCHEME_SECP256K1,
  COMPRESSED_PUBKEY_LENGTH,
  STEALTH_META_ADDRESS_LENGTH,
} from "./constants.js";

export type {
  Hex,
  Address,
  StealthMetaAddressBytes,
  AnnouncementDecoded,
  ManualGhostEntry,
} from "./types.js";

export {
  parseStealthMetaAddress,
  stealthMetaAddressToHex,
  viewTagFromMetadata,
} from "./meta-address.js";

export type { AnnouncementLogArgs, AnnouncementJsonRecord } from "./announcement.js";
export {
  decodeAnnouncementArgs,
  announcementViewTag,
  announcementToScannerJson,
} from "./announcement.js";
