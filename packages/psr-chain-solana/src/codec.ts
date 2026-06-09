/**
 * Anchor discriminators and Borsh encode/decode helpers for the PSR Solana programs.
 * Discriminators are the first 8 bytes of `sha256("global:<method>")` (instructions) or
 * `sha256("account:<Type>")` (accounts), the standard Anchor scheme.
 */

import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** First 8 bytes of `sha256("global:<methodName>")`. */
export function anchorDiscriminator(methodName: string): Buffer {
  return Buffer.from(sha256(utf8(`global:${methodName}`)).slice(0, 8));
}

/** First 8 bytes of `sha256("account:<accountName>")`. */
export function accountDiscriminator(accountName: string): Buffer {
  return Buffer.from(sha256(utf8(`account:${accountName}`)).slice(0, 8));
}

export function encodeString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf-8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

export function encodeVecU8(data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length);
  return Buffer.concat([len, Buffer.from(data)]);
}

export function encodeBool(v: boolean): Buffer {
  return Buffer.from([v ? 1 : 0]);
}

export function encodeOptionPubkey(pk: PublicKey | null): Buffer {
  if (pk === null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), pk.toBuffer()]);
}

export function encodeU64(n: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

export function encodeFixedBytes(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

export function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  offset += 4;
  return [buf.slice(offset, offset + len).toString("utf-8"), offset + len];
}

export function readPubkey(buf: Buffer, offset: number): [PublicKey, number] {
  return [new PublicKey(buf.slice(offset, offset + 32)), offset + 32];
}

/** Big-endian 32-byte encoding of a bigint (matches the circuit/verifier field encoding). */
export function bigIntToBytes32(val: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let n = val;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}
