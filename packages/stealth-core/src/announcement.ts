import type { Address, AnnouncementDecoded, Hex } from "./types.js";
import { viewTagFromMetadata } from "./meta-address.js";

/**
 * Arguments accepted when building a normalized {@link AnnouncementDecoded} from RPC log args.
 */
export interface AnnouncementLogArgs {
  schemeId: bigint;
  stealthAddress: Address;
  caller: Address;
  ephemeralPubKey: Hex | Uint8Array;
  metadata: Hex | Uint8Array;
  logIndex?: number;
  blockNumber?: bigint;
  transactionHash?: Hex;
}

/**
 * Convert viem/ethers decoded `Announcement` event fields into a stable {@link AnnouncementDecoded}.
 *
 * @param args - Raw event arguments from `StealthAddressAnnouncer`.
 */
export function decodeAnnouncementArgs(args: AnnouncementLogArgs): AnnouncementDecoded {
  return {
    schemeId: args.schemeId,
    stealthAddress: args.stealthAddress,
    caller: args.caller,
    ephemeralPubKey: toBytes(args.ephemeralPubKey),
    metadata: toBytes(args.metadata),
    logIndex: args.logIndex,
    blockNumber: args.blockNumber,
    transactionHash: args.transactionHash,
  };
}

/**
 * Read the view tag from a decoded announcement using the Opaque metadata convention.
 *
 * @param announcement - Decoded announcement (uses `announcement.metadata[0]`).
 * @returns A number in `0..255`, or `undefined` if metadata is empty.
 */
export function announcementViewTag(
  announcement: AnnouncementDecoded,
): number | undefined {
  return viewTagFromMetadata(announcement.metadata);
}

/**
 * JSON-serializable announcement shape for passing into Rust WASM scanners
 * (e.g. `scan_attestations_wasm` in the cryptography module).
 */
export interface AnnouncementJsonRecord {
  stealthAddress: string;
  viewTag: number;
  ephemeralPubKey: number[];
  metadata: number[];
  txHash: string;
  blockNumber: number;
}

/**
 * Map a decoded announcement to the JSON record shape expected by `scan_attestations_wasm`.
 *
 * @param a - Normalized announcement.
 * @param txHash - Transaction hash hex (required if not on `a.transactionHash`).
 * @param blockNumber - Block number (required if not on `a.blockNumber`).
 */
export function announcementToScannerJson(
  a: AnnouncementDecoded,
  txHash?: Hex,
  blockNumber?: number,
): AnnouncementJsonRecord {
  const tag = announcementViewTag(a);
  const th = a.transactionHash ?? txHash;
  const bn =
    a.blockNumber !== undefined
      ? Number(a.blockNumber)
      : blockNumber ?? 0;
  if (!th) {
    throw new Error(
      "announcementToScannerJson: transactionHash is required (on announcement or as argument)",
    );
  }
  return {
    stealthAddress: a.stealthAddress,
    viewTag: tag ?? 0,
    ephemeralPubKey: [...a.ephemeralPubKey],
    metadata: [...a.metadata],
    txHash: th,
    blockNumber: bn,
  };
}

function toBytes(value: Hex | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
