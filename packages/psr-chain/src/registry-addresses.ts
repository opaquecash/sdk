/**
 * Bundled EVM PSR V2 deployments (schema registry, attestation registry, Groth16 verifier,
 * reputation verifier). Addresses MUST match
 * `ethereum/frontend/src/contracts/reputation-v2-addresses.json`.
 */

import type { Address } from "viem";

/** Resolved V2 PSR contract bundle for one chain. */
export interface PsrV2Config {
  schemaRegistry: Address;
  attestationRegistry: Address;
  groth16VerifierV2: Address;
  reputationVerifierV2: Address;
  /** Block the V2 PSR stack was deployed at; never scan logs before it. */
  fromBlock: bigint;
}

/** Sepolia V2 PSR deployment. */
const SEPOLIA_PSR_V2: PsrV2Config = {
  schemaRegistry: "0xAA5F3942117bD48E7Cd81A500A8b7Bbb122ae80f" as Address,
  attestationRegistry: "0x049aF9CBB62387034CDd5403794a94E9c000ACCc" as Address,
  groth16VerifierV2: "0x49A212bdbc52F1cb6C93623FC7814a61Fc71ddB5" as Address,
  reputationVerifierV2: "0x18cEc2812953c2E9bcADE20CbF6415BD36aEb44f" as Address,
  fromBlock: 11_019_444n,
};

const PSR_V2_CONFIGS: Record<number, PsrV2Config> = {
  11155111: SEPOLIA_PSR_V2,
};

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
