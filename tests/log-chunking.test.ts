/**
 * eth_getLogs chunking — public RPCs cap the block range of one request (publicnode: 50k,
 * others as low as 10k). Wide scans must be split into bounded windows, and a provider
 * range error must shrink the window instead of failing the scan.
 */
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { fetchAnnouncementsRange } from "@opaquecash/stealth-chain";
import { fetchCrossChainAnnouncements } from "@opaquecash/uab";

const ANNOUNCER = "0x840f72249A8bF6F10b0eB64412E315efBD730865" as const;

type Range = { fromBlock: bigint; toBlock: bigint };

function fakeClient(opts: {
  latest: bigint;
  maxRange?: bigint;
  calls: Range[];
}): PublicClient {
  const record = async (args: { fromBlock: bigint; toBlock: bigint }) => {
    if (
      opts.maxRange !== undefined &&
      args.toBlock - args.fromBlock + 1n > opts.maxRange
    ) {
      throw new Error("exceed maximum block range: 50000");
    }
    opts.calls.push({ fromBlock: args.fromBlock, toBlock: args.toBlock });
    return [];
  };
  return {
    getBlockNumber: async () => opts.latest,
    getContractEvents: record,
    getLogs: record,
  } as unknown as PublicClient;
}

describe("fetchAnnouncementsRange chunking", () => {
  it("splits a wide range into contiguous windows of at most chunkBlocks", async () => {
    const calls: Range[] = [];
    const client = fakeClient({ latest: 110_000n, calls });
    const out = await fetchAnnouncementsRange(client, {
      announcerAddress: ANNOUNCER,
      fromBlock: 0n,
      toBlock: "latest",
      chunkBlocks: 45_000n,
    });
    expect(out).toEqual([]);
    expect(calls).toEqual([
      { fromBlock: 0n, toBlock: 44_999n },
      { fromBlock: 45_000n, toBlock: 89_999n },
      { fromBlock: 90_000n, toBlock: 110_000n },
    ]);
  });

  it("halves the window when the provider rejects the range", async () => {
    const calls: Range[] = [];
    const client = fakeClient({ latest: 99_999n, maxRange: 25_000n, calls });
    await fetchAnnouncementsRange(client, {
      announcerAddress: ANNOUNCER,
      fromBlock: 0n,
      toBlock: "latest",
      chunkBlocks: 45_000n,
    });
    // 45000 rejected -> 22500 accepted; whole range covered contiguously.
    expect(calls[0]).toEqual({ fromBlock: 0n, toBlock: 22_499n });
    expect(calls.at(-1)?.toBlock).toBe(99_999n);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].fromBlock).toBe(calls[i - 1].toBlock + 1n);
    }
  });

  it("returns [] without any log query when fromBlock is past toBlock", async () => {
    const calls: Range[] = [];
    const client = fakeClient({ latest: 10n, calls });
    const out = await fetchAnnouncementsRange(client, {
      announcerAddress: ANNOUNCER,
      fromBlock: 11n,
      toBlock: "latest",
    });
    expect(out).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("rethrows when the provider rejects even the minimum window", async () => {
    const client = fakeClient({ latest: 99_999n, maxRange: 10n, calls: [] });
    await expect(
      fetchAnnouncementsRange(client, {
        announcerAddress: ANNOUNCER,
        fromBlock: 0n,
        toBlock: "latest",
      }),
    ).rejects.toThrow(/maximum block range/);
  });
});

describe("fetchCrossChainAnnouncements chunking", () => {
  it("splits a wide range and survives provider range caps", async () => {
    const calls: Range[] = [];
    const client = fakeClient({ latest: 120_000n, maxRange: 30_000n, calls });
    const out = await fetchCrossChainAnnouncements(client, {
      uabReceiver: ANNOUNCER,
      fromBlock: 0n,
      chunkBlocks: 45_000n,
    });
    expect(out).toEqual([]);
    expect(calls[0]).toEqual({ fromBlock: 0n, toBlock: 22_499n });
    expect(calls.at(-1)?.toBlock).toBe(120_000n);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].fromBlock).toBe(calls[i - 1].toBlock + 1n);
    }
  });
});
