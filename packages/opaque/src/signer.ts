/**
 * Unified signer abstraction (Phase 2.5): one adapter shape over EIP-1193
 * (`personal_sign`) and Solana wallet-adapter (`signMessage`), so integrators hand
 * {@link OpaqueClient.fromWallet} whatever wallet they have and get a fully wired
 * client back — setup-signature prompt, key derivation, and per-chain write signers.
 */

import type { Address, EIP1193Provider, Hex, WalletClient } from "viem";
import { stringToHex } from "viem";
import type { PublicKey, Transaction } from "@solana/web3.js";
import { SETUP_MESSAGE } from "./crypto/dksap.js";

/** An Ethereum wallet in unified shape: EIP-1193 provider or a pre-built viem WalletClient. */
export interface EvmUnifiedSigner {
  chain: "ethereum";
  /** Account that signs the setup message and transactions. */
  address: Address;
  /** EIP-1193 provider (`window.ethereum`, a connector bridge, …). */
  provider?: EIP1193Provider;
  /** Alternative to `provider`: a viem WalletClient (e.g. wagmi's, or `privateKeyToAccount`). */
  walletClient?: WalletClient;
}

/** A Solana wallet in unified shape (wallet-adapter compatible). */
export interface SolanaUnifiedSigner {
  chain: "solana";
  publicKey: PublicKey | string;
  /** wallet-adapter `signMessage`; required only when this wallet derives the keys. */
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  /** wallet-adapter `signTransaction`; required for Solana writes. */
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
}

/** One wallet, either chain — the single shape integrators pass around. */
export type UnifiedSigner = EvmUnifiedSigner | SolanaUnifiedSigner;

/**
 * Prompt `signer` for the canonical {@link SETUP_MESSAGE} signature used as HKDF
 * entropy for the viewing/spending keys. Ethereum signs via `personal_sign`
 * (WalletClient when given, raw EIP-1193 otherwise); Solana signs the UTF-8 bytes
 * via wallet-adapter `signMessage`. The signature never goes on-chain.
 */
export async function requestSetupSignature(signer: UnifiedSigner): Promise<Hex> {
  if (signer.chain === "ethereum") {
    if (signer.walletClient) {
      return (await signer.walletClient.signMessage({
        account: signer.walletClient.account ?? signer.address,
        message: SETUP_MESSAGE,
      })) as Hex;
    }
    if (signer.provider) {
      return (await signer.provider.request({
        method: "personal_sign",
        params: [stringToHex(SETUP_MESSAGE), signer.address],
      })) as Hex;
    }
    throw new Error(
      "Opaque: Ethereum unified signer needs a `provider` (EIP-1193) or `walletClient`.",
    );
  }
  if (signer.chain === "solana") {
    if (!signer.signMessage) {
      throw new Error(
        "Opaque: Solana unified signer needs `signMessage` to derive keys (or pass a cached walletSignature).",
      );
    }
    const sig = await signer.signMessage(new TextEncoder().encode(SETUP_MESSAGE));
    return (`0x${Array.from(sig)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`) as Hex;
  }
  throw new Error(
    `Opaque: unsupported unified signer chain "${(signer as { chain: string }).chain}".`,
  );
}

/** Pick the first signer for a chain out of a one-or-many `wallets` argument. */
export function selectSigner<C extends UnifiedSigner["chain"]>(
  wallets: UnifiedSigner | UnifiedSigner[],
  chain: C,
): Extract<UnifiedSigner, { chain: C }> | undefined {
  const list = Array.isArray(wallets) ? wallets : [wallets];
  return list.find((w) => w.chain === chain) as
    | Extract<UnifiedSigner, { chain: C }>
    | undefined;
}
