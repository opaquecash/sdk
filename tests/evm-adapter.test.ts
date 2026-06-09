import { describe, it, expect } from "vitest";
import type { PublicClient } from "viem";
import { EvmAdapter, evmAnnouncementToNeutral } from "@opaquecash/stealth-chain";
import {
  WORMHOLE_CHAIN_ETHEREUM,
  WORMHOLE_CHAIN_SOLANA,
  type Announcement,
} from "@opaquecash/adapter";
import { OpaqueClient, announcementToIndexerRow } from "@opaquecash/opaque";

const ANNOUNCER = ("0x" + "11".repeat(20)) as `0x${string}`;
const REGISTRY = ("0x" + "22".repeat(20)) as `0x${string}`;
const REGISTRANT = ("0x" + "33".repeat(20)) as `0x${string}`;

function decoded(over: Record<string, unknown> = {}) {
  return {
    schemeId: 1n,
    stealthAddress: "0x" + "ab".repeat(20),
    caller: "0x" + "cd".repeat(20),
    ephemeralPubKey: Uint8Array.from([0x02, ...Array(32).fill(0x09)]),
    metadata: Uint8Array.from([0x7f, 0x01]),
    logIndex: 3,
    blockNumber: 123n,
    transactionHash: "0x" + "ef".repeat(32),
    ...over,
  } as never;
}

describe("evmAnnouncementToNeutral", () => {
  it("maps a decoded EVM announcement to chain-neutral form", () => {
    const a = evmAnnouncementToNeutral(decoded());
    expect(a.chainId).toBe(WORMHOLE_CHAIN_ETHEREUM);
    expect(a.viewTag).toBe(0x7f);
    expect(a.ephemeralPubKey).toHaveLength(33);
    expect(a.cursor).toBe(123n);
    expect(a.logIndex).toBe(3);
    expect(a.txHash).toBe("0x" + "ef".repeat(32));
    expect(a.stealthAddress).toBe("0x" + "ab".repeat(20));
  });

  it("defaults viewTag to 0 for empty metadata", () => {
    expect(evmAnnouncementToNeutral(decoded({ metadata: new Uint8Array() })).viewTag).toBe(0);
  });
});

describe("EvmAdapter", () => {
  function adapter(readContract: () => Promise<unknown>): EvmAdapter {
    return new EvmAdapter({
      publicClient: { readContract } as unknown as PublicClient,
      announcerAddress: ANNOUNCER,
      registryAddress: REGISTRY,
      evmChainId: 11155111,
    });
  }

  it("reports the Wormhole Ethereum chain id and name", () => {
    const a = adapter(async () => "0x");
    expect(a.chainId).toBe(WORMHOLE_CHAIN_ETHEREUM);
    expect(a.name).toBe("ethereum");
    expect(a.evmChainId).toBe(11155111);
  });

  it("throws without a client or rpcUrl", () => {
    expect(
      () => new EvmAdapter({ announcerAddress: ANNOUNCER, registryAddress: REGISTRY }),
    ).toThrow(/publicClient or rpcUrl/);
  });

  it("resolves a 66-byte meta-address and null otherwise", async () => {
    const present = adapter(async () => "0x" + "ab".repeat(66));
    const absent = adapter(async () => "0x");
    expect(await present.resolveMetaAddress(REGISTRANT)).toBe("0x" + "ab".repeat(66));
    expect(await present.isRegistered(REGISTRANT)).toBe(true);
    expect(await absent.resolveMetaAddress(REGISTRANT)).toBeNull();
    expect(await absent.isRegistered(REGISTRANT)).toBe(false);
  });
});

describe("announcementToIndexerRow (unified inbox mapping)", () => {
  it("maps an EVM-style announcement (block cursor + 0x hash)", () => {
    const a: Announcement = {
      stealthAddress: ("0x" + "ab".repeat(20)) as `0x${string}`,
      ephemeralPubKey: Uint8Array.from([0x02, ...Array(32).fill(1)]),
      viewTag: 0x10,
      metadata: Uint8Array.from([0x10]),
      chainId: WORMHOLE_CHAIN_ETHEREUM,
      txHash: "0x" + "ef".repeat(32),
      cursor: 999n,
      logIndex: 2,
    };
    const row = announcementToIndexerRow(a);
    expect(row.blockNumber).toBe("999");
    expect(row.etherealPublicKey).toBe("0x02" + "01".repeat(32));
    expect(row.metadata).toBe("0x10");
    expect(row.viewTag).toBe(0x10);
    expect(row.transactionHash).toBe("0x" + "ef".repeat(32));
    expect(row.logIndex).toBe(2);
  });

  it("passes a Solana base58 signature + slot through verbatim", () => {
    const a: Announcement = {
      stealthAddress: ("0x" + "cd".repeat(20)) as `0x${string}`,
      ephemeralPubKey: Uint8Array.from([0x03, ...Array(32).fill(2)]),
      viewTag: 5,
      metadata: Uint8Array.from([5]),
      chainId: WORMHOLE_CHAIN_SOLANA,
      txHash: "5xExAmpLeSiGnAtUrEbAsE58",
      cursor: 42n,
    };
    const row = announcementToIndexerRow(a);
    expect(row.transactionHash).toBe("5xExAmpLeSiGnAtUrEbAsE58");
    expect(row.blockNumber).toBe("42");
    expect(row.logIndex).toBe(0);
  });
});

describe("OpaqueClient unified scan surface", () => {
  it("exposes scan() on the facade", () => {
    expect(typeof (OpaqueClient.prototype as unknown as { scan: unknown }).scan).toBe(
      "function",
    );
  });
});
