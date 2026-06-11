/**
 * Bundled EVM PSR V2 deployments (schema registry, attestation registry, Groth16 verifier,
 * reputation verifier), sourced from the generated `@opaquecash/deployments` registry.
 */

import type { Address } from "viem";
import { EVM_DEPLOYMENTS } from "@opaquecash/deployments";

/** Resolved V2 PSR contract bundle for one chain. */
export interface PsrV2Config {
  schemaRegistry: Address;
  attestationRegistry: Address;
  groth16VerifierV2: Address;
  reputationVerifierV2: Address;
  /** Block the V2 PSR stack was deployed at; never scan logs before it. */
  fromBlock: bigint;
}

const PSR_V2_CONFIGS: Record<number, PsrV2Config> = Object.fromEntries(
  Object.values(EVM_DEPLOYMENTS).map((d) => [
    d.chainId,
    {
      schemaRegistry: d.contracts.opaqueSchemaRegistry as Address,
      attestationRegistry: d.contracts.opaqueAttestationRegistry as Address,
      groth16VerifierV2: d.contracts.groth16VerifierV2 as Address,
      reputationVerifierV2: d.contracts.opaqueReputationVerifierV2 as Address,
      fromBlock: d.psrFromBlock,
    },
  ]),
);

/** Chain ids with a bundled V2 PSR deployment. */
export function getPsrV2ChainIds(): number[] {
  return Object.keys(PSR_V2_CONFIGS).map(Number);
}

/** Resolve the bundled {@link PsrV2Config} for a chain, or `null` if none. */
export function getPsrV2Config(chainId: number | null | undefined): PsrV2Config | null {
  if (chainId == null) return null;
  return PSR_V2_CONFIGS[chainId] ?? null;
}

/** Resolve the bundled {@link PsrV2Config} for a chain, or throw. */
export function requirePsrV2Config(chainId: number): PsrV2Config {
  const cfg = getPsrV2Config(chainId);
  if (!cfg) {
    throw new Error(
      `Opaque PSR: no V2 schema/attestation registry bundled for chainId ${chainId}. Supported: ${getPsrV2ChainIds().join(", ")}`,
    );
  }
  return cfg;
}
