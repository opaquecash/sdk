/**
 * ONS resolution example (spec/ONS.md §7): resolve `alice.opqtest.eth` the way a
 * Phantom sender does (devnet mirror PDA, no Ethereum RPC) and the way a MetaMask
 * sender does (canonical OpaqueNameRegistry on Sepolia), and confirm both return
 * the same meta-address.
 *
 *   npx tsx examples/ons-resolve.ts [name]
 */
import { OpaqueClient } from "@opaquecash/opaque";

const name = process.argv[2] ?? "alice.opqtest.eth";

const base = {
  chainId: 11155111,
  rpcUrl: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
  // resolveRecipient needs no keys; these are inert placeholders.
  walletSignature: ("0x" + "11".repeat(65)) as `0x${string}`,
  ethereumAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
};

// Phantom-side: Solana mirror PDA. The EVM RPC points at a dead port to prove
// no Ethereum access happens on this path.
const mirrorClient = await OpaqueClient.create({
  ...base,
  rpcUrl: "http://127.0.0.1:1",
  solana: { rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com" },
});
const viaMirror = await mirrorClient.resolveRecipient(name);
console.log(`[${viaMirror.source}] ${name} -> ${viaMirror.metaAddressHex}`);

// MetaMask-side: canonical registry over the Sepolia RPC.
const registryClient = await OpaqueClient.create(base);
const viaRegistry = await registryClient.resolveRecipient(name);
console.log(`[${viaRegistry.source}] ${name} -> ${viaRegistry.metaAddressHex}`);

console.log(
  viaMirror.metaAddressHex === viaRegistry.metaAddressHex
    ? "consistent: both chains resolve the same meta-address"
    : "DIVERGED (mirror lagging the canonical record?)",
);
