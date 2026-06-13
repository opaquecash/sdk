import type { Address } from "viem";
import type { TrackedToken } from "@opaquecash/stealth-balance";
import {
  EVM_DEPLOYMENTS,
  getEvmChainIds,
  type EvmDeployment,
} from "@opaquecash/deployments";

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
  /** Optional gasless ERC-20 sweep forwarder; omitted if not deployed. */
  stealthTokenSweep?: Address;
  /** Default tokens merged with `OpaqueClientConfig.trackedTokens`. */
  defaultTrackedTokens: TrackedToken[];
}

/** Map a generated {@link EvmDeployment} record onto the client-facing bundle. */
function fromGenerated(d: EvmDeployment): OpaqueChainDeployment {
  return {
    chainId: d.chainId,
    name: d.name,
    stealthMetaAddressRegistry: d.contracts.stealthMetaAddressRegistry,
    stealthAddressAnnouncer: d.contracts.stealthAddressAnnouncer,
    // V2 verifier is canonical (D3); the V1 verifier used an incompatible signal layout.
    opaqueReputationVerifier: d.contracts.opaqueReputationVerifierV2,
    stealthTokenSweep: d.contracts.stealthTokenSweep,
    defaultTrackedTokens: d.tokens.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
    })),
  };
}

const DEPLOYMENTS: Record<number, OpaqueChainDeployment> = Object.fromEntries(
  Object.values(EVM_DEPLOYMENTS).map((d) => [d.chainId, fromGenerated(d)]),
);

/**
 * Chain IDs with bundled Opaque contract addresses.
 */
export function getSupportedChainIds(): number[] {
  return getEvmChainIds();
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
