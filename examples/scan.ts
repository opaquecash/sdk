/**
 * Runnable example: scan the unified cross-chain inbox (Sepolia + Solana devnet) for
 * stealth outputs owned by a wallet. Read-only — no transactions sent.
 *
 *   PRIVATE_KEY=0x… npx tsx examples/scan.ts          # your Sepolia key
 *   npx tsx examples/scan.ts                          # demo key (likely empty inbox)
 *
 * Optional: SEPOLIA_RPC_URL, SOLANA_RPC_URL, FROM_BLOCK.
 * Needs the scanner WASM from the app checkout (../app/public/pkg); run
 * `npm run build` first so the workspace packages resolve to dist.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { initStealthWasm } from "@opaquecash/stealth-wasm";
import { OpaqueClient } from "@opaquecash/opaque";

const ROOT = new URL("..", import.meta.url).pathname;
const WASM_JS = `${ROOT}../app/public/pkg/cryptography.js`;
const WASM_BIN = `${ROOT}../app/public/pkg/cryptography_bg.wasm`;
const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

async function main() {
  if (!existsSync(WASM_JS)) {
    throw new Error(`Scanner WASM not found at ${WASM_JS} (full checkout required).`);
  }
  // Node cannot fetch(file://); hand the glue the wasm bytes directly.
  await initStealthWasm({
    moduleSpecifier: pathToFileURL(WASM_JS).href,
    wasmBinaryUrl: readFileSync(WASM_BIN) as unknown as string,
  });

  const pk = (process.env.PRIVATE_KEY ?? "0x" + "42".repeat(32)) as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const client = await OpaqueClient.fromWallet({
    wallets: {
      chain: "ethereum",
      address: account.address,
      walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
    },
    chainId: 11155111,
    rpcUrl: RPC,
    wasmModuleSpecifier: pathToFileURL(WASM_JS).href,
    solana: { cluster: "devnet", rpcUrl: process.env.SOLANA_RPC_URL },
  });
  console.log("scanning for", client.getMetaAddressHex().slice(0, 24) + "…");

  // Default window: the last ~20k Sepolia blocks (public RPCs reject huge log ranges).
  const head = await createPublicClient({ transport: http(RPC) }).getBlockNumber();
  const fromBlock = process.env.FROM_BLOCK
    ? BigInt(process.env.FROM_BLOCK)
    : head > 20_000n
      ? head - 20_000n
      : 0n;
  const outputs = await client.scan({
    chains: ["ethereum", "solana"],
    fromBlock,
    solanaLimit: 200,
  });
  console.log(`owned outputs: ${outputs.length}`);
  if (outputs.length > 0) {
    const balances = await client.getBalancesForOutputs(outputs);
    for (const b of balances) {
      const amount =
        b.chain === "ethereum"
          ? `${formatEther(b.nativeRaw)} ETH`
          : `${Number(b.nativeRaw) / 1e9} SOL`;
      console.log(`  [${b.chain}] ${b.address} -> ${amount}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
