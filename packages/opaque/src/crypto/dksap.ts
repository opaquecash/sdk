/**
 * EIP-5564 sender/receiver key material — matches Opaque wallet derivation (`opaque-cash-v1` HKDF).
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import type { Hex } from "viem";
import { getAddress, type Address } from "viem";
import {
  ed25519SpendPublicKey,
  deriveSolanaStealthPoint,
  reconstructSolanaStealthScalar,
} from "@opaquecash/stealth-chain-solana";

const CURVE = secp256k1;
const DOMAIN = "opaque-cash-v1";

/**
 * Canonical message a wallet must sign before {@link deriveKeysFromSignature}.
 * Chain-neutral by design — the same wallet derives the same keys everywhere.
 * MUST match `spec/CSAP.md` §2.2 and both frontends' `SETUP_MESSAGE` byte-for-byte.
 */
export const SETUP_MESSAGE =
  "Sign this message to derive your Opaque Cash stealth keys. This does not approve any transaction.";

export function deriveKeysFromSignature(signatureHex: Hex): {
  viewingKey: Uint8Array;
  spendingKey: Uint8Array;
  /** 32-byte seed for the ed25519 Solana spend key `s_ed` (CSAP §2.3). */
  solanaSpendingKey: Uint8Array;
  /** 32-byte root for per-dApp identities (CSAP §2.10); see `dapp-wallet.ts`. */
  dappRoot: Uint8Array;
} {
  const sigBytes =
    typeof signatureHex === "string"
      ? signatureHex.startsWith("0x")
        ? signatureHex.slice(2)
        : signatureHex
      : signatureHex;
  const sig =
    typeof sigBytes === "string" ? hexToBytes(sigBytes) : sigBytes;
  // Expand to 128 bytes: HKDF-Expand is a prefix stream, so blocks [0:96] are
  // byte-identical to the earlier 96-byte expansion — existing viewing/spending/
  // Solana keys and meta-addresses never move. The fourth block is the dApp-identity
  // root, a one-way sibling of the spending key (guarded by tests/dksap-vectors.test.ts;
  // only L may ever change here — salt/info changes are NOT prefix-stable).
  const okm = hkdf(sha256, sig, undefined, DOMAIN, 128);
  return {
    viewingKey: okm.slice(0, 32),
    spendingKey: okm.slice(32, 64),
    solanaSpendingKey: okm.slice(64, 96),
    dappRoot: okm.slice(96, 128),
  };
}

export function keysToStealthMetaAddress(
  viewingKey: Uint8Array,
  spendingKey: Uint8Array,
  solanaSpendingKey: Uint8Array,
): { V: Uint8Array; S: Uint8Array; solanaSpendPubKey: Uint8Array; metaAddress: Uint8Array } {
  const V = CURVE.getPublicKey(viewingKey, true);
  const S = CURVE.getPublicKey(spendingKey, true);
  const solanaSpendPubKey = ed25519SpendPublicKey(solanaSpendingKey);
  const metaAddress = new Uint8Array(V.length + S.length + solanaSpendPubKey.length);
  metaAddress.set(V, 0);
  metaAddress.set(S, V.length);
  metaAddress.set(solanaSpendPubKey, V.length + S.length);
  return { V, S, solanaSpendPubKey, metaAddress };
}

export function stealthMetaAddressToHex(metaAddress: Uint8Array): Hex {
  return (`0x${bytesToHex(metaAddress)}`) as Hex;
}

/**
 * Build the meta-address for view-only delegation (CSAP §2.8): the scanner holds the viewing
 * PRIVATE key `v` and the spending PUBLIC key `S` (plus the ed25519 Solana spend PUBLIC key `S_ed`
 * for Solana scanning), never any spending private key. The viewing public key `V = v·G` is derived
 * here; the result `V‖S[‖S_ed]` matches {@link keysToStealthMetaAddress}. Omit `solanaSpendPubKey`
 * for an Ethereum-only (66-byte) delegation.
 */
export function viewOnlyMetaAddress(
  viewingKey: Uint8Array,
  spendPubKey: Uint8Array,
  solanaSpendPubKey?: Uint8Array,
): { V: Uint8Array; S: Uint8Array; solanaSpendPubKey?: Uint8Array; metaAddress: Uint8Array } {
  assertCompressedPubkey33("spendPubKey", spendPubKey);
  if (solanaSpendPubKey && solanaSpendPubKey.length !== 32) {
    throw new Error(
      `Opaque: solanaSpendPubKey must be 32 bytes (ed25519), got ${solanaSpendPubKey.length}`,
    );
  }
  const V = CURVE.getPublicKey(viewingKey, true);
  const tail = solanaSpendPubKey ?? new Uint8Array(0);
  const metaAddress = new Uint8Array(V.length + spendPubKey.length + tail.length);
  metaAddress.set(V, 0);
  metaAddress.set(spendPubKey, V.length);
  if (tail.length) metaAddress.set(tail, V.length + spendPubKey.length);
  return { V, S: spendPubKey, solanaSpendPubKey, metaAddress };
}

/**
 * A fresh random 66-byte meta-address from two throwaway private keys. The keys are
 * discarded — nobody can ever scan for or spend from announcements made to it. Used by
 * the anonymity-set utilities to mint decoy recipients (guide §17).
 */
export function generateRandomMetaAddress(): Hex {
  const viewingKey = CURVE.utils.randomPrivateKey();
  const spendingKey = CURVE.utils.randomPrivateKey();
  const solanaSpendingKey = CURVE.utils.randomPrivateKey();
  const { metaAddress } = keysToStealthMetaAddress(
    viewingKey,
    spendingKey,
    solanaSpendingKey,
  );
  return stealthMetaAddressToHex(metaAddress);
}

export function parseStealthMetaAddress(metaHex: Hex): {
  viewPubKey: Uint8Array;
  spendPubKey: Uint8Array;
  /** ed25519 Solana spend public key `S_ed`; present only for a 98-byte meta-address. */
  solanaSpendPubKey?: Uint8Array;
} {
  const raw =
    typeof metaHex === "string" && metaHex.startsWith("0x")
      ? metaHex.slice(2)
      : metaHex;
  const bytes = hexToBytes(raw);
  if (bytes.length < 66) {
    throw new Error("Invalid stealth meta-address: expected at least 66 bytes");
  }
  return {
    viewPubKey: bytes.slice(0, 33),
    spendPubKey: bytes.slice(33, 66),
    solanaSpendPubKey: bytes.length >= 98 ? bytes.slice(66, 98) : undefined,
  };
}

function assertCompressedPubkey33(name: string, key: Uint8Array): void {
  if (key.length !== 33) {
    throw new Error(`Opaque: ${name} must be 33 bytes (compressed), got ${key.length}`);
  }
  const prefix = key[0];
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new Error(
      `Opaque: ${name} must start with 0x02 or 0x03 (compressed), got 0x${prefix.toString(16)}`,
    );
  }
}

function sharedSecretSender(
  ephemeralPriv: Uint8Array,
  viewPubKey: Uint8Array,
): Uint8Array {
  assertCompressedPubkey33("viewPubKey", viewPubKey);
  const P = CURVE.ProjectivePoint.fromHex(viewPubKey);
  const scalar = bytesToBigInt(ephemeralPriv) % CURVE.CURVE.n;
  if (scalar === 0n) throw new Error("Invalid ephemeral key");
  return P.multiply(scalar).toRawBytes(true);
}

function hashSharedSecret(sharedSecret: Uint8Array): {
  sH: Uint8Array;
  viewTag: number;
} {
  const sH = keccak_256(sharedSecret);
  return { sH, viewTag: sH[0] };
}

function stealthPointAndAddress(
  spendPubKey: Uint8Array,
  sH: Uint8Array,
): { stealthAddress: Address; stealthPubKeyUncompressed: Uint8Array } {
  const n = CURVE.CURVE.n;
  const sHBig = bytesToBigInt(sH);
  const sHMod = sHBig % n;
  if (sHMod === 0n) throw new Error("Invalid scalar from hash");
  const S_h = CURVE.ProjectivePoint.BASE.multiply(sHMod);
  assertCompressedPubkey33("spendPubKey", spendPubKey);
  const P_spend = CURVE.ProjectivePoint.fromHex(spendPubKey);
  const P_stealth = P_spend.add(S_h);
  const uncompressed = P_stealth.toRawBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const addr = getAddress(
    (`0x${bytesToHex(hash.slice(12))}`) as Hex,
  );
  return { stealthAddress: addr, stealthPubKeyUncompressed: uncompressed };
}

/**
 * Recipient-side ECDH shared secret: viewing PRIVATE key · ephemeral PUBLIC key.
 * Equals the sender's `ephemeralPriv · viewPubKey` (the same curve point), so a
 * view-only holder can recompute an owned output's stealth point without the
 * spending private key.
 */
function sharedSecretRecipient(
  viewingKey: Uint8Array,
  ephemeralPubKey: Uint8Array,
): Uint8Array {
  assertCompressedPubkey33("ephemeralPubKey", ephemeralPubKey);
  const R = CURVE.ProjectivePoint.fromHex(ephemeralPubKey);
  const scalar = bytesToBigInt(viewingKey) % CURVE.CURVE.n;
  if (scalar === 0n) throw new Error("Invalid viewing key");
  return R.multiply(scalar).toRawBytes(true);
}

/**
 * Recompute an owned output's stealth address + uncompressed public-key point from
 * its ephemeral public key, using the viewing PRIVATE key and the spending PUBLIC
 * key only — never the spending private key. This is the view-only dual of
 * {@link computeStealthAddressAndViewTag}: use it to derive the Solana destination
 * (`deriveStealthSolanaAddress`) or verify the EVM address for a scanned output
 * without spending authority.
 */
export function recipientStealthPoint(
  viewingKey: Uint8Array,
  spendPubKey: Uint8Array,
  ephemeralPubKey: Uint8Array,
  solanaSpendPubKey?: Uint8Array,
): {
  stealthAddress: Address;
  stealthPubKeyUncompressed: Uint8Array;
  /** 32-byte ed25519 Solana stealth address point; present when `solanaSpendPubKey` is given. */
  solanaStealthPubKey?: Uint8Array;
  viewTag: number;
} {
  const shared = sharedSecretRecipient(viewingKey, ephemeralPubKey);
  const { sH, viewTag } = hashSharedSecret(shared);
  const { stealthAddress, stealthPubKeyUncompressed } = stealthPointAndAddress(
    spendPubKey,
    sH,
  );
  const solanaStealthPubKey = solanaSpendPubKey
    ? deriveSolanaStealthPoint(solanaSpendPubKey, shared)
    : undefined;
  return { stealthAddress, stealthPubKeyUncompressed, solanaStealthPubKey, viewTag };
}

/**
 * Recipient-side reconstruction of the one-time ed25519 Solana spend scalar for an owned output,
 * from the wallet's 32-byte Solana spend seed and the output's ephemeral public key. Feed the
 * result to `stealthSolanaSigner`. Requires the Solana spend seed (not available view-only).
 */
export function reconstructSolanaSpendScalar(
  solanaSpendingKey: Uint8Array,
  viewingKey: Uint8Array,
  ephemeralPubKey: Uint8Array,
): Uint8Array {
  const shared = sharedSecretRecipient(viewingKey, ephemeralPubKey);
  return reconstructSolanaStealthScalar(solanaSpendingKey, shared);
}

export function computeStealthAddressAndViewTag(recipientMetaAddressHex: Hex): {
  ephemeralPriv: Uint8Array;
  ephemeralPubKey: Uint8Array;
  stealthAddress: Address;
  /** Uncompressed (65-byte) secp256k1 stealth public-key point (Ethereum). */
  stealthPubKeyUncompressed: Uint8Array;
  /** 32-byte ed25519 Solana stealth address point; present when the meta-address carries `S_ed`. */
  solanaStealthPubKey?: Uint8Array;
  viewTag: number;
  metadata: Uint8Array;
} {
  const { viewPubKey, spendPubKey, solanaSpendPubKey } =
    parseStealthMetaAddress(recipientMetaAddressHex);
  const ephemeralPriv = CURVE.utils.randomPrivateKey();
  const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);
  const shared = sharedSecretSender(ephemeralPriv, viewPubKey);
  const { sH, viewTag } = hashSharedSecret(shared);
  const { stealthAddress, stealthPubKeyUncompressed } = stealthPointAndAddress(
    spendPubKey,
    sH,
  );
  const solanaStealthPubKey = solanaSpendPubKey
    ? deriveSolanaStealthPoint(solanaSpendPubKey, shared)
    : undefined;
  const metadata = new Uint8Array(1);
  metadata[0] = viewTag;
  return {
    ephemeralPriv,
    ephemeralPubKey,
    stealthAddress,
    stealthPubKeyUncompressed,
    solanaStealthPubKey,
    viewTag,
    metadata,
  };
}

/**
 * Re-derive stealth material from a fixed 32-byte ephemeral secret (manual “ghost” receive).
 * Must match {@link computeStealthAddressAndViewTag} for the same meta-address and scalar.
 */
/** 33-byte compressed secp256k1 pubkey for a 32-byte ephemeral secret (sender ghost material). */
export function ephemeralPrivateKeyToCompressedPublicKey(
  ephemeralPrivateKey: Uint8Array,
): Uint8Array {
  if (ephemeralPrivateKey.length !== 32) {
    throw new Error("Ephemeral private key must be 32 bytes.");
  }
  return CURVE.getPublicKey(ephemeralPrivateKey, true);
}

export function recomputeStealthSendFromEphemeralPrivateKey(
  recipientMetaAddressHex: Hex,
  ephemeralPrivateKey: Uint8Array,
): {
  ephemeralPriv: Uint8Array;
  ephemeralPubKey: Uint8Array;
  stealthAddress: Address;
  stealthPubKeyUncompressed: Uint8Array;
  solanaStealthPubKey?: Uint8Array;
  viewTag: number;
  metadata: Uint8Array;
} {
  if (ephemeralPrivateKey.length !== 32) {
    throw new Error("Ephemeral private key must be 32 bytes.");
  }
  const { viewPubKey, spendPubKey, solanaSpendPubKey } =
    parseStealthMetaAddress(recipientMetaAddressHex);
  const ephemeralPriv = ephemeralPrivateKey;
  const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);
  const shared = sharedSecretSender(ephemeralPriv, viewPubKey);
  const { sH, viewTag } = hashSharedSecret(shared);
  const { stealthAddress, stealthPubKeyUncompressed } = stealthPointAndAddress(
    spendPubKey,
    sH,
  );
  const solanaStealthPubKey = solanaSpendPubKey
    ? deriveSolanaStealthPoint(solanaSpendPubKey, shared)
    : undefined;
  const metadata = new Uint8Array(1);
  metadata[0] = viewTag;
  return {
    ephemeralPriv,
    ephemeralPubKey,
    stealthAddress,
    stealthPubKeyUncompressed,
    solanaStealthPubKey,
    viewTag,
    metadata,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error("Invalid hex length");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < b.length; i++) x = (x << 8n) | BigInt(b[i]);
  return x;
}
