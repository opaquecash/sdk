import type { Address } from "viem";
import type { TrackedToken } from "@opaquecash/stealth-balance";

/** Sentinel for native ETH in balance aggregation (not a contract). */
export const NATIVE_TOKEN_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

/**
 * Contract bundle for one chain (Opaque deployments).
 */
export interface OpaqueChainDeployment {
  chainId: number;
  name: string;
  stealthMetaAddressRegistry: Address;
  stealthAddressAnnouncer: Address;
  /** Optional PSR verifier; omitted if not deployed. */
  opaqueReputationVerifier?: Address;
  /** Default tokens merged with `OpaqueClientConfig.trackedTokens`. */
  defaultTrackedTokens: TrackedToken[];
}

const sepolia: OpaqueChainDeployment = {
  chainId: 11155111,
  name: "Sepolia",
  stealthMetaAddressRegistry:
    "0x77425e04163d608B876c7f50E34A378624A12067" as Address,
  stealthAddressAnnouncer:
    "0x840f72249A8bF6F10b0eB64412E315efBD730865" as Address,
  opaqueReputationVerifier:
    "0x30B750Ae9851e104F8dbB4B8082b1a07a34885B0" as Address,
  defaultTrackedTokens: [
    {
      address: NATIVE_TOKEN_ADDRESS,
      symbol: "ETH",
      decimals: 18,
    },
    {
      address: "0x73197e8303904862d543f9706E8422F634D713cb" as Address,
      symbol: "USDC",
      decimals: 6,
    },
    {
      address: "0x6Ff8Afb2aA9eB5A89Ce86c44DD460bD17C92f644" as Address,
      symbol: "USDT",
      decimals: 6,
    },
  ],
};

const DEPLOYMENTS: Record<number, OpaqueChainDeployment> = {
  11155111: sepolia,
};

/**
 * Chain IDs with bundled Opaque contract addresses.
 */
export function getSupportedChainIds(): number[] {
  return Object.keys(DEPLOYMENTS).map(Number);
}

/**
 * Resolve deployment metadata for a chain, or `undefined` if unknown.
 */
export function getChainDeployment(
  chainId: number,
): OpaqueChainDeployment | undefined {
  return DEPLOYMENTS[chainId];
}

/**
 * Require a known deployment or throw.
 */
export function requireChainDeployment(chainId: number): OpaqueChainDeployment {
  const d = DEPLOYMENTS[chainId];
  if (!d) {
    throw new Error(
      `Opaque: unsupported chainId ${chainId}. Supported: ${getSupportedChainIds().join(", ")}`,
    );
  }
  return d;
}
