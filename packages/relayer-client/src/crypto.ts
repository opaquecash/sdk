/**
 * NaCl crypto_box (x25519-xsalsa20-poly1305) sealing, matching the relayer node's
 * `crypto_box` Rust side (spec/relayer-market.md §3.3). The box wire format is
 * `epk(32) ‖ nonce(24) ‖ ciphertext`; the user seals to the winning relayer's
 * advertised x25519 public key.
 */

import { x25519 } from "@noble/curves/ed25519";
import { xsalsa20poly1305 } from "@noble/ciphers/salsa";

/**
 * Seal `plaintext` to `recipientX25519Pub`, returning `epk ‖ nonce(24) ‖ ct`.
 * Interoperable with the relayer node's `crypto_box::SalsaBox`.
 */
export function sealBox(
  recipientX25519Pub: Uint8Array,
  plaintext: Uint8Array,
  randomBytes: (n: number) => Uint8Array,
): Uint8Array {
  const ephSecret = randomBytes(32);
  const ephPublic = x25519.getPublicKey(ephSecret);
  const shared = naclBoxKey(ephSecret, recipientX25519Pub);
  const nonce = randomBytes(24);
  const cipher = xsalsa20poly1305(shared, nonce);
  const ct = cipher.encrypt(plaintext);
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(ephPublic, 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return out;
}

/** Open a box addressed to `ourX25519Secret` (used in tests / read paths). */
export function openBox(ourX25519Secret: Uint8Array, boxed: Uint8Array): Uint8Array {
  const epk = boxed.subarray(0, 32);
  const nonce = boxed.subarray(32, 56);
  const ct = boxed.subarray(56);
  const shared = naclBoxKey(ourX25519Secret, epk);
  const cipher = xsalsa20poly1305(shared, nonce);
  return cipher.decrypt(ct);
}

/**
 * NaCl `crypto_box_beforenm`: `HSalsa20(0^16, X25519(sk, pk))`. xsalsa20poly1305 takes
 * a 32-byte key; NaCl's box derives that key by hashing the DH output with HSalsa20
 * under a zero nonce. @noble/ciphers ships `hsalsa` via the salsa module.
 */
function naclBoxKey(secret: Uint8Array, peerPublic: Uint8Array): Uint8Array {
  const dh = x25519.getSharedSecret(secret, peerPublic);
  return hsalsa(dh);
}

// HSalsa20 core with a 16-byte zero nonce and the NaCl "sigma" constant, applied to
// the 32-byte DH output to produce the box key (RFC: NaCl crypto_box_beforenm).
const SIGMA = new TextEncoder().encode("expand 32-byte k");

function rotl(x: number, b: number): number {
  return ((x << b) | (x >>> (32 - b))) >>> 0;
}

function hsalsa(dh: Uint8Array): Uint8Array {
  // Input: key = dh (32 bytes), nonce = 16 zero bytes.
  const x = new Uint32Array(16);
  const le = (b: Uint8Array, i: number) =>
    (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  x[0] = le(SIGMA, 0);
  x[5] = le(SIGMA, 4);
  x[10] = le(SIGMA, 8);
  x[15] = le(SIGMA, 12);
  x[1] = le(dh, 0);
  x[2] = le(dh, 4);
  x[3] = le(dh, 8);
  x[4] = le(dh, 12);
  x[11] = le(dh, 16);
  x[12] = le(dh, 20);
  x[13] = le(dh, 24);
  x[14] = le(dh, 28);
  // nonce x[6..10] stay zero.
  for (let i = 0; i < 20; i += 2) {
    x[4] ^= rotl((x[0] + x[12]) >>> 0, 7);
    x[8] ^= rotl((x[4] + x[0]) >>> 0, 9);
    x[12] ^= rotl((x[8] + x[4]) >>> 0, 13);
    x[0] ^= rotl((x[12] + x[8]) >>> 0, 18);
    x[9] ^= rotl((x[5] + x[1]) >>> 0, 7);
    x[13] ^= rotl((x[9] + x[5]) >>> 0, 9);
    x[1] ^= rotl((x[13] + x[9]) >>> 0, 13);
    x[5] ^= rotl((x[1] + x[13]) >>> 0, 18);
    x[14] ^= rotl((x[10] + x[6]) >>> 0, 7);
    x[2] ^= rotl((x[14] + x[10]) >>> 0, 9);
    x[6] ^= rotl((x[2] + x[14]) >>> 0, 13);
    x[10] ^= rotl((x[6] + x[2]) >>> 0, 18);
    x[3] ^= rotl((x[15] + x[11]) >>> 0, 7);
    x[7] ^= rotl((x[3] + x[15]) >>> 0, 9);
    x[11] ^= rotl((x[7] + x[3]) >>> 0, 13);
    x[15] ^= rotl((x[11] + x[7]) >>> 0, 18);
    x[1] ^= rotl((x[0] + x[3]) >>> 0, 7);
    x[2] ^= rotl((x[1] + x[0]) >>> 0, 9);
    x[3] ^= rotl((x[2] + x[1]) >>> 0, 13);
    x[0] ^= rotl((x[3] + x[2]) >>> 0, 18);
    x[6] ^= rotl((x[5] + x[4]) >>> 0, 7);
    x[7] ^= rotl((x[6] + x[5]) >>> 0, 9);
    x[4] ^= rotl((x[7] + x[6]) >>> 0, 13);
    x[5] ^= rotl((x[4] + x[7]) >>> 0, 18);
    x[11] ^= rotl((x[10] + x[9]) >>> 0, 7);
    x[8] ^= rotl((x[11] + x[10]) >>> 0, 9);
    x[9] ^= rotl((x[8] + x[11]) >>> 0, 13);
    x[10] ^= rotl((x[9] + x[8]) >>> 0, 18);
    x[12] ^= rotl((x[15] + x[14]) >>> 0, 7);
    x[13] ^= rotl((x[12] + x[15]) >>> 0, 9);
    x[14] ^= rotl((x[13] + x[12]) >>> 0, 13);
    x[15] ^= rotl((x[14] + x[13]) >>> 0, 18);
  }
  const out = new Uint8Array(32);
  const wr = (v: number, i: number) => {
    out[i] = v & 0xff;
    out[i + 1] = (v >>> 8) & 0xff;
    out[i + 2] = (v >>> 16) & 0xff;
    out[i + 3] = (v >>> 24) & 0xff;
  };
  // HSalsa20 output words: 0,5,10,15,6,7,8,9.
  wr(x[0], 0);
  wr(x[5], 4);
  wr(x[10], 8);
  wr(x[15], 12);
  wr(x[6], 16);
  wr(x[7], 20);
  wr(x[8], 24);
  wr(x[9], 28);
  return out;
}

/**
 * Derive the box identity the relayer node advertises, from its operator seed
 * (`x25519_secret = keccak256("opaque-relayer-box-v1" ‖ seed)`). Exposed for tests
 * that simulate a relayer; users only ever consume the advertised public key.
 */
export { hsalsa as _hsalsaForTests };
