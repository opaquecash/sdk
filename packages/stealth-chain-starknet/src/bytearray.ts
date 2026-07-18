import { keccak_256 } from "@noble/hashes/sha3";

/**
 * Cairo `ByteArray` Serde codec and Starknet selector helpers.
 *
 * Serde layout of `ByteArray` (identical in calldata, event data, and call
 * results): `[num_full_words, ...full_words, pending_word, pending_word_len]`
 * where each full word packs 31 big-endian bytes into one felt and the
 * pending word holds the `< 31` remaining bytes.
 */

const FULL_WORD_BYTES = 31;
const MASK_250 = (1n << 250n) - 1n;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error("Value does not fit in the requested length");
  return out;
}

/** Encode bytes as the felts of a Cairo `ByteArray` (Serde layout). */
export function encodeByteArray(bytes: Uint8Array): bigint[] {
  const fullWords = Math.floor(bytes.length / FULL_WORD_BYTES);
  const felts: bigint[] = [BigInt(fullWords)];
  for (let i = 0; i < fullWords; i++) {
    felts.push(
      bytesToBigInt(bytes.subarray(i * FULL_WORD_BYTES, (i + 1) * FULL_WORD_BYTES)),
    );
  }
  const pending = bytes.subarray(fullWords * FULL_WORD_BYTES);
  felts.push(bytesToBigInt(pending));
  felts.push(BigInt(pending.length));
  return felts;
}

/**
 * Decode one Cairo `ByteArray` starting at `offset`; returns the bytes and
 * how many felts were consumed (so several arrays can be read sequentially).
 */
export function decodeByteArray(
  felts: readonly bigint[],
  offset = 0,
): { bytes: Uint8Array; consumed: number } {
  const fullWords = Number(felts[offset]);
  const pendingLen = Number(felts[offset + 1 + fullWords + 1]);
  if (pendingLen >= FULL_WORD_BYTES) {
    throw new Error(`Malformed ByteArray: pending_word_len ${pendingLen}`);
  }
  const bytes = new Uint8Array(fullWords * FULL_WORD_BYTES + pendingLen);
  for (let i = 0; i < fullWords; i++) {
    bytes.set(
      bigIntToBytes(felts[offset + 1 + i], FULL_WORD_BYTES),
      i * FULL_WORD_BYTES,
    );
  }
  bytes.set(
    bigIntToBytes(felts[offset + 1 + fullWords], pendingLen),
    fullWords * FULL_WORD_BYTES,
  );
  return { bytes, consumed: fullWords + 3 };
}

/** `starknet_keccak(name)`: keccak-256 of the ASCII name, truncated to 250 bits. */
export function starknetKeccak(name: string): bigint {
  return bytesToBigInt(keccak_256(new TextEncoder().encode(name))) & MASK_250;
}

/** Selector as `0x`-hex (event keys, entry points). */
export function selectorHex(name: string): `0x${string}` {
  return `0x${starknetKeccak(name).toString(16)}`;
}

export function toFeltHex(value: bigint): `0x${string}` {
  if (value < 0n) throw new Error("Negative felt");
  return `0x${value.toString(16)}`;
}
