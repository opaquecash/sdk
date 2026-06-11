/**
 * Phase 2.8 — anonymity-set utilities: generateDummyAnnouncements (view-tag-valid noise
 * to throwaway meta-addresses) and sendStealthPayment({ delayAnnouncement }) decoupling
 * send time from announce time. Offline: stubbed wallet client / Solana transport.
 */
import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import type { Hex } from "viem";
import {
  OpaqueClient,
  generateRandomMetaAddress,
  parseMetaAddressValue,
  recomputeStealthSendFromEphemeralPrivateKey,
} from "@opaquecash/opaque";
import { stealthAddressAnnouncerAbi } from "@opaquecash/stealth-chain";

async function makeClient(): Promise<OpaqueClient> {
  return OpaqueClient.create({
    chainId: 11155111,
    rpcUrl: "http://127.0.0.1:1",
    walletSignature: ("0x" + "22".repeat(65)) as Hex,
    ethereumAddress: "0x1111111111111111111111111111111111111111",
  });
}

describe("generateRandomMetaAddress", () => {
  it("mints unique, point-valid 66-byte meta-addresses", () => {
    const a = generateRandomMetaAddress();
    const b = generateRandomMetaAddress();
    expect(a).not.toBe(b);
    expect(parseMetaAddressValue(a)).toBe(a);
    expect(parseMetaAddressValue(b)).toBe(b);
  });
});

describe("generateDummyAnnouncements", () => {
  it("produces n cryptographically valid DKSAP announcements to throwaway recipients", async () => {
    const client = await makeClient();
    const dummies = client.generateDummyAnnouncements(5);
    expect(dummies).toHaveLength(5);
    const addresses = new Set(dummies.map((d) => d.stealthAddress));
    expect(addresses.size).toBe(5);
    for (const d of dummies) {
      expect(d.ephemeralPublicKey).toHaveLength(33);
      expect(d.metadata[0]).toBe(d.viewTag);
      // Recompute from the ephemeral secret against the throwaway meta-address:
      // a real DKSAP derivation must reproduce the same stealth address + view tag.
      const r = recomputeStealthSendFromEphemeralPrivateKey(
        d.metaAddressHex,
        d.ephemeralPrivateKey,
      );
      expect(r.stealthAddress).toBe(d.stealthAddress);
      expect(r.viewTag).toBe(d.viewTag);
    }
  });

  it("never matches the client's own scanner keys", async () => {
    const client = await makeClient();
    const own = client.prepareGhostReceive();
    const dummies = client.generateDummyAnnouncements(3);
    for (const d of dummies) {
      expect(d.metaAddressHex).not.toBe(client.getMetaAddressHex());
      expect(d.stealthAddress).not.toBe(own.stealthAddress);
    }
  });

  it("builds ready-to-submit announce calldata", async () => {
    const client = await makeClient();
    const txs = client.buildDummyAnnouncementTransactions(2);
    expect(txs).toHaveLength(2);
    for (const tx of txs) {
      expect(tx.to).toBe(client.getContracts().stealthAddressAnnouncer);
      const decoded = decodeFunctionData({
        abi: stealthAddressAnnouncerAbi,
        data: tx.data,
      });
      expect(decoded.functionName).toBe("announce");
      expect(decoded.args?.[0]).toBe(1n);
    }
    expect(() => client.generateDummyAnnouncements(-1)).toThrow(/non-negative/);
  });
});

describe("sendStealthPayment({ delayAnnouncement })", () => {
  it("submits the transfer immediately and the announce only after the delay (EVM)", async () => {
    const client = await makeClient();
    const sent: Array<{ at: number; to?: string; data?: string }> = [];
    const walletStub = {
      chain: undefined,
      sendTransaction: async (tx: { to?: string; data?: string }) => {
        sent.push({ at: Date.now(), to: tx.to, data: tx.data });
        return ("0x" + String(sent.length).padStart(64, "0")) as Hex;
      },
    };
    (client as unknown as { evmWalletClientCache: unknown }).evmWalletClientCache =
      walletStub;

    const recipient = generateRandomMetaAddress();
    const t0 = Date.now();
    const res = await client.sendStealthPayment({
      chain: "ethereum",
      recipient,
      amount: 1n,
      delayAnnouncement: 120,
    });
    // Transfer was submitted, announce was not (yet).
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toBeUndefined();
    expect(res.announceTxHash).toBeUndefined();
    expect(res.announcePromise).toBeDefined();

    const announceTx = await res.announcePromise!;
    expect(sent).toHaveLength(2);
    expect(announceTx).toMatch(/^0x0+2$/);
    expect(sent[1].to).toBe(client.getContracts().stealthAddressAnnouncer);
    expect(sent[1].at - t0).toBeGreaterThanOrEqual(110);
  });

  it("announces in the same call when no delay is set", async () => {
    const client = await makeClient();
    const sent: Array<{ to?: string; data?: string }> = [];
    (client as unknown as { evmWalletClientCache: unknown }).evmWalletClientCache = {
      chain: undefined,
      sendTransaction: async (tx: { to?: string; data?: string }) => {
        sent.push(tx);
        return ("0x" + String(sent.length).padStart(64, "0")) as Hex;
      },
    };
    const res = await client.sendStealthPayment({
      chain: "ethereum",
      recipient: generateRandomMetaAddress(),
      amount: 1n,
    });
    expect(sent).toHaveLength(2);
    expect(res.announceTxHash).toBeDefined();
    expect(res.announcePromise).toBeUndefined();
  });
});
