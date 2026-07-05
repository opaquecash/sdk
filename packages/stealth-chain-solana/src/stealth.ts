/**
 * Native ed25519 stealth destinations for Solana (CSAP §2.3, scheme 1).
 *
 * Solana accounts are ed25519, so a stealth account there must be a real ed25519 key: its address
 * is a curve point the sender and any view-only scanner can compute from PUBLIC material, while
 * only the recipient can recover the private scalar that controls it. This is the DKSAP tweak
 * applied on the ed25519 curve, reusing the same secp256k1 ECDH shared secret as the Ethereum path:
 *
 *   shared  = v · R      (secp256k1 ECDH; sender computes r · V, recipient computes v · R)
 *   h_ed    = H("opaque-solana-stealth-v2" ‖ shared) mod L     (ed25519 scalar order L)
 *   P_ed    = S_ed + h_ed · B        (32-byte ed25519 stealth address; PUBLIC-derivable)
 *   a       = (s_ed + h_ed) mod L    (one-time spend scalar; needs the recipient's s_ed)
 *
 * where (s_ed, S_ed = s_ed · B) is the recipient's ed25519 spend key, published as the third
 * 32-byte half of the 98-byte meta-address. Because P_ed = a · B, the sender-computed address and
 * the recipient's signer agree, yet the sender — lacking s_ed — cannot derive `a`. The spend scalar
 * is a raw scalar (not a seed), so a stealth account is signed with {@link stealthSolanaSigner}
 * rather than a `Keypair` (whose secret is a seed expanded via SHA-512).
 *
 * Historical note: the previous scheme derived the ed25519 seed by hashing the secp256k1 stealth
 * *public* point, which the payer also knows — letting the payer recompute the spend key and sweep
 * the funds (OPQ-002). That construction has been removed.
 */

import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { concatBytes } from "./bytes.js";

/** Order of the ed25519 prime-order subgroup (L). */
const ED25519_ORDER = ed25519.CURVE.n;
/** Domain separator for the ed25519 stealth tweak. */
const SOLANA_TWEAK_DOMAIN = new TextEncoder().encode("opaque-solana-stealth-v2");
/** Domain separator for the deterministic signing nonce prefix. */
const NONCE_DOMAIN = new TextEncoder().encode("opaque-ed25519-stealth-nonce-v1");

function bytesToNumberLE(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]);
  return x;
}

function numberToBytesLE(n: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let x = n;
  for (let i = 0; i < len; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function modL(x: bigint): bigint {
  return ((x % ED25519_ORDER) + ED25519_ORDER) % ED25519_ORDER;
}

/**
 * Reduce a little-endian byte seed to a non-zero ed25519 scalar in `[1, L)`. Used both to turn the
 * wallet's 32-byte Solana spend seed into `s_ed` and to load a reconstructed one-time scalar.
 */
export function reduceScalarLE(seed: Uint8Array): bigint {
  const s = modL(bytesToNumberLE(seed));
  // Zero is cryptographically unreachable from a real seed; map it away defensively.
  return s === 0n ? 1n : s;
}

function scalarPublicKey(scalar: bigint): Uint8Array {
  return ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
}

/**
 * The recipient's ed25519 spend PUBLIC key `S_ed = s_ed · B` from the 32-byte spend seed. This is
 * the third half of the 98-byte stealth meta-address.
 */
export function ed25519SpendPublicKey(spendSeed: Uint8Array): Uint8Array {
  return scalarPublicKey(reduceScalarLE(spendSeed));
}

/** The ed25519 tweak scalar `h_ed = H(domain ‖ shared) mod L` from the secp256k1 ECDH secret. */
export function solanaStealthTweak(shared: Uint8Array): bigint {
  return modL(bytesToNumberLE(sha512(concatBytes(SOLANA_TWEAK_DOMAIN, shared))));
}

/**
 * Sender / view-only scanner: the 32-byte ed25519 stealth address point `P_ed = S_ed + h_ed · B`,
 * computed from the recipient's ed25519 spend PUBLIC key and the shared secret — no spend key.
 */
export function deriveSolanaStealthPoint(
  spendPubKeyEd: Uint8Array,
  shared: Uint8Array,
): Uint8Array {
  if (spendPubKeyEd.length !== 32) {
    throw new Error("Opaque: ed25519 spend public key must be 32 bytes");
  }
  const tweak = solanaStealthTweak(shared);
  if (tweak === 0n) throw new Error("Opaque: degenerate stealth tweak");
  let spendPoint;
  try {
    spendPoint = ed25519.ExtendedPoint.fromHex(spendPubKeyEd);
  } catch {
    throw new Error("Opaque: invalid ed25519 spend public key (not a curve point)");
  }
  return spendPoint.add(ed25519.ExtendedPoint.BASE.multiply(tweak)).toRawBytes();
}

/**
 * Recipient: the one-time ed25519 spend scalar `a = (s_ed + h_ed) mod L` as 32 little-endian bytes.
 * Feed to {@link stealthSolanaSigner}. Requires the recipient's Solana spend seed (`s_ed`).
 */
export function reconstructSolanaStealthScalar(
  spendSeed: Uint8Array,
  shared: Uint8Array,
): Uint8Array {
  const a = modL(reduceScalarLE(spendSeed) + solanaStealthTweak(shared));
  return numberToBytesLE(a === 0n ? 1n : a, 32);
}

/** Base58 Solana address for a 32-byte ed25519 stealth point (from {@link deriveSolanaStealthPoint}). */
export function deriveStealthSolanaAddress(stealthPointEd: Uint8Array): string {
  if (stealthPointEd.length !== 32) {
    throw new Error("Opaque: stealth ed25519 point must be 32 bytes");
  }
  return new PublicKey(stealthPointEd).toBase58();
}

/**
 * A signer for a one-time stealth account, controlled by a raw ed25519 scalar rather than a seed.
 * `sign` returns a 64-byte ed25519 signature over `message` that verifies against `publicKey`; use
 * it with `Transaction.addSignature` (a Solana `Keypair` cannot represent a raw scalar).
 */
export interface StealthSolanaSigner {
  readonly publicKey: PublicKey;
  sign(message: Uint8Array): Uint8Array;
}

/**
 * Produce a raw ed25519 EdDSA signature for `message` under scalar `a` (where `A = a · B`). The
 * per-signature nonce is derived deterministically from a secret prefix bound to the scalar, so it
 * never repeats for distinct messages and never leaks the scalar.
 */
function signWithScalar(message: Uint8Array, a: bigint): Uint8Array {
  const A = scalarPublicKey(a);
  const prefix = sha512(concatBytes(NONCE_DOMAIN, numberToBytesLE(a, 32))).slice(0, 32);
  let r = modL(bytesToNumberLE(sha512(concatBytes(prefix, message))));
  if (r === 0n) r = 1n;
  const R = scalarPublicKey(r);
  const k = modL(bytesToNumberLE(sha512(concatBytes(R, A, message))));
  const s = modL(r + k * a);
  const sig = new Uint8Array(64);
  sig.set(R, 0);
  sig.set(numberToBytesLE(s, 32), 32);
  return sig;
}

/** Build a {@link StealthSolanaSigner} from a 32-byte little-endian one-time spend scalar. */
export function stealthSolanaSigner(scalarSeed: Uint8Array): StealthSolanaSigner {
  const a = reduceScalarLE(scalarSeed);
  const publicKey = new PublicKey(scalarPublicKey(a));
  return {
    publicKey,
    sign: (message: Uint8Array) => signWithScalar(message, a),
  };
}
