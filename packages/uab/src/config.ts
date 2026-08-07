import type { Address } from "viem";
import { EVM_DEPLOYMENTS, type EvmDeployment } from "@opaquecash/deployments";

/** Wormhole chain ids used by Opaque deployments. */
export const WORMHOLE_CHAIN = { ethereum: 2, solana: 1 } as const;

/** Consistency levels for `announceWithRelay` (EVM). */
export const CONSISTENCY_FINALIZED = 200;
export const CONSISTENCY_SAFE = 201;

/** Wormholescan API bases. */
export const WORMHOLESCAN_TESTNET = "https://api.testnet.wormholescan.io";
export const WORMHOLESCAN_MAINNET = "https://api.wormholescan.io";

/** A UAB deployment on one EVM chain. */
export interface UabDeployment {
  chainId: number;
  /** Wormhole chain id of THIS chain. */
  whChain: number;
  wormholeCore: Address;
  uabSender: Address;
  uabReceiver: Address;
  /** Wormhole chain id of the trusted cross-chain source (the other chain). */
  sourceWhChain: number;
  /** Block the UAB contracts were deployed at — never scan before this. */
  fromBlock: bigint;
}

/**
 * Zero-address placeholder the deployments generator writes for contract slots a chain
 * omits. Kept local (rather than imported) so this package compiles against registry
 * builds of `@opaquecash/deployments` that predate the exported constant.
 */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Map one generated EVM deployment record onto a {@link UabDeployment}, or `undefined`
 * when the chain has no UAB stack. Stealth-only chains (e.g. ones reusing the canonical
 * ERC-5564/ERC-6538 singletons) carry zero-address placeholders in the generated
 * registry; treating them as absent keeps cross-chain scans from targeting the zero
 * address and keeps `scan()`'s cross-chain default off on those chains.
 */
export function toUabDeployment(d: EvmDeployment): UabDeployment | undefined {
  const { uabSender, uabReceiver, wormholeCore } = d.contracts;
  if (
    uabSender === ZERO_ADDRESS ||
    uabReceiver === ZERO_ADDRESS ||
    wormholeCore === ZERO_ADDRESS
  ) {
    return undefined;
  }
  return {
    chainId: d.chainId,
    whChain: d.wormhole.chainId,
    wormholeCore: wormholeCore as Address,
    uabSender: uabSender as Address,
    uabReceiver: uabReceiver as Address,
    sourceWhChain: d.wormhole.sourceChainId,
    fromBlock: d.uabFromBlock,
  };
}

/** Known UAB deployments by EVM chain id (from the generated `@opaquecash/deployments`). */
export const UAB_DEPLOYMENTS: Record<number, UabDeployment> = Object.fromEntries(
  Object.values(EVM_DEPLOYMENTS).flatMap((d) => {
    const uab = toUabDeployment(d);
    return uab ? [[d.chainId, uab]] : [];
  }),
);

export function getUabDeployment(chainId: number): UabDeployment | undefined {
  return UAB_DEPLOYMENTS[chainId];
}

export function requireUabDeployment(chainId: number): UabDeployment {
  const d = UAB_DEPLOYMENTS[chainId];
  if (!d) throw new Error(`No UAB deployment configured for chainId ${chainId}`);
  return d;
}
