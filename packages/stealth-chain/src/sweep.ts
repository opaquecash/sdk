/**
 * Sweep native ETH out of a one-time stealth address. The reconstructed stealth key signs the
 * transfer, so the on-chain `from` is the stealth address itself (preserving unlinkability).
 * Full-balance sweep deducts the exact gas cost. Ported from
 * `ethereum/frontend/src/lib/stealthLifecycle.ts`.
 */

import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** EIP-1559 or legacy gas fields resolved for the sweep. */
export type SweepFees =
  | { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { gasPrice: bigint };

/** A prepared full-balance sweep (read + estimate only; nothing sent). */
export interface EvmStealthSweepPlan {
  from: Address;
  to: Address;
  balance: bigint;
  gas: bigint;
  gasCost: bigint;
  /** Sendable amount = balance - gasCost. */
  value: bigint;
  fees: SweepFees;
}

function normalizeKey(stealthPrivKey: Hex | Uint8Array): Hex {
  if (stealthPrivKey instanceof Uint8Array) {
    let s = "0x";
    for (const b of stealthPrivKey) s += b.toString(16).padStart(2, "0");
    return s as Hex;
  }
  return (stealthPrivKey.startsWith("0x") ? stealthPrivKey : `0x${stealthPrivKey}`) as Hex;
}

/**
 * Plan a full-balance native sweep: balance, gas limit, gas price (EIP-1559 when available),
 * and the resulting sendable value. Read-only — does not sign or broadcast.
 */
export async function planStealthSweep(
  publicClient: PublicClient,
  params: { stealthPrivKey: Hex | Uint8Array; destination: Address },
): Promise<EvmStealthSweepPlan> {
  const account = privateKeyToAccount(normalizeKey(params.stealthPrivKey));
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error("Stealth address has zero balance.");
  }

  const gas = await publicClient.estimateGas({
    account: account.address,
    to: params.destination,
    value: 1n,
    data: "0x",
  });

  let fees: SweepFees;
  let gasPrice: bigint;
  const estimated = await publicClient.estimateFeesPerGas().catch(() => null);
  if (estimated && "maxFeePerGas" in estimated && estimated.maxFeePerGas != null) {
    fees = {
      maxFeePerGas: estimated.maxFeePerGas,
      maxPriorityFeePerGas: estimated.maxPriorityFeePerGas,
    };
    gasPrice = estimated.maxFeePerGas;
  } else {
    gasPrice = await publicClient.getGasPrice();
    fees = { gasPrice };
  }

  const gasCost = gas * gasPrice;
  if (gasCost >= balance) {
    throw new Error("Insufficient funds to cover gas fees.");
  }

  return {
    from: account.address,
    to: params.destination,
    balance,
    gas,
    gasCost,
    value: balance - gasCost,
    fees,
  };
}

/**
 * Sweep the full native balance of a stealth address to `destination`, signed by the
 * reconstructed stealth key. Returns the transaction hash.
 *
 * @param rpcUrl - RPC URL for the wallet transport (the public client's URL is not exposed).
 */
export async function sweepStealthNative(
  publicClient: PublicClient,
  params: {
    stealthPrivKey: Hex | Uint8Array;
    destination: Address;
    rpcUrl: string;
  },
): Promise<Hash> {
  const account = privateKeyToAccount(normalizeKey(params.stealthPrivKey));
  const plan = await planStealthSweep(publicClient, {
    stealthPrivKey: params.stealthPrivKey,
    destination: params.destination,
  });

  const walletClient = createWalletClient({
    account,
    chain: publicClient.chain ?? undefined,
    transport: http(params.rpcUrl),
  });

  return walletClient.sendTransaction({
    account,
    chain: publicClient.chain ?? undefined,
    to: params.destination,
    value: plan.value,
    data: "0x",
    gas: plan.gas,
    ...plan.fees,
  } as Parameters<typeof walletClient.sendTransaction>[0]);
}
