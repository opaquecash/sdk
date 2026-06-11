/**
 * Types for the generated deployment registry. The data files in `generated/` are
 * emitted by the chain repos (`ethereum/infra` and `solana`) via `npm run generate`;
 * everything else in this package is hand-written.
 */

/** `0x`-prefixed 20-byte EVM address (no viem dependency; assignable to viem's `Address`). */
export type EvmAddress = `0x${string}`;

/** An ERC-20 (or the zero-address native sentinel) tracked by default on a chain. */
export interface DeployedToken {
  address: EvmAddress;
  symbol: string;
  decimals: number;
  /** True for the zero-address native-asset sentinel. */
  native?: boolean;
}

/** All Opaque contract addresses on one EVM chain. */
export interface EvmContracts {
  stealthMetaAddressRegistry: EvmAddress;
  stealthAddressAnnouncer: EvmAddress;
  opaqueSchemaRegistry: EvmAddress;
  opaqueAttestationRegistry: EvmAddress;
  opaqueReputationVerifierV2: EvmAddress;
  groth16VerifierV2: EvmAddress;
  uabSender: EvmAddress;
  uabReceiver: EvmAddress;
  /** Wormhole Core Bridge (external well-known contract). */
  wormholeCore: EvmAddress;
}

/** One EVM chain's Opaque deployment record. */
export interface EvmDeployment {
  chainId: number;
  name: string;
  contracts: EvmContracts;
  /** Wormhole ids: this chain and the trusted cross-chain source. */
  wormhole: { chainId: number; sourceChainId: number };
  /** Block the V2 PSR stack was deployed at; never scan PSR logs before it. */
  psrFromBlock: bigint;
  /** Block the UAB contracts were deployed at; never scan UAB logs before it. */
  uabFromBlock: bigint;
  /** Default tracked tokens for balance aggregation. */
  tokens: DeployedToken[];
}

/** Opaque program ids (base58) on one Solana cluster. */
export interface SolanaProgramIds {
  cluster: string;
  stealthRegistry: string;
  stealthAnnouncer: string;
  schemaRegistry: string;
  attestationEngineV2: string;
  groth16Verifier: string;
  reputationVerifier: string;
  uabReceiver: string;
  /** Wormhole Core Bridge program (external well-known program). */
  wormholeCore: string;
}
