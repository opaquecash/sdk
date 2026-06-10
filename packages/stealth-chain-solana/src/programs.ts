/**
 * Solana program ids, cluster configuration, and Anchor discriminators for the Opaque
 * stealth registry and announcer.
 *
 * Addresses are the live devnet deployment (see `solana/` repo + memory `phase-1-uab-live`).
 * Override per deployment with {@link SolanaDeployment}; nothing here reads `import.meta.env`
 * or any ambient config — the SDK takes a `Connection`/cluster explicitly.
 */

import { PublicKey } from "@solana/web3.js";

export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

/** Wormhole Core Bridge program on Solana devnet (see memory `phase-1-uab-live`). */
export const WORMHOLE_CORE_DEVNET = "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";

/** Resolved Opaque program ids for a Solana cluster. */
export interface SolanaDeployment {
  cluster: SolanaCluster;
  /** `StealthMetaAddressRegistry` program (ERC-6538 equivalent). */
  stealthRegistry: PublicKey;
  /** `StealthAddressAnnouncer` program (ERC-5564 equivalent). */
  stealthAnnouncer: PublicKey;
  /** PSR V2 schema registry program. */
  schemaRegistry: PublicKey;
  /** PSR V2 attestation engine program. */
  attestationEngineV2: PublicKey;
  /** Groth16 proof verifier program. */
  groth16Verifier: PublicKey;
  /** PSR reputation proof verifier program. */
  reputationVerifier: PublicKey;
  /** Wormhole Core Bridge program (for `announce_with_relay` cross-chain announcements). */
  wormholeCore: PublicKey;
}

/** Devnet program ids (matches `solana/frontend/src/contracts/deployedAddresses.ts`). */
const DEVNET_IDS = {
  stealthRegistry: "E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno",
  stealthAnnouncer: "HGFn2fH7bVQ5cSuiG52NjzN9m11YrB3FZUfoN9b9A5jf",
  schemaRegistry: "FbgMJYGWnLKLcrKYS1NxM5uER1ihQkYLMTLs4STuDMWB",
  attestationEngineV2: "4T9kPCVCFGdEuLpEqRJihsPCbEEo2LWWDEPFvUESEqtM",
  groth16Verifier: "6mFaKyp7F4NqNeoiBLEWSqy5wJSk7rWf1EYumVXgHvhQ",
  reputationVerifier: "BSnkCDoTpgNVN5BbF3aN5L5EJPiaYUkqqj9MHp8kaqWM",
  wormholeCore: WORMHOLE_CORE_DEVNET,
} as const;

function deploymentFromIds(
  cluster: SolanaCluster,
  ids: typeof DEVNET_IDS,
): SolanaDeployment {
  return {
    cluster,
    stealthRegistry: new PublicKey(ids.stealthRegistry),
    stealthAnnouncer: new PublicKey(ids.stealthAnnouncer),
    schemaRegistry: new PublicKey(ids.schemaRegistry),
    attestationEngineV2: new PublicKey(ids.attestationEngineV2),
    groth16Verifier: new PublicKey(ids.groth16Verifier),
    reputationVerifier: new PublicKey(ids.reputationVerifier),
    wormholeCore: new PublicKey(ids.wormholeCore),
  };
}

/** Bundled deployments by cluster. Extend as mainnet ids land. */
export const SOLANA_DEPLOYMENTS: Partial<Record<SolanaCluster, SolanaDeployment>> = {
  devnet: deploymentFromIds("devnet", DEVNET_IDS),
};

/**
 * Resolve the bundled {@link SolanaDeployment} for a cluster (default `devnet`), or throw
 * if no addresses are bundled for it.
 */
export function getSolanaDeployment(cluster: SolanaCluster = "devnet"): SolanaDeployment {
  const d = SOLANA_DEPLOYMENTS[cluster];
  if (!d) {
    throw new Error(
      `No bundled Opaque Solana deployment for cluster "${cluster}"; pass a deployment override.`,
    );
  }
  return d;
}

/** Public JSON-RPC endpoint per cluster (override with your own RPC for real limits). */
export const CLUSTER_ENDPOINTS: Record<SolanaCluster, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};

/** Stealth scheme id: secp256k1 with view tags (EIP-5564 scheme 1). */
export const SCHEME_ID_SECP256K1 = 1n;

// ---------------------------------------------------------------------------
// Anchor discriminators (from `solana/target/idl/stealth_announcer.json` and the
// deployed registry program). First 8 bytes of the instruction / event data.
// ---------------------------------------------------------------------------

/** `stealth_announcer::announce` instruction discriminator. */
export const ANNOUNCE_DISCRIMINATOR = Uint8Array.from([7, 30, 100, 250, 110, 253, 3, 149]);

/** `stealth_announcer::announce_with_relay` instruction discriminator (cross-chain UAB). */
export const ANNOUNCE_WITH_RELAY_DISCRIMINATOR = Uint8Array.from([3, 242, 201, 249, 200, 171, 146, 79]);

/** `stealth_registry::register_keys` instruction discriminator. */
export const REGISTER_KEYS_DISCRIMINATOR = Uint8Array.from([0x29, 0x44, 0x64, 0x7d, 0x76, 0x2e, 0xfc, 0x84]);

/** Anchor `emit!`-ed `Announcement` event discriminator (prefixes the `Program data:` log). */
export const ANNOUNCEMENT_EVENT_DISCRIMINATOR = Uint8Array.from([7, 44, 132, 71, 104, 35, 168, 60]);

/** PDA seed prefix for a registry entry: `["stealth_meta", registrant, schemeId_le]`. */
export const REGISTRY_ENTRY_SEED = "stealth_meta";
