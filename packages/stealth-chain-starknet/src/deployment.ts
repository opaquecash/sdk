/**
 * Starknet deployments of the Opaque stealth layer.
 *
 * Chain id: Wormhole has no Starknet allocation, so Opaque assigns `0x534e`
 * ("SN"), following the CSAP §2.6 convention that gave Solana `0x534F` ("SO").
 * It is far outside Wormhole's registered range, so `Announcement.chainId`
 * values from the three chains never collide.
 */

/** Opaque-assigned chain id for Starknet ("SN"). */
export const OPAQUE_CHAIN_STARKNET = 0x534e;

export interface StarknetDeployment {
  /** Human-readable network name. */
  network: "sepolia";
  /** Default public RPC (JSON-RPC 0.10.x); override per client as needed. */
  nodeUrl: string;
  /** CSAP `StealthAnnouncer` contract. */
  stealthAnnouncer: string;
  /** CSAP `StealthMetaAddressRegistry` contract. */
  stealthRegistry: string;
  /** PSR `OpaqueReputationVerifierV2` wrapper. */
  reputationVerifier: string;
  /** Garaga-generated `Groth16VerifierBN254`. */
  groth16Verifier: string;
  /** Consensus-critical stealth account class (CSAP custody). */
  stealthAccountClassHash: string;
  /** Block the announcer was deployed at (scan lower bound). */
  announcerFromBlock: number;
}

export const STARKNET_SEPOLIA: StarknetDeployment = {
  network: "sepolia",
  nodeUrl: "https://api.zan.top/public/starknet-sepolia/rpc/v0_10",
  stealthAnnouncer:
    "0x003b8258e84e6feec93239b442e6a91f532fda35fed67de4093b1d97150d2aa2",
  stealthRegistry:
    "0x047ff90c491384ecf8dba8b32b1eea7947f850ea92ddc196edcb0f508acff874",
  reputationVerifier:
    "0x017a56e5a3963214781320bb1e007b6b72b97041ab8087261253e80233083eb6",
  groth16Verifier:
    "0x01f339dfc3a1509bc3ccd1c7ea1a19c07bc0f89ad7378b505b3edc5f5b13b02e",
  stealthAccountClassHash:
    "0x04794bab07198e0585d2d7951dbc5860fba47fea2a15d227ca3237b7b9e484ed",
  announcerFromBlock: 12_158_000,
};

export function getStarknetDeployment(network: "sepolia"): StarknetDeployment {
  if (network !== "sepolia") {
    throw new Error(`Unsupported Starknet network: ${network}`);
  }
  return STARKNET_SEPOLIA;
}
