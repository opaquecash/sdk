import { describe, it, expect } from "vitest";
import { bytesToHex } from "viem";
import {
  decodeUabPayload,
  encodeUabPayload,
  uabStealthAddressEvm,
  uabPayloadToMetadata,
  UAB_PAYLOAD_LENGTH,
} from "@opaquecash/stealth-core";
import { SOL_TO_ETH, ETH_TO_SOL } from "./fixtures";

describe("UAB payload codec (spec/payload-format.md)", () => {
  for (const fx of [SOL_TO_ETH, ETH_TO_SOL]) {
    it(`decodes the on-chain fixture (chain ${fx.sourceChainId})`, () => {
      const p = decodeUabPayload(fx.hex);
      expect(p.viewTag).toBe(fx.viewTag);
      expect(p.sourceChainId).toBe(fx.sourceChainId);
      expect(p.schemeId).toBe(fx.schemeId);
      expect(bytesToHex(p.ephemeralPubKey)).toBe(fx.ephemeralPubKey);
      expect(bytesToHex(uabStealthAddressEvm(p))).toBe(fx.stealthAddressEvm);
      expect(bytesToHex(p.metadata).startsWith(fx.metadataTail)).toBe(true);
    });

    it(`encodes back to the exact on-chain bytes (chain ${fx.sourceChainId})`, () => {
      const encoded = encodeUabPayload({
        viewTag: fx.viewTag,
        ephemeralPubKey: fx.ephemeralPubKey,
        stealthAddress: fx.stealthAddressEvm,
        sourceChainId: fx.sourceChainId,
        schemeId: fx.schemeId,
        metadata: fx.metadataTail,
      });
      expect(encoded.length).toBe(UAB_PAYLOAD_LENGTH);
      expect(bytesToHex(encoded)).toBe(fx.hex);
    });
  }

  it("reconstructs the EIP-5564 metadata (view tag + tail)", () => {
    const p = decodeUabPayload(SOL_TO_ETH.hex);
    const meta = uabPayloadToMetadata(p);
    expect(meta[0]).toBe(SOL_TO_ETH.viewTag);
    expect(bytesToHex(meta).startsWith(`0x42deadbeef`)).toBe(true);
  });

  it("rejects a wrong-length payload", () => {
    expect(() => decodeUabPayload("0x1234")).toThrow();
  });

  it("rejects metadata longer than 24 bytes", () => {
    expect(() =>
      encodeUabPayload({
        viewTag: 1,
        ephemeralPubKey: "0x02" + "11".repeat(32),
        stealthAddress: "0x" + "ab".repeat(20),
        sourceChainId: 2,
        schemeId: 1,
        metadata: "0x" + "cc".repeat(25),
      }),
    ).toThrow();
  });
});
