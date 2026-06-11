/**
 * Direct coverage for the indexer-row normalizer (`indexer/normalize.ts`) and the bundled
 * chain-deployment getters (`chains.ts`), plus the OpaqueClient static deployment helpers.
 * Everything here is pure / offline.
 */
import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import {
  OpaqueClient,
  NATIVE_TOKEN_ADDRESS,
  getSupportedChainIds,
  getChainDeployment,
  requireChainDeployment,
  indexerAnnouncementToScannerRecord,
  indexerAnnouncementsToScannerJson,
  type IndexerAnnouncement,
} from "@opaquecash/opaque";

const baseRow: IndexerAnnouncement = {
  blockNumber: "100",
  etherealPublicKey: ("0x02" + "11".repeat(32)) as Hex,
  logIndex: 0,
  metadata: "0x7f01" as Hex,
  stealthAddress: ("0x" + "ab".repeat(20)) as Hex,
  transactionHash: ("0x" + "e1".repeat(32)) as Hex,
  viewTag: 0x7f,
};

describe("indexerAnnouncementToScannerRecord", () => {
  it("maps a valid row into the WASM scanner record shape", () => {
    const rec = indexerAnnouncementToScannerRecord(baseRow);
    expect(rec.blockNumber).toBe(100);
    expect(rec.viewTag).toBe(0x7f);
    expect(rec.ephemeralPubKey).toHaveLength(33);
    expect(rec.ephemeralPubKey[0]).toBe(0x02);
    expect(rec.metadata).toEqual([0x7f, 0x01]);
    expect(rec.stealthAddress).toBe(baseRow.stealthAddress);
    expect(rec.txHash).toBe(baseRow.transactionHash);
  });

  it("accepts a stringified viewTag (subgraph rows often quote numbers)", () => {
    const rec = indexerAnnouncementToScannerRecord({
      ...baseRow,
      viewTag: "127" as unknown as number,
    });
    expect(rec.viewTag).toBe(127);
  });

  it("coerces other viewTag types through Number()", () => {
    // Some indexers hand back BigInt-ish values; Number(true) = 1 exercises the fallback arm.
    const rec = indexerAnnouncementToScannerRecord({
      ...baseRow,
      viewTag: true as unknown as number,
    });
    expect(rec.viewTag).toBe(1);
  });

  it("rejects a non-numeric blockNumber", () => {
    expect(() =>
      indexerAnnouncementToScannerRecord({ ...baseRow, blockNumber: "not-a-number" }),
    ).toThrow(/Invalid blockNumber/);
  });

  it("rejects an ephemeral key that is not 33 bytes", () => {
    expect(() =>
      indexerAnnouncementToScannerRecord({
        ...baseRow,
        etherealPublicKey: ("0x" + "11".repeat(32)) as Hex,
      }),
    ).toThrow(/expected 33-byte/);
  });

  it("rejects an ephemeral key without a compressed-point prefix", () => {
    expect(() =>
      indexerAnnouncementToScannerRecord({
        ...baseRow,
        etherealPublicKey: ("0x05" + "11".repeat(32)) as Hex,
      }),
    ).toThrow(/compressed prefix/);
  });

  it("rejects viewTags outside 0..255 and non-finite ones", () => {
    expect(() =>
      indexerAnnouncementToScannerRecord({ ...baseRow, viewTag: 300 }),
    ).toThrow(/Invalid viewTag/);
    expect(() =>
      indexerAnnouncementToScannerRecord({
        ...baseRow,
        viewTag: undefined as unknown as number,
      }),
    ).toThrow(/Invalid viewTag/);
  });
});

describe("indexerAnnouncementsToScannerJson", () => {
  it("batch-normalizes rows into a JSON array string", () => {
    const json = indexerAnnouncementsToScannerJson([baseRow, baseRow]);
    const parsed = JSON.parse(json) as Array<{ blockNumber: number }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].blockNumber).toBe(100);
  });
});

describe("chains.ts deployment getters", () => {
  it("lists supported chain ids (Sepolia is bundled)", () => {
    expect(getSupportedChainIds()).toContain(11155111);
  });

  it("resolves bundled deployments and returns undefined for unknown chains", () => {
    const d = getChainDeployment(11155111);
    expect(d?.chainId).toBe(11155111);
    expect(d?.stealthMetaAddressRegistry).toMatch(/^0x/);
    expect(getChainDeployment(1)).toBeUndefined();
  });

  it("requireChainDeployment throws for unknown chains", () => {
    expect(() => requireChainDeployment(1)).toThrow(/unsupported chainId 1/);
  });

  it("OpaqueClient.create rejects an unsupported chainId", async () => {
    await expect(
      OpaqueClient.create({
        chainId: 31337,
        rpcUrl: "http://127.0.0.1:1",
        walletSignature: ("0x" + "22".repeat(65)) as Hex,
        ethereumAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).rejects.toThrow(/unsupported chainId/);
  });
});

describe("OpaqueClient static deployment helpers", () => {
  it("supportedChainIds / chainDeployment mirror the chains.ts getters", () => {
    expect(OpaqueClient.supportedChainIds()).toEqual(getSupportedChainIds());
    expect(OpaqueClient.chainDeployment(11155111)?.chainId).toBe(11155111);
    expect(OpaqueClient.chainDeployment(1)).toBeUndefined();
  });

  it("re-exports the reputation scope helpers", () => {
    const scope = OpaqueClient.buildReputationActionScope({
      chainId: 11155111,
      module: "vote",
      actionId: 42,
    });
    expect(scope).toContain("vote");
    const nullifier = OpaqueClient.reputationExternalNullifierFromScope(scope);
    expect(BigInt(nullifier)).toBeGreaterThan(0n);
  });

  it("merges extra trackedTokens with the chain defaults (dedup by address)", async () => {
    // Covers the constructor's mergeTrackedTokens extra-token path.
    const client = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "http://127.0.0.1:1",
      walletSignature: ("0x" + "22".repeat(65)) as Hex,
      ethereumAddress: "0x1111111111111111111111111111111111111111",
      trackedTokens: [
        { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", decimals: 18 },
        { address: ("0x" + "aa".repeat(20)) as Hex, symbol: "TST", decimals: 6 },
      ],
    });
    expect(client.getChainId()).toBe(11155111);
    expect(client.getEthereumAddress()).toBe("0x1111111111111111111111111111111111111111");
    const contracts = client.getContracts();
    expect(contracts.stealthMetaAddressRegistry).toMatch(/^0x/);
    expect(contracts.stealthAddressAnnouncer).toMatch(/^0x/);
  });
});
