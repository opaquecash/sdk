/**
 * Runnable read-only example: build a cross-chain announce request and read inbound
 * cross-chain announcements from the live Sepolia UAB. No keys, no transactions sent.
 *
 *   SEPOLIA_RPC_URL=https://... npx tsx examples/uab-readonly.ts
 *
 * (Run `npm run build` first so the workspace packages resolve to dist.)
 */
import { createPublicClient, http, getAddress } from "viem";
import {
  buildAnnounceWithRelayRequest,
  fetchCrossChainAnnouncements,
  toIndexerAnnouncement,
  requireUabDeployment,
} from "@opaquecash/uab";

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL;
  if (!rpc) throw new Error("Set SEPOLIA_RPC_URL");

  const d = requireUabDeployment(11155111);
  const client = createPublicClient({ transport: http(rpc) });

  // Build (don't send) a cross-chain announce request.
  const req = await buildAnnounceWithRelayRequest(client as never, {
    uabSender: d.uabSender,
    wormholeCore: d.wormholeCore,
    schemeId: 1n,
    stealthAddress: getAddress("0x" + "cc".repeat(20)),
    ephemeralPubKey: ("0x03" + "22".repeat(32)) as `0x${string}`,
    metadata: "0x77" as `0x${string}`,
  });
  console.log("announceWithRelay request:", { to: req.to, value: req.value.toString() });

  // Read recent inbound cross-chain announcements (last ~50k blocks).
  const head = await client.getBlockNumber();
  const fromBlock = head > 50_000n ? head - 50_000n : 0n;
  const records = await fetchCrossChainAnnouncements(client as never, {
    uabReceiver: d.uabReceiver,
    fromBlock,
  });
  console.log(`found ${records.length} cross-chain announcement(s)`);
  for (const r of records.slice(0, 5)) {
    console.log("  ->", toIndexerAnnouncement(r));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
