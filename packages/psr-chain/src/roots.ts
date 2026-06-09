import type { PublicClient, Address, Hex } from "viem";
import { RootExpiredError } from "@opaquecash/psr-core";
import { opaqueReputationVerifierAbi } from "./abi.js";

/**
 * Return the latest Merkle root from `rootHistory` that {@link isRootValid} still accepts.
 *
 * @param publicClient - Viem public client positioned on the verifier's chain.
 * @param verifierAddress - `OpaqueReputationVerifier` deployment.
 */
export async function fetchLatestValidRoot(
  publicClient: PublicClient,
  verifierAddress: Address,
): Promise<Hex> {
  const rootHistoryLength = await publicClient.readContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "rootHistoryLength",
  });

  const length = Number(rootHistoryLength);
  if (!Number.isFinite(length) || length <= 0) {
    throw new RootExpiredError("No Merkle roots found on verifier contract.");
  }

  for (let i = length - 1; i >= 0; i--) {
    const root = (await publicClient.readContract({
      address: verifierAddress,
      abi: opaqueReputationVerifierAbi,
      functionName: "rootHistory",
      args: [BigInt(i)],
    })) as Hex;
    const valid = (await publicClient.readContract({
      address: verifierAddress,
      abi: opaqueReputationVerifierAbi,
      functionName: "isRootValid",
      args: [root],
    })) as boolean;
    if (valid) return root;
  }

  throw new RootExpiredError(
    "No valid (non-expired) Merkle root found on verifier contract.",
  );
}

/**
 * Read whether a root is currently accepted (exists and not past `ROOT_EXPIRY`).
 */
export async function isRootValid(
  publicClient: PublicClient,
  verifierAddress: Address,
  root: Hex,
): Promise<boolean> {
  return (await publicClient.readContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "isRootValid",
    args: [root],
  })) as boolean;
}

/**
 * Enumerate roots from `rootHistory` with their on-chain validity bit (newest index last).
 *
 * @param publicClient - Viem public client.
 * @param verifierAddress - Verifier contract.
 */
export async function fetchRootHistory(
  publicClient: PublicClient,
  verifierAddress: Address,
): Promise<Array<{ index: number; root: Hex; valid: boolean }>> {
  const len = Number(
    await publicClient.readContract({
      address: verifierAddress,
      abi: opaqueReputationVerifierAbi,
      functionName: "rootHistoryLength",
    }),
  );
  const out: Array<{ index: number; root: Hex; valid: boolean }> = [];
  for (let i = 0; i < len; i++) {
    const root = (await publicClient.readContract({
      address: verifierAddress,
      abi: opaqueReputationVerifierAbi,
      functionName: "rootHistory",
      args: [BigInt(i)],
    })) as Hex;
    const valid = await isRootValid(publicClient, verifierAddress, root);
    out.push({ index: i, root, valid });
  }
  return out;
}
