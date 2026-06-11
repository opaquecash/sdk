/**
 * Runnable example: build an OpaqueClient from a wallet in the unified signer shape.
 * Uses a local viem account, so it runs offline:
 *
 *   npx tsx examples/from-wallet.ts
 *
 * (Run `npm run build` first so the workspace packages resolve to dist.)
 *
 * In a browser you would pass `window.ethereum` instead:
 *   wallets: { chain: "ethereum", address, provider: window.ethereum }
 * or a Solana wallet-adapter:
 *   wallets: { chain: "solana", publicKey, signMessage, signTransaction }
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { OpaqueClient } from "@opaquecash/opaque";

async function main() {
  // Demo key only — never hard-code a real one.
  const account = privateKeyToAccount(("0x" + "42".repeat(32)) as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
  });

  // One adapter shape in; signature prompt + key derivation + signer wiring out.
  const client = await OpaqueClient.fromWallet({
    wallets: { chain: "ethereum", address: account.address, walletClient },
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  });

  console.log("ethereum address :", client.getEthereumAddress());
  console.log("meta-address     :", client.getMetaAddressHex());
  console.log("contracts        :", client.getContracts());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
