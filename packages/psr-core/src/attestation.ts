/**
 * PSR V2 attestation codecs — chain-neutral (the attestation engine has the same encoding on
 * Ethereum and Solana). Covers uid computation, attestation-data field encode/decode, and the
 * `0xB2` announce-metadata marker that lets a recipient's scanner match a V2 attestation.
 *
 * Ported from `ethereum/frontend/src/lib/{attestationV2,psr}.ts` (UI-only zod schemas and display
 * helpers intentionally dropped).
 */

import {
  bytesToHex,
  concatHex,
  encodePacked,
  hexToBytes,
  numberToHex,
  pad,
  sha256,
  type Address,
  type Hex,
} from "viem";
import type { FieldDef } from "./schema.js";

/** All-zero bytes32 (no reference uid). */
export const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as Hex;

/** Minimal field descriptor accepted by the data codecs. */
export type AttestationField = Pick<FieldDef, "name" | "type"> | { name: string; type: string };

/** A decoded V2 attestation record (chain-neutral view). */
export interface AttestationV2 {
  /** Stable id (== uid). */
  address: string;
  /** uid = sha256(schema_id || issuer || stealth_address_hash || block). */
  uid: string;
  /** schema id as 0x-hex. */
  schemaId: string;
  /** Issuer wallet/address. */
  issuer: string;
  /** Privacy-preserving stealth-address hash (bytes32 0x-hex). */
  stealthAddressHash: string;
  /** Encoded attestation data as 0x-hex. */
  dataHex: string;
  /** Block/slot when created. */
  createdAt: number;
  /** 0 = no expiry. */
  expirationSlot: number;
  /** 0 = not revoked. */
  revocationSlot: number;
  /** Reference uid (zeros = none). */
  refUid: string;
}

/**
 * `uid = sha256(abi.encodePacked(schemaId, issuer, stealthAddressHash, blockNumber))`,
 * matching the attestation engine's `computeUid` on-chain.
 */
export function computeUid(
  schemaId: Hex,
  issuer: Address,
  stealthAddressHash: Hex,
  blockNumber: bigint,
): Hex {
  return sha256(
    encodePacked(
      ["bytes32", "address", "bytes32", "uint256"],
      [schemaId, issuer, stealthAddressHash, blockNumber],
    ),
  );
}

/** Encode field values: per field a 4-byte LE length prefix followed by UTF-8 bytes. */
export function encodeAttestationData(
  fieldValues: Record<string, string>,
  fieldDefs: readonly AttestationField[],
): Hex {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const field of fieldDefs) {
    const encoded = enc.encode(fieldValues[field.name] ?? "");
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, encoded.length, true);
    parts.push(lenBuf, encoded);
  }
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return bytesToHex(out);
}

/** Decode attestation data back into a field-value map. */
export function decodeAttestationData(
  dataHex: Hex | string,
  fieldDefs: readonly AttestationField[],
): Record<string, string> {
  const hx = (dataHex.startsWith("0x") ? dataHex : `0x${dataHex}`) as Hex;
  const bytes = hexToBytes(hx);
  const dec = new TextDecoder();
  const result: Record<string, string> = {};
  let offset = 0;
  for (const field of fieldDefs) {
    if (offset + 4 > bytes.length) break;
    const len = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;
    if (offset + len > bytes.length) break;
    result[field.name] = dec.decode(bytes.slice(offset, offset + len));
    offset += len;
  }
  return result;
}

/**
 * Build the `announce` metadata for a V2 attestation:
 * `viewTag(1) || 0xB2 || schemaId(32) || issuer(32) || uid(32) || nonce(32)` (130 bytes).
 * The recipient's scanner matches it with their viewing key.
 */
export function encodeV2AttestationMetadata(args: {
  viewTag: number;
  schemaId: Hex;
  issuer: Address;
  uid: Hex;
  nonce: Hex;
}): Hex {
  return concatHex([
    numberToHex(args.viewTag & 0xff, { size: 1 }),
    "0xb2",
    args.schemaId,
    pad(args.issuer, { size: 32 }),
    args.uid,
    args.nonce,
  ]);
}

/** A fresh 32-byte nonce as 0x-hex (uses Web Crypto, available in Node 18+ and browsers). */
export function randomNonce(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** True if a uid is all-zero (no reference). */
export function isZeroUid(uid: string): boolean {
  return uid.replace(/^0x/, "").replace(/0/g, "") === "";
}
