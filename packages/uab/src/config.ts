import type { Address } from "viem";

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

/** Known UAB deployments by EVM chain id. */
export const UAB_DEPLOYMENTS: Record<number, UabDeployment> = {
  11155111: {
    chainId: 11155111,
    whChain: WORMHOLE_CHAIN.ethereum,
    wormholeCore: "0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78",
    uabSender: "0x872787c0BD1A0C71e6D1be5a144EB044e0CB2069",
    uabReceiver: "0x9eF189f7a263F870Cf80f9A89d1349A6AF7b15cF",
    sourceWhChain: WORMHOLE_CHAIN.solana,
    fromBlock: 0n,
  },
};

export function getUabDeployment(chainId: number): UabDeployment | undefined {
  return UAB_DEPLOYMENTS[chainId];
}

export function requireUabDeployment(chainId: number): UabDeployment {
  const d = UAB_DEPLOYMENTS[chainId];
  if (!d) throw new Error(`No UAB deployment configured for chainId ${chainId}`);
  return d;
}
