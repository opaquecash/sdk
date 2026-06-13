/**
 * Live end-to-end test of the gasless ERC-20 sweep on Sepolia (spec/relayer-market.md §9).
 *
 * Proves the full path against the deployed StealthTokenSweep forwarder and a real EIP-2612 token:
 * a one-time stealth key that holds the token but NO native gas signs the sweep authorization and
 * permit offline; a relayer submits it, pays the gas, and is reimbursed the fee in-token.
 *
 *   SEPOLIA_RPC_URL=https://... SEPOLIA_PRIVATE_KEY=0x<relayer/funder> \
 *     npx tsx examples/e2e-gasless-sweep.ts
 *
 * The private key funds gas and acts as the relayer; the test token must be publicly mintable
 * (the project's MockERC20 is). Run `npm run build` first so workspace packages resolve to dist.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  formatUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sepolia } from "viem/chains";
import { getEvmDeployment } from "@opaquecash/deployments";
import {
  erc20SweepAbi,
  stealthTokenSweepAbi,
  signStealthSweepAuthorization,
  signStealthTokenPermit,
  encodeSweepWithPermit,
} from "@opaquecash/stealth-chain";

const CHAIN_ID = 11155111;
const RPC = process.env.SEPOLIA_RPC_URL;
const KEY = process.env.SEPOLIA_PRIVATE_KEY;
const TOKEN = getAddress(
  process.env.E2E_TOKEN ?? "0x73197e8303904862d543f9706E8422F634D713cb", // test USD Coin (permit)
);

const erc20MetaAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
] as const;

async function main() {
  if (!RPC || !KEY) {
    throw new Error("Set SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY to run this live test.");
  }
  const forwarder = getEvmDeployment(CHAIN_ID)?.contracts.stealthTokenSweep;
  if (!forwarder) throw new Error("No stealthTokenSweep address in the deployment registry.");

  const relayer = privateKeyToAccount((KEY.startsWith("0x") ? KEY : `0x${KEY}`) as Hex);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
  const walletClient = createWalletClient({ account: relayer, chain: sepolia, transport: http(RPC) });

  // A one-time stealth key: holds the token, owns no native gas, only signs offline.
  const stealthKey = generatePrivateKey();
  const owner = privateKeyToAccount(stealthKey).address;
  const destination = relayer.address; // sweep destination (any address)

  const decimals = (await publicClient.readContract({ address: TOKEN, abi: erc20MetaAbi, functionName: "decimals" })) as number;
  const tokenName = (await publicClient.readContract({ address: TOKEN, abi: erc20MetaAbi, functionName: "name" })) as string;
  const value = 1n * 10n ** BigInt(decimals); // 1 token
  const fee = value / 10n; // 10% relayer fee

  console.log("forwarder  :", forwarder);
  console.log("token      :", TOKEN, `(${tokenName}, ${decimals}d)`);
  console.log("stealth own:", owner, "(no native gas)");
  console.log("relayer    :", relayer.address);

  // 1. Fund the stealth address with the token (mint). It still has zero native gas.
  const mintHash = await walletClient.writeContract({
    address: TOKEN, abi: erc20MetaAbi, functionName: "mint", args: [owner, value],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  const ownerNative = await publicClient.getBalance({ address: owner });
  console.log(`minted ${formatUnits(value, decimals)} to stealth; its native balance = ${ownerNative} wei`);

  // 2. Owner signs the sweep authorization + permit offline (read current nonces).
  const sweepNonce = (await publicClient.readContract({ address: forwarder, abi: stealthTokenSweepAbi, functionName: "nonces", args: [owner] })) as bigint;
  const permitNonce = (await publicClient.readContract({ address: TOKEN, abi: erc20MetaAbi, functionName: "nonces", args: [owner] })) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const { ownerSig, authorization } = await signStealthSweepAuthorization({
    stealthPrivKey: stealthKey, forwarder, chainId: CHAIN_ID,
    authorization: { token: TOKEN, destination, value, fee, nonce: sweepNonce, deadline },
  });
  const permit = await signStealthTokenPermit({
    stealthPrivKey: stealthKey, token: TOKEN, chainId: CHAIN_ID, spender: forwarder,
    value, nonce: permitNonce, deadline, tokenName,
  });

  // 3. Relayer submits, pays gas, earns the fee in-token.
  const balDestBefore = (await publicClient.readContract({ address: TOKEN, abi: erc20SweepAbi, functionName: "balanceOf", args: [destination] })) as bigint;
  const sweepHash = await walletClient.sendTransaction({
    to: forwarder, data: encodeSweepWithPermit(authorization, ownerSig, permit),
  });
  await publicClient.waitForTransactionReceipt({ hash: sweepHash });
  console.log("sweep tx   :", `https://sepolia.etherscan.io/tx/${sweepHash}`);

  // 4. Assert outcomes.
  const balOwner = (await publicClient.readContract({ address: TOKEN, abi: erc20SweepAbi, functionName: "balanceOf", args: [owner] })) as bigint;
  const balDest = (await publicClient.readContract({ address: TOKEN, abi: erc20SweepAbi, functionName: "balanceOf", args: [destination] })) as bigint;
  const gained = balDest - balDestBefore;
  console.log(`stealth owner balance after: ${formatUnits(balOwner, decimals)} (expect 0)`);
  console.log(`destination gained          : ${formatUnits(gained, decimals)} (expect ${formatUnits(value - fee, decimals)} + fee ${formatUnits(fee, decimals)} = full ${formatUnits(value, decimals)}, since destination == relayer here)`);
  if (balOwner !== 0n) throw new Error("FAIL: stealth owner still holds tokens");
  // destination == relayer in this script, so it receives value-fee (as destination) + fee (as relayer) = value.
  if (gained !== value) throw new Error(`FAIL: expected destination+relayer to net ${value}, got ${gained}`);
  console.log("\nPASS: gasless sweep settled on Sepolia (stealth owner paid no gas).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
