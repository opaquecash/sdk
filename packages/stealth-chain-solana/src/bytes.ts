/**
 * Little-endian integer codecs and byte helpers for Borsh-style Solana instruction data
 * and Anchor event decoding. Kept dependency-light (DataView + `@noble/hashes/utils`) so
 * the decoders run unchanged in Node and the browser.
 */

import {
  bytesToHex as nobleBytesToHex,
  hexToBytes as nobleHexToBytes,
  concatBytes,
} from "@noble/hashes/utils";

export { concatBytes };

/** Lowercase hex without `0x` prefix. */
export function bytesToHex(b: Uint8Array): string {
  return nobleBytesToHex(b);
}

/** Parse hex (with or without `0x`) into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  return nobleHexToBytes(hex.startsWith("0x") ? hex.slice(2) : hex);
}

/** Encode a u64 as 8 little-endian bytes. */
export function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** Encode a u32 as 4 little-endian bytes. */
export function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/** Encode a Borsh `Vec<u8>` (u32 LE length prefix + bytes). */
export function vecU8(bytes: Uint8Array): Uint8Array {
  return concatBytes(u32le(bytes.length), bytes);
}

/** A cursor into a byte buffer for sequential little-endian reads. */
export class ByteReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private offset: number;

  constructor(data: Uint8Array, startOffset = 0) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = startOffset;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  skip(n: number): void {
    this.offset += n;
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readU64(): bigint {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  /** Read `len` raw bytes (copied out). */
  readBytes(len: number): Uint8Array {
    const slice = this.data.slice(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }

  /** Read a Borsh `Vec<u8>` (u32 LE length prefix + bytes). */
  readVecU8(): Uint8Array {
    const len = this.readU32();
    return this.readBytes(len);
  }
}
