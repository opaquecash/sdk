/**
 * Codec for the fixed 96-byte cross-chain announcement payload (Universal Announcement Bus).
 * Mirrors `spec/payload-format.md` byte-for-byte so it round-trips with the on-chain
 * UABSender / stealth-announcer encoders and the UABReceiver / uab-receiver decoders.
 *
 *  [0]      view_tag         (1)
 *  [1..34)  ephemeral_pubkey (33)
 *  [34..66) stealth_address  (32, left-padded; low 20 bytes = EVM-style address)
 *  [66..68) source_chain_id  (2, big-endian Wormhole chain id)
 *  [68..72) scheme_id        (4, big-endian)
 *  [72..96) metadata         (24)
 *
 * @packageDocumentation
 */

import type { Hex } from "./types.js";

/** Length of the fixed cross-chain announcement payload. */
export const UAB_PAYLOAD_LENGTH = 96 as const;

/** Wormhole chain ids used by Opaque deployments. */
export const WORMHOLE_CHAIN_ID = { ethereum: 2, solana: 1 } as const;

/** Decoded cross-chain announcement payload. */
export interface UabPayload {
  /** EIP-5564 view tag (the metadata's first byte). */
  viewTag: number;
  /** Compressed secp256k1 ephemeral public key (33 bytes). */
  ephemeralPubKey: Uint8Array;
  /** 32-byte stealth-address field; the low 20 bytes are the EVM-style address. */
  stealthAddress: Uint8Array;
  /** Wormhole chain id of the origin chain (2 = Ethereum, 1 = Solana). */
  sourceChainId: number;
  /** CSAP / ERC-5564 scheme id (1 = secp256k1). */
  schemeId: number;
  /** Up to 24 sender-defined bytes; the view tag is NOT repeated here. */
  metadata: Uint8Array;
}

/** Inputs to {@link encodeUabPayload}. */
export interface EncodeUabPayloadInput {
  viewTag: number;
  ephemeralPubKey: Uint8Array | Hex;
  /** 20-byte (EVM) or 32-byte stealth address; left-padded to 32. */
  stealthAddress: Uint8Array | Hex;
  sourceChainId: number;
  schemeId: number;
  /** Up to 24 bytes of sender-defined metadata (excluding the view tag). */
  metadata?: Uint8Array | Hex;
}

/** Encode a cross-chain announcement into the canonical 96-byte body. */
export function encodeUabPayload(input: EncodeUabPayloadInput): Uint8Array {
  const eph = asBytes(input.ephemeralPubKey);
  if (eph.length !== 33) throw new Error(`ephemeralPubKey must be 33 bytes, got ${eph.length}`);
  const sa = asBytes(input.stealthAddress);
  if (sa.length === 0 || sa.length > 32) throw new Error(`stealthAddress must be 1..=32 bytes, got ${sa.length}`);
  const meta = input.metadata ? asBytes(input.metadata) : new Uint8Array(0);
  if (meta.length > 24) throw new Error(`metadata must be <= 24 bytes, got ${meta.length}`);

  const out = new Uint8Array(UAB_PAYLOAD_LENGTH);
  out[0] = input.viewTag & 0xff;
  out.set(eph, 1);
  out.set(sa, 66 - sa.length); // left-pad into [34..66)
  const dv = new DataView(out.buffer);
  dv.setUint16(66, input.sourceChainId, false);
  dv.setUint32(68, input.schemeId >>> 0, false);
  out.set(meta, 72);
  return out;
}

/** Decode a 96-byte cross-chain announcement body. */
export function decodeUabPayload(bytes: Uint8Array | Hex): UabPayload {
  const b = asBytes(bytes);
  if (b.length !== UAB_PAYLOAD_LENGTH) {
    throw new Error(`payload must be ${UAB_PAYLOAD_LENGTH} bytes, got ${b.length}`);
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    viewTag: b[0],
    ephemeralPubKey: b.slice(1, 34),
    stealthAddress: b.slice(34, 66),
    sourceChainId: dv.getUint16(66, false),
    schemeId: dv.getUint32(68, false),
    metadata: b.slice(72, 96),
  };
}

/** The low 20 bytes of the stealth-address field (the EVM-style one-time address). */
export function uabStealthAddressEvm(p: UabPayload): Uint8Array {
  return p.stealthAddress.slice(12);
}

/** Reconstruct the EIP-5564 `metadata` (view tag + tail) for the WASM scanner. */
export function uabPayloadToMetadata(p: UabPayload): Uint8Array {
  const out = new Uint8Array(1 + p.metadata.length);
  out[0] = p.viewTag;
  out.set(p.metadata, 1);
  return out;
}

function asBytes(value: Uint8Array | Hex): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length % 2 !== 0) throw new Error("hex string must have an even length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
