/**
 * Runnable example: send a stealth payment on Sepolia — derive a one-time address for
 * the recipient, transfer ETH, and publish the discovery announcement. SPENDS REAL
 * TESTNET ETH, so it is opt-in:
 *
 *   PRIVATE_KEY=0x…  RECIPIENT=<meta-address | 0xaddr | name.eth | ipfs://CID> \
 *     npx tsx examples/send.ts
 *
 * RECIPIENT defaults to a self-payment (your own meta-address). Optional:
 * SEPOLIA_RPC_URL, AMOUNT_WEI (default 0.0001 ETH), DELAY_MS (delayed announcement —
 * the §17 anonymity-set utility decoupling send time from announce time).
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { OpaqueClient } from "@opaquecash/opaque";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error("Set PRIVATE_KEY (funded Sepolia account).");
  const account = privateKeyToAccount(pk);

  const client = await OpaqueClient.fromWallet({
    wallets: {
      chain: "ethereum",
      address: account.address,
      walletClient: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
    },
    chainId: 11155111,
    rpcUrl: RPC,
  });

  const recipient = process.env.RECIPIENT ?? client.getMetaAddressHex();
  const amount = BigInt(process.env.AMOUNT_WEI ?? 100_000_000_000_000n); // 0.0001 ETH
  const delayAnnouncement = process.env.DELAY_MS ? Number(process.env.DELAY_MS) : undefined;

  console.log(`sending ${amount} wei -> ${recipient.slice(0, 24)}…`);
  const res = await client.sendStealthPayment({
    chain: "ethereum",
    recipient,
    amount,
    delayAnnouncement,
  });
  console.log("stealth address :", res.stealthAddress);
  console.log("transfer tx     :", res.txHash);
  if (res.announcePromise) {
    console.log(`announce delayed ${delayAnnouncement}ms…`);
    console.log("announce tx     :", await res.announcePromise);
  } else {
    console.log("announce tx     :", res.announceTxHash);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
