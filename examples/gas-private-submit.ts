/**
 * Gas-private submission via the relayer market (spec/relayer-market.md):
 * submit a PSR `verifyReputation` (or any permissionless call) on Sepolia without
 * linking your gas wallet to it. A staked relayer accepts and submits; you only fund
 * the escrow from a throwaway address and deliver the payload sealed to the winner.
 *
 *   ETH_RPC=... FUNDER_KEY=0x... npx tsx examples/gas-private-submit.ts
 *
 * Requires a relayer node reachable at GATEWAY (default http://localhost:8787).
 */
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { requireEvmDeployment } from "@opaquecash/deployments";
import { submitGasPrivate, type RegistryReaders } from "@opaquecash/relayer-client";

const ETH_RPC = process.env.ETH_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const GATEWAY = process.env.GATEWAY ?? "http://localhost:8787";
const registry = requireEvmDeployment(11155111).contracts.relayerRegistry as Address;

// The funding wallet (ideally unlinked from your identity; only it touches the escrow).
const funder = privateKeyToAccount(process.env.FUNDER_KEY as Hex);
const wallet = createWalletClient({ account: funder, chain: sepolia, transport: http(ETH_RPC) });
const publicClient = createPublicClient({ chain: sepolia, transport: http(ETH_RPC) });

// Minimal reads for bid verification: free stake + registered key per operator.
const registryAbi = [
  { type: "function", name: "freeStakeOf", stateMutability: "view", inputs: [{ name: "r", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "relayers", stateMutability: "view", inputs: [{ name: "r", type: "address" }], outputs: [
    { name: "stake", type: "uint256" }, { name: "bonded", type: "uint256" }, { name: "unstaking", type: "uint256" },
    { name: "unstakeAvailableAt", type: "uint64" }, { name: "x25519PubKey", type: "bytes32" }, { name: "endpoint", type: "string" },
  ] },
] as const;

const readers: RegistryReaders = {
  freeStakeOf: (op) =>
    publicClient.readContract({ address: registry, abi: registryAbi, functionName: "freeStakeOf", args: [op as Address] }),
  registeredKey: async (op) => {
    const r = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "relayers", args: [op as Address] });
    return r[4] as Hex;
  },
};

// The action to submit: here, a harmless permissionless call. Replace `target`/`calldata`
// with your PSR verifyReputation (or pool withdraw) request.
const target = registry; // example target; use your verifier address in practice
const calldata = "0x" as Hex;

const result = await submitGasPrivate({
  payload: { chain: 2, target, calldata },
  fee: parseEther("0.0005"),
  deadline: Math.floor(Date.now() / 1000) + 1800,
  registry,
  gateway: { baseUrl: GATEWAY },
  readers,
  fundEscrow: async (job) => {
    const hash = await wallet.sendTransaction(job.evmCreateJob!);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`escrow funded: ${hash}`);
  },
  minBids: 1,
  timeoutMs: 20_000,
});

console.log(`job ${result.jobId} awarded to ${result.winner.bid.operator}`);
console.log("the relayer will accept + submit; watch RelayerRegistry.JobSubmitted to confirm.");
