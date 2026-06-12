/**
 * BIP-340 quorum-signature helpers — spec/conditional-disclosure.md §5.
 * A FROST(secp256k1, Taproot) aggregate from the custodian ceremony is a standard
 * BIP-340 Schnorr signature; this module verifies one client-side (mirroring the
 * on-chain checks) and converts it into the (rx, ry, s) tuple both registries take.
 */
import { schnorr } from "@noble/curves/secp256k1";

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

/** The SchnorrSig tuple submitted on-chain (R as a full even-Y point). */
export interface QuorumSignature {
  rx: bigint;
  ry: bigint;
  s: bigint;
}

/** The custodian CLI's `signature.json` shape (frost-custodian aggregate). */
export interface FrostSignatureFile {
  rx: string;
  ry: string;
  s: string;
  bip340: string;
  message: string;
  group_key_x: string;
}

function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}

/** Even-Y lift of an x coordinate (p ≡ 3 mod 4 → sqrt = ^((p+1)/4)). */
export function liftEvenY(x: bigint): bigint {
  const y = modpow((x * x * x + 7n) % SECP_P, (SECP_P + 1n) / 4n, SECP_P);
  if ((y * y) % SECP_P !== (x * x * x + 7n) % SECP_P) throw new Error("x is not on the curve");
  return y % 2n === 0n ? y : SECP_P - y;
}

const to32 = (x: bigint) => Uint8Array.from(Buffer.from(x.toString(16).padStart(64, "0"), "hex"));

/** Parse a 64-byte BIP-340 signature (Rx ‖ s) into the on-chain tuple. */
export function parseBip340(signature: Uint8Array): QuorumSignature {
  if (signature.length !== 64) throw new Error("BIP-340 signature must be 64 bytes");
  const rx = BigInt("0x" + Buffer.from(signature.slice(0, 32)).toString("hex"));
  const s = BigInt("0x" + Buffer.from(signature.slice(32)).toString("hex"));
  return { rx, ry: liftEvenY(rx), s };
}

/** Parse the custodian CLI's aggregate output. */
export function parseFrostSignature(file: FrostSignatureFile): QuorumSignature {
  return parseBip340(Uint8Array.from(Buffer.from(file.bip340, "hex")));
}

/**
 * Verify a quorum signature over a 32-byte message against the x-only group key —
 * the same check both registries perform, so a submission that passes here passes
 * on-chain.
 */
export function verifyQuorumSignature(
  groupKeyX: bigint,
  message: Uint8Array,
  sig: QuorumSignature,
): boolean {
  if (message.length !== 32) throw new Error("message must be 32 bytes (the context)");
  try {
    return schnorr.verify(
      new Uint8Array([...to32(sig.rx), ...to32(sig.s)]),
      message,
      to32(groupKeyX),
    );
  } catch {
    return false;
  }
}
