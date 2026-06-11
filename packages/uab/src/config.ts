import type { Address } from "viem";
import { EVM_DEPLOYMENTS } from "@opaquecash/deployments";

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

/** Known UAB deployments by EVM chain id (from the generated `@opaquecash/deployments`). */
export const UAB_DEPLOYMENTS: Record<number, UabDeployment> = Object.fromEntries(
  Object.values(EVM_DEPLOYMENTS).map((d) => [
    d.chainId,
    {
      chainId: d.chainId,
      whChain: d.wormhole.chainId,
      wormholeCore: d.contracts.wormholeCore as Address,
      uabSender: d.contracts.uabSender as Address,
      uabReceiver: d.contracts.uabReceiver as Address,
      sourceWhChain: d.wormhole.sourceChainId,
      fromBlock: d.uabFromBlock,
    },
  ]),
);

export function getUabDeployment(chainId: number): UabDeployment | undefined {
  return UAB_DEPLOYMENTS[chainId];
}

export function requireUabDeployment(chainId: number): UabDeployment {
  const d = UAB_DEPLOYMENTS[chainId];
  if (!d) throw new Error(`No UAB deployment configured for chainId ${chainId}`);
  return d;
}
