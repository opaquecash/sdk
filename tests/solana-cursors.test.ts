// Solana scan cursors (extension Phase 0.6): `until`/`before` must reach the RPC's
// getSignaturesForAddress for BOTH program walks (native announcer + uab-receiver),
// with per-program cursors supported — signature histories are per address, and a
// periodic scanner that cannot resume replays up to ~1000 getTransaction calls per tick.
import { describe, expect, it } from "vitest";
import type { Connection } from "@solana/web3.js";
import { SolanaAdapter, getSolanaDeployment } from "@opaquecash/stealth-chain-solana";
import { OpaqueClient } from "@opaquecash/opaque";
import type { Hex } from "viem";

type SigCall = { address: string; before?: string; until?: string; limit?: number };

function capturingConnection(calls: SigCall[]): Connection {
  return {
    getSignaturesForAddress: async (
      program: { toBase58(): string },
      opts: { limit?: number; before?: string; until?: string },
    ) => {
      calls.push({ address: program.toBase58(), ...opts });
      return [];
    },
    getTransaction: async () => null,
  } as unknown as Connection;
}

const deployment = getSolanaDeployment("devnet");
const ANNOUNCER = deployment.stealthAnnouncer.toBase58();
const RECEIVER = deployment.uabReceiver.toBase58();

describe("SolanaAdapter.fetchAnnouncements signature cursors", () => {
  it("applies a string cursor to both program walks", async () => {
    const calls: SigCall[] = [];
    const adapter = new SolanaAdapter({ connection: capturingConnection(calls), deployment });
    await adapter.fetchAnnouncements({ untilSignature: "sigU", beforeSignature: "sigB" });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.until).toBe("sigU");
      expect(call.before).toBe("sigB");
    }
    expect(new Set(calls.map((c) => c.address))).toEqual(new Set([ANNOUNCER, RECEIVER]));
  });

  it("routes per-program cursors to their own walk", async () => {
    const calls: SigCall[] = [];
    const adapter = new SolanaAdapter({ connection: capturingConnection(calls), deployment });
    await adapter.fetchAnnouncements({
      untilSignature: { native: "nativeU", crossChain: "crossU" },
    });
    const native = calls.find((c) => c.address === ANNOUNCER);
    const cross = calls.find((c) => c.address === RECEIVER);
    expect(native?.until).toBe("nativeU");
    expect(cross?.until).toBe("crossU");
    expect(native?.before).toBeUndefined();
  });

  it("skips the receiver walk when includeCrossChain is false", async () => {
    const calls: SigCall[] = [];
    const adapter = new SolanaAdapter({ connection: capturingConnection(calls), deployment });
    await adapter.fetchAnnouncements({ untilSignature: "sigU", includeCrossChain: false });
    expect(calls.map((c) => c.address)).toEqual([ANNOUNCER]);
  });
});

describe("client.scan() cursor passthrough", () => {
  it("forwards solanaUntil/solanaBefore/solanaLimit to the adapter", async () => {
    const calls: SigCall[] = [];
    const client = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "https://ethereum-sepolia.publicnode.com", // never contacted (solana-only scan)
      walletSignature: ("0x" + "11".repeat(65)) as Hex,
      ethereumAddress: ("0x" + "01".repeat(20)) as Hex,
      solana: { connection: capturingConnection(calls), deployment },
    });
    await client.scan({
      chains: ["solana"],
      solanaLimit: 250,
      solanaUntil: { native: "nativeU", crossChain: "crossU" },
      solanaBefore: "sigB",
    });
    const native = calls.find((c) => c.address === ANNOUNCER);
    const cross = calls.find((c) => c.address === RECEIVER);
    expect(native).toMatchObject({ until: "nativeU", before: "sigB", limit: 250 });
    expect(cross).toMatchObject({ until: "crossU", before: "sigB", limit: 250 });
  });
});
