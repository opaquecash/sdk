import type {
  PublicClient,
  WalletClient,
  Address,
  Hex,
  Chain,
  Transport,
  Account,
} from "viem";
import { toHex } from "viem";
import type { ProofData } from "@opaquecash/psr-core";
import { NullifierUsedError, RootExpiredError } from "@opaquecash/psr-core";
import { opaqueReputationVerifierAbi } from "./abi.js";

/**
 * Normalize decimal / hex string Merkle roots to `bytes32`.
 *
 * @param root - `publicSignals[2]` or decimal string from an indexer.
 */
export function normalizeRootToBytes32(root: string): Hex {
  try {
    return toHex(BigInt(root), { size: 32 });
  } catch {
    throw new Error(`Invalid merkle root format: "${root}"`);
  }
}

/**
 * Convert {@link ProofData} into the Solidity tuple expected by `verifyReputation`.
 */
export function proofDataToSolidityTuple(proofData: ProofData): {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
} {
  const pi_a = proofData.proof.pi_a.map(BigInt) as [bigint, bigint];
  const pi_b = proofData.proof.pi_b.map(
    (pair: string[]) =>
      [BigInt(pair[1]), BigInt(pair[0])] as [bigint, bigint],
  ) as [[bigint, bigint], [bigint, bigint]];
  const pi_c = proofData.proof.pi_c.map(BigInt) as [bigint, bigint];
  return { a: pi_a, b: pi_b, c: pi_c };
}

export interface VerifyReputationArgs {
  proofData: ProofData;
  /** Merkle root (decimal or hex string). */
  merkleRoot: string;
  externalNullifier: string;
}

/**
 * Simulate `verifyReputation` without sending a transaction (preflight / gas estimation).
 */
export async function simulateVerifyReputation<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account | undefined,
>(
  publicClient: PublicClient,
  wallet: WalletClient<TTransport, TChain, TAccount>,
  verifierAddress: Address,
  args: VerifyReputationArgs,
): Promise<void> {
  const account = wallet.account;
  if (!account) throw new Error("Wallet client has no account");

  const root = normalizeRootToBytes32(args.merkleRoot);
  const tuple = proofDataToSolidityTuple(args.proofData);

  const validRoot = await publicClient.readContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "isRootValid",
    args: [root],
  });
  if (!validRoot) {
    throw new RootExpiredError();
  }

  await publicClient.simulateContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "verifyReputation",
    args: [
      { a: tuple.a, b: tuple.b, c: tuple.c },
      root,
      BigInt(args.proofData.attestationId),
      BigInt(args.externalNullifier),
      BigInt(args.proofData.nullifier),
    ],
    account,
  });
}

/**
 * Submit a Groth16 proof to `OpaqueReputationVerifier.verifyReputation`.
 *
 * @returns Transaction hash after broadcast (does not wait for receipt unless you await downstream).
 */
export async function submitVerifyReputation<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account | undefined,
>(
  publicClient: PublicClient,
  wallet: WalletClient<TTransport, TChain, TAccount>,
  verifierAddress: Address,
  args: VerifyReputationArgs,
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("Wallet client has no account");

  const root = normalizeRootToBytes32(args.merkleRoot);
  const tuple = proofDataToSolidityTuple(args.proofData);

  const validRoot = await publicClient.readContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "isRootValid",
    args: [root],
  });
  if (!validRoot) {
    throw new RootExpiredError();
  }

  await publicClient.simulateContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "verifyReputation",
    args: [
      { a: tuple.a, b: tuple.b, c: tuple.c },
      root,
      BigInt(args.proofData.attestationId),
      BigInt(args.externalNullifier),
      BigInt(args.proofData.nullifier),
    ],
    account,
  });

  const hash = await wallet.writeContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "verifyReputation",
    args: [
      { a: tuple.a, b: tuple.b, c: tuple.c },
      root,
      BigInt(args.proofData.attestationId),
      BigInt(args.externalNullifier),
      BigInt(args.proofData.nullifier),
    ],
    chain: wallet.chain,
    account,
  } as Parameters<typeof wallet.writeContract>[0]);

  return hash;
}

/**
 * Read-only verification path (does not mark nullifier used).
 */
export async function verifyReputationView(
  publicClient: PublicClient,
  verifierAddress: Address,
  args: VerifyReputationArgs,
): Promise<boolean> {
  const root = normalizeRootToBytes32(args.merkleRoot);
  const tuple = proofDataToSolidityTuple(args.proofData);
  return (await publicClient.readContract({
    address: verifierAddress,
    abi: opaqueReputationVerifierAbi,
    functionName: "verifyReputationView",
    args: [
      { a: tuple.a, b: tuple.b, c: tuple.c },
      root,
      BigInt(args.proofData.attestationId),
      BigInt(args.externalNullifier),
      BigInt(args.proofData.nullifier),
    ],
  })) as boolean;
}

/** @internal Map contract revert to typed error where possible */
export function mapVerifierRevert(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("NullifierAlreadyUsed")) return new NullifierUsedError();
  if (msg.includes("InvalidMerkleRoot") || msg.includes("RootExpired"))
    return new RootExpiredError();
  return e instanceof Error ? e : new Error(msg);
}
