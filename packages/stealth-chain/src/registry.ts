import type {
  PublicClient,
  WalletClient,
  Address,
  Hex,
  Chain,
  Transport,
  Account,
} from "viem";
import { stealthMetaAddressRegistryAbi } from "./abis.js";

/**
 * Register the caller's stealth meta-address on `StealthMetaAddressRegistry`.
 *
 * @param wallet - Viem wallet client with account (must match `registrant` semantics of the registry).
 * @param params - Scheme id and 66-byte meta-address as hex.
 * @returns Transaction hash.
 */
export async function registerStealthMetaAddress<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account | undefined,
>(
  wallet: WalletClient<TTransport, TChain, TAccount>,
  params: {
    registryAddress: Address;
    schemeId: bigint;
    /** `0x` + 132 hex chars (66 bytes compressed V || S). */
    metaAddress: Hex;
    /** Use `registerKeys` vs `register` if your deployment differs; default `registerKeys`. */
    method?: "registerKeys" | "register";
  },
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("Wallet client has no account");
  const fn =
    params.method === "register"
      ? ("register" as const)
      : ("registerKeys" as const);
  const hash = await wallet.writeContract({
    address: params.registryAddress,
    abi: stealthMetaAddressRegistryAbi,
    functionName: fn,
    args: [params.schemeId, params.metaAddress],
    chain: wallet.chain,
    account,
  } as Parameters<typeof wallet.writeContract>[0]);
  return hash;
}

/**
 * Read the registered stealth meta-address bytes for `(registrant, schemeId)`.
 *
 * @returns ABI-encoded bytes (66-byte meta-address) or empty bytes if unset.
 */
export async function getStealthMetaAddress(
  publicClient: PublicClient,
  params: {
    registryAddress: Address;
    registrant: Address;
    schemeId: bigint;
  },
): Promise<Hex> {
  const bytes = await publicClient.readContract({
    address: params.registryAddress,
    abi: stealthMetaAddressRegistryAbi,
    functionName: "stealthMetaAddressOf",
    args: [params.registrant, params.schemeId],
  });
  return bytes as Hex;
}
