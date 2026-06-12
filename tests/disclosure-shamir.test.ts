/**
 * Phase 7.1 — @opaquecash/disclosure Shamir viewing-key escrow
 * (spec/conditional-disclosure.md §2): split/recover round-trips, threshold
 * enforcement (the raw GF(256) scheme is silent below threshold — the envelope
 * must not be), envelope validation, and tamper behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  splitViewingKey,
  recoverViewingKey,
  parseShare,
} from "@opaquecash/disclosure";

const key = (fill: number) => new Uint8Array(32).fill(fill).map((b, i) => (b + i * 7) & 0xff);

describe("splitViewingKey / recoverViewingKey", () => {
  it("round-trips 2-of-3 from any quorum", async () => {
    const vk = key(0xa5);
    const shares = await splitViewingKey(vk, 2, 3);
    expect(shares).toHaveLength(3);

    for (const pair of [
      [shares[0], shares[1]],
      [shares[0], shares[2]],
      [shares[1], shares[2]],
      shares, // all three also work
    ]) {
      expect(await recoverViewingKey(pair)).toEqual(vk);
    }
  });

  it("round-trips 3-of-5", async () => {
    const vk = key(0x11);
    const shares = await splitViewingKey(vk, 3, 5);
    expect(await recoverViewingKey([shares[4], shares[1], shares[3]])).toEqual(vk);
  });

  it("rejects recovery below the recorded threshold", async () => {
    const shares = await splitViewingKey(key(1), 3, 5);
    await expect(recoverViewingKey(shares.slice(0, 2))).rejects.toThrow(/need 3 shares/);
  });

  it("rejects duplicate custodian indices", async () => {
    const shares = await splitViewingKey(key(2), 2, 3);
    await expect(recoverViewingKey([shares[0], shares[0]])).rejects.toThrow(/duplicate/);
  });

  it("rejects shares from different splits", async () => {
    const a = await splitViewingKey(key(3), 2, 3);
    const b = await splitViewingKey(key(3), 2, 4);
    await expect(recoverViewingKey([a[0], b[1]])).rejects.toThrow(/different splits/);
  });

  it("a tampered share recovers the wrong key, not the real one", async () => {
    const vk = key(0x42);
    const shares = await splitViewingKey(vk, 2, 3);
    const bytes = Buffer.from(shares[0], "base64");
    bytes[10] ^= 0xff; // flip a raw-share byte, leave the envelope intact
    const recovered = await recoverViewingKey([bytes.toString("base64"), shares[1]]);
    expect(recovered).not.toEqual(vk);
  });

  it("validates split parameters", async () => {
    await expect(splitViewingKey(new Uint8Array(31), 2, 3)).rejects.toThrow(/32 bytes/);
    await expect(splitViewingKey(key(0), 1, 3)).rejects.toThrow(/at least 2/);
    await expect(splitViewingKey(key(0), 4, 3)).rejects.toThrow(/>= threshold/);
  });

  it("envelopes carry version, threshold, total, and 1-based index", async () => {
    const shares = await splitViewingKey(key(9), 2, 3);
    shares.forEach((s, i) => {
      const p = parseShare(s);
      expect(p).toMatchObject({ version: 1, threshold: 2, total: 3, index: i + 1 });
      expect(p.share.length).toBeGreaterThanOrEqual(32);
    });
  });

  it("rejects foreign/corrupt envelopes", () => {
    expect(() => parseShare(Buffer.from([2, 2, 3, 1, 9, 9, 9, 9, 9]).toString("base64"))).toThrow(
      /version/,
    );
    expect(() => parseShare(Buffer.from([1, 2, 3]).toString("base64"))).toThrow(/too short/);
    expect(() => parseShare(Buffer.from([1, 2, 3, 7, 9, 9, 9]).toString("base64"))).toThrow(
      /index/,
    );
  });
});
