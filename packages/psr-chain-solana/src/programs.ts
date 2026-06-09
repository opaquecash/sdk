/**
 * PSR Solana program ids, sourced from the centralized {@link getSolanaDeployment} so addresses
 * live in one place (`@opaquecash/stealth-chain-solana`).
 */

import { PublicKey } from "@solana/web3.js";
import {
  getSolanaDeployment,
  type SolanaCluster,
} from "@opaquecash/stealth-chain-solana";

/** The four PSR-relevant Solana program ids. */
export interface PsrSolanaPrograms {
  schemaRegistry: PublicKey;
  attestationEngineV2: PublicKey;
  reputationVerifier: PublicKey;
  groth16Verifier: PublicKey;
}

/** Resolve the PSR program ids for a cluster (default devnet) from the bundled deployment. */
export function getPsrSolanaPrograms(cluster: SolanaCluster = "devnet"): PsrSolanaPrograms {
  const d = getSolanaDeployment(cluster);
  return {
    schemaRegistry: d.schemaRegistry,
    attestationEngineV2: d.attestationEngineV2,
    reputationVerifier: d.reputationVerifier,
    groth16Verifier: d.groth16Verifier,
  };
}
