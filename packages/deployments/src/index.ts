/**
 * `@opaquecash/deployments` — the generated Opaque deployment registry.
 *
 * Data files under `generated/` are written by the chain repos:
 *   - `ethereum/infra`: `npm run generate` (addresses from `infra/deployments/*.json`,
 *     ABIs from hardhat artifacts)
 *   - `solana`: `npm run generate` (program ids from `Anchor.toml`)
 *
 * Higher SDK packages (`@opaquecash/opaque`, `@opaquecash/uab`,
 * `@opaquecash/stealth-chain-solana`, `@opaquecash/psr-chain`) source their bundled
 * addresses from here, so a redeploy is a regenerate + rebuild, not a code change.
 */

export type {
  DeployedToken,
  EvmAddress,
  EvmContracts,
  EvmDeployment,
  OnsDeployment,
  SolanaProgramIds,
} from "./types.js";

import { EVM_DEPLOYMENTS } from "./generated/ethereum.js";
import { ONS_DEPLOYMENTS } from "./generated/ons.js";
import { SOLANA_PROGRAM_IDS } from "./generated/solana.js";
import type { EvmDeployment, OnsDeployment, SolanaProgramIds } from "./types.js";

export { EVM_DEPLOYMENTS, ONS_DEPLOYMENTS, SOLANA_PROGRAM_IDS };
export * from "./generated/abis.js";

/** Chain ids with a bundled EVM deployment. */
export function getEvmChainIds(): number[] {
  return Object.keys(EVM_DEPLOYMENTS).map(Number);
}

/** Resolve the bundled EVM deployment for a chain id, or `undefined`. */
export function getEvmDeployment(chainId: number): EvmDeployment | undefined {
  return EVM_DEPLOYMENTS[chainId];
}

/** Resolve the bundled EVM deployment for a chain id, or throw. */
export function requireEvmDeployment(chainId: number): EvmDeployment {
  const d = EVM_DEPLOYMENTS[chainId];
  if (!d) {
    throw new Error(
      `@opaquecash/deployments: no EVM deployment for chainId ${chainId}. Bundled: ${getEvmChainIds().join(", ")}`,
    );
  }
  return d;
}

/** Clusters with bundled Solana program ids. */
export function getSolanaClusters(): string[] {
  return Object.keys(SOLANA_PROGRAM_IDS);
}

/** Resolve the bundled Solana program ids for a cluster, or `undefined`. */
export function getSolanaProgramIds(cluster: string): SolanaProgramIds | undefined {
  return SOLANA_PROGRAM_IDS[cluster];
}

/** Resolve the bundled Solana program ids for a cluster, or throw. */
export function requireSolanaProgramIds(cluster: string): SolanaProgramIds {
  const d = SOLANA_PROGRAM_IDS[cluster];
  if (!d) {
    throw new Error(
      `@opaquecash/deployments: no Solana program ids for cluster "${cluster}". Bundled: ${getSolanaClusters().join(", ")}`,
    );
  }
  return d;
}

/** Resolve the bundled ONS deployment for a canonical chain id, or `undefined`. */
export function getOnsDeployment(chainId: number): OnsDeployment | undefined {
  return ONS_DEPLOYMENTS[chainId];
}
