/**
 * Deterministic one-time Solana destinations for stealth funds.
 *
 * The DKSAP stealth point is a secp256k1 key (shared with Ethereum), but Solana accounts are
 * ed25519. Sender and recipient — who can both reconstruct the same stealth secp256k1 point —
 * derive the same ed25519 Solana keypair via `Keypair.fromSeed(sha256("opaque-solana-stealth-v1"
 * || uncompressedStealthPubKey))`. This agrees on the destination without leaking linkage to the
 * recipient's main wallet. Ported from `solana/frontend/src/lib/stealth.ts`.
 */

import { Keypair } from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2";
import { concatBytes } from "./bytes.js";

const STEALTH_SOLANA_DOMAIN = "opaque-solana-stealth-v1";

/** Derive the deterministic Solana keypair from the uncompressed (65-byte) stealth pubkey. */
export function deriveStealthSolanaKeypair(
  stealthPubKeyUncompressed: Uint8Array,
): Keypair {
  const domain = new TextEncoder().encode(STEALTH_SOLANA_DOMAIN);
  const seed = sha256(concatBytes(domain, stealthPubKeyUncompressed));
  return Keypair.fromSeed(seed.slice(0, 32));
}

/** Base58 Solana address for the uncompressed stealth pubkey. */
export function deriveStealthSolanaAddress(
  stealthPubKeyUncompressed: Uint8Array,
): string {
  return deriveStealthSolanaKeypair(stealthPubKeyUncompressed).publicKey.toBase58();
}

/**
 * Derive the deterministic Solana keypair from a reconstructed 32-byte secp256k1 stealth
 * private key (recipient side).
 */
export function deriveStealthSolanaKeypairFromStealthPrivKey(
  stealthPrivKey: Uint8Array,
): Keypair {
  const uncompressed = secp256k1.getPublicKey(stealthPrivKey, false);
  return deriveStealthSolanaKeypair(uncompressed);
}

/** Base58 Solana address from a reconstructed 32-byte secp256k1 stealth private key. */
export function deriveStealthSolanaAddressFromStealthPrivKey(
  stealthPrivKey: Uint8Array,
): string {
  const uncompressed = secp256k1.getPublicKey(stealthPrivKey, false);
  return deriveStealthSolanaAddress(uncompressed);
}
