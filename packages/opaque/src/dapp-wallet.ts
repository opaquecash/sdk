/**
 * Per-dApp wallet derivation (CSAP §2.10) — deterministic, origin-isolated EVM/Solana
 * identities from the `dappRoot` HKDF branch. Pure functions, no network access.
 *
 * These are NOT stealth addresses: they are plain per-origin accounts a user transacts
 * *from*, funded privately via stealth sweeps. `dappRoot` is a one-way sibling of the
 * spending key, so a leaked per-dApp key reveals nothing about stealth funds.
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import { Keypair } from "@solana/web3.js";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveKeysFromSignature } from "./crypto/dksap.js";

const EVM_INFO = "opaque-dapp-evm-v1";
const SOLANA_INFO = "opaque-dapp-sol-v1";

/** Origin → key policy. Persistent reuses one address; ephemeral is per-session; linked aliases another origin. */
export type DappMode = "persistent" | "ephemeral" | "linked";

/** Options selecting the non-persistent modes of {@link DappMode}. */
export interface DappKeyOptions {
  /**
   * Ephemeral mode: a session-scoped nonce mixed into the salt. Two nonces yield two
   * unrelated addresses for the same origin. Discarding a nonce orphans any funds still
   * on its address — sweep residue out first.
   */
  sessionNonce?: string;
  /**
   * Linked mode: derive the key of THIS origin instead (user-declared "treat site B as
   * site A"). Normalized like the primary origin. Ignores `sessionNonce` precedence-wise:
   * pass one or the other.
   */
  aliasTarget?: string;
}

/**
 * Canonicalize a dApp origin to `scheme://host[:port]`: lowercase scheme + host, default
 * ports stripped, path/query/hash dropped. Throws on opaque or unparsable origins so a
 * malformed input can never silently derive a key.
 */
export function normalizeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Opaque: invalid dApp origin "${raw}"`);
  }
  // URL.origin lowercases scheme/host and strips default ports; "null" means an
  // opaque origin (data:, file inside sandbox, …) that must never key a wallet.
  if (url.origin === "null") {
    throw new Error(`Opaque: origin "${raw}" is opaque; refusing to derive a dApp key`);
  }
  return url.origin;
}

/**
 * The 32-byte per-dApp identity root — `okm[96:128]` of the `opaque-cash-v1` expansion.
 * Same input signature as {@link deriveKeysFromSignature}.
 */
export function deriveDappRoot(signatureHex: Hex): Uint8Array {
  return deriveKeysFromSignature(signatureHex).dappRoot;
}

function originSalt(origin: string, opts?: DappKeyOptions): Uint8Array {
  const target = normalizeOrigin(opts?.aliasTarget ?? origin);
  const preimage =
    opts?.aliasTarget === undefined && opts?.sessionNonce !== undefined
      ? `${target}:${opts.sessionNonce}`
      : target;
  return keccak_256(new TextEncoder().encode(preimage));
}

/**
 * Deterministic per-origin secp256k1 key for EVM dApp identity:
 * `HKDF-SHA256(dappRoot, keccak256(origin), "opaque-dapp-evm-v1", 32)` reduced mod n.
 */
export function deriveDappEvmKey(
  dappRoot: Uint8Array,
  origin: string,
  opts?: DappKeyOptions,
): { privateKey: Hex; address: Address } {
  const okm = hkdf(sha256, dappRoot, originSalt(origin, opts), EVM_INFO, 32);
  const scalar = bytesToBigInt(okm) % secp256k1.CURVE.n;
  if (scalar === 0n) {
    // Probability ~2^-224; refuse rather than substitute a biased fallback.
    throw new Error("Opaque: derived dApp key reduced to zero; use a different origin/nonce");
  }
  const privateKey = (`0x${scalar.toString(16).padStart(64, "0")}`) as Hex;
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

/**
 * Deterministic per-origin ed25519 keypair for Solana dApp identity:
 * `HKDF-SHA256(dappRoot, keccak256(origin), "opaque-dapp-sol-v1", 32)` as `Keypair.fromSeed`.
 * Independent of the EVM key for the same origin (distinct HKDF info).
 */
export function deriveDappSolanaKeypair(
  dappRoot: Uint8Array,
  origin: string,
  opts?: DappKeyOptions,
): Keypair {
  const seed = hkdf(sha256, dappRoot, originSalt(origin, opts), SOLANA_INFO, 32);
  return Keypair.fromSeed(seed);
}

function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < b.length; i++) x = (x << 8n) | BigInt(b[i]);
  return x;
}
