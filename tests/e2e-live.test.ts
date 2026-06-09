/**
 * Opt-in live test against the deployed Sepolia UAB. Skipped unless SEPOLIA_RPC_URL is set,
 * so CI stays fast and offline. Read-only: it builds the announceWithRelay request and reads
 * the live Wormhole message fee (no transaction is sent).
 *
 *   SEPOLIA_RPC_URL=https://... npm test
 */
import { describe, it, expect } from "vitest";
import { createPublicClient, http, decodeFunctionData, getAddress } from "viem";
import { buildAnnounceWithRelayRequest, getUabDeployment, uabSenderAbi } from "@opaquecash/uab";

const RPC = process.env.SEPOLIA_RPC_URL;

describe.skipIf(!RPC)("UAB live (Sepolia, read-only)", () => {
  it("builds an announceWithRelay request against the live deployment", async () => {
    const d = getUabDeployment(11155111)!;
    const client = createPublicClient({ transport: http(RPC) });
    const req = await buildAnnounceWithRelayRequest(client as never, {
      uabSender: d.uabSender,
      wormholeCore: d.wormholeCore,
      schemeId: 1n,
      stealthAddress: getAddress("0x" + "cc".repeat(20)),
      ephemeralPubKey: ("0x03" + "22".repeat(32)) as `0x${string}`,
      metadata: "0x77" as `0x${string}`,
    });
    expect(req.to.toLowerCase()).toBe(d.uabSender.toLowerCase());
    expect(typeof req.value).toBe("bigint");
    const decoded = decodeFunctionData({ abi: uabSenderAbi, data: req.data });
    expect(decoded.functionName).toBe("announceWithRelay");
  });
});
