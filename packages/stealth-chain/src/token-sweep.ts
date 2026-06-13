/**
 * Sweep an ERC-20 balance out of a one-time stealth address. The reconstructed stealth key signs
 * the `transfer`, so the on-chain `from` is the stealth address itself (preserving unlinkability).
 *
 * Unlike the native sweep, an ERC-20 transfer still costs native gas paid by the stealth address.
 * A freshly funded stealth address usually holds only the token and no native asset, so a
 * self-funded sweep requires the address to have been given a small gas top-up first. The gasless
 * alternative (a relayer pays gas and is reimbursed in the token) lives in the relayer market;
 * see `@opaquecash/relayer-client`.
 */

import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Minimal ERC-20 surface used for token sweeps. */
export const erc20SweepAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** EIP-1559 or legacy gas fields resolved for the token sweep. */
export type TokenSweepFees =
  | { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { gasPrice: bigint };

/** A prepared ERC-20 sweep (read + estimate only; nothing sent). */
export interface EvmStealthTokenSweepPlan {
  from: Address;
  to: Address;
  token: Address;
  /** Token amount transferred (full balance unless `amount` was capped). */
  amount: bigint;
  /** Token balance held by the stealth address. */
  tokenBalance: bigint;
  /** Native balance held by the stealth address (must cover `gasCost`). */
  nativeBalance: bigint;
  gas: bigint;
  gasCost: bigint;
  fees: TokenSweepFees;
}

function normalizeKey(stealthPrivKey: Hex | Uint8Array): Hex {
  if (stealthPrivKey instanceof Uint8Array) {
    let s = "0x";
    for (const b of stealthPrivKey) s += b.toString(16).padStart(2, "0");
    return s as Hex;
  }
  return (stealthPrivKey.startsWith("0x") ? stealthPrivKey : `0x${stealthPrivKey}`) as Hex;
}

async function resolveFees(
  publicClient: PublicClient,
): Promise<{ fees: TokenSweepFees; gasPrice: bigint }> {
  const estimated = await publicClient.estimateFeesPerGas().catch(() => null);
  if (estimated && "maxFeePerGas" in estimated && estimated.maxFeePerGas != null) {
    return {
      fees: {
        maxFeePerGas: estimated.maxFeePerGas,
        maxPriorityFeePerGas: estimated.maxPriorityFeePerGas,
      },
      gasPrice: estimated.maxFeePerGas,
    };
  }
  const gasPrice = await publicClient.getGasPrice();
  return { fees: { gasPrice }, gasPrice };
}

/**
 * Plan an ERC-20 sweep: read the token and native balances, estimate the transfer gas, and verify
 * the stealth address holds enough native asset to cover it. Read-only; does not sign or broadcast.
 *
 * @param params.amount - Optional cap; defaults to the full token balance. Capped to the balance.
 */
export async function planStealthTokenSweep(
  publicClient: PublicClient,
  params: {
    stealthPrivKey: Hex | Uint8Array;
    token: Address;
    destination: Address;
    amount?: bigint;
  },
): Promise<EvmStealthTokenSweepPlan> {
  const account = privateKeyToAccount(normalizeKey(params.stealthPrivKey));

  const tokenBalance = (await publicClient.readContract({
    address: params.token,
    abi: erc20SweepAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (tokenBalance === 0n) {
    throw new Error("Stealth address holds none of this token.");
  }
  const amount =
    params.amount != null && params.amount < tokenBalance ? params.amount : tokenBalance;

  const data = encodeFunctionData({
    abi: erc20SweepAbi,
    functionName: "transfer",
    args: [params.destination, amount],
  });

  const nativeBalance = await publicClient.getBalance({ address: account.address });
  const gas = await publicClient.estimateGas({
    account: account.address,
    to: params.token,
    data,
  });
  const { fees, gasPrice } = await resolveFees(publicClient);
  const gasCost = gas * gasPrice;
  if (gasCost > nativeBalance) {
    throw new Error(
      "Stealth address lacks native gas for an ERC-20 sweep. Top up a small amount of the " +
        "native asset, or use a relayer-sponsored sweep that takes its fee in the token.",
    );
  }

  return {
    from: account.address,
    to: params.destination,
    token: params.token,
    amount,
    tokenBalance,
    nativeBalance,
    gas,
    gasCost,
    fees,
  };
}

/**
 * Sweep an ERC-20 balance from a stealth address to `destination`, signed by the reconstructed
 * stealth key. Returns the transaction hash.
 *
 * @param params.rpcUrl - RPC URL for the wallet transport (the public client's URL is not exposed).
 */
export async function sweepStealthToken(
  publicClient: PublicClient,
  params: {
    stealthPrivKey: Hex | Uint8Array;
    token: Address;
    destination: Address;
    rpcUrl: string;
    amount?: bigint;
  },
): Promise<Hash> {
  const account = privateKeyToAccount(normalizeKey(params.stealthPrivKey));
  const plan = await planStealthTokenSweep(publicClient, {
    stealthPrivKey: params.stealthPrivKey,
    token: params.token,
    destination: params.destination,
    amount: params.amount,
  });

  const data = encodeFunctionData({
    abi: erc20SweepAbi,
    functionName: "transfer",
    args: [plan.to, plan.amount],
  });

  const walletClient = createWalletClient({
    account,
    chain: publicClient.chain ?? undefined,
    transport: http(params.rpcUrl),
  });

  return walletClient.sendTransaction({
    account,
    chain: publicClient.chain ?? undefined,
    to: params.token,
    data,
    gas: plan.gas,
    ...plan.fees,
  } as Parameters<typeof walletClient.sendTransaction>[0]);
}
