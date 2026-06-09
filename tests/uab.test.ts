import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { decodeUabPayload } from "@opaquecash/stealth-core";
import {
  encodeAnnounceWithRelay,
  uabSenderAbi,
  toIndexerAnnouncement,
  getUabDeployment,
  CONSISTENCY_FINALIZED,
  type CrossChainAnnouncementRecord,
} from "@opaquecash/uab";
import { SOL_TO_ETH } from "./fixtures";

describe("UAB sender encoding", () => {
  it("encodes announceWithRelay calldata that decodes back to the same args", () => {
    const args = {
      schemeId: 1n,
      stealthAddress: getAddress("0x" + "ab".repeat(20)),
      ephemeralPubKey: ("0x02" + "11".repeat(32)) as `0x${string}`,
      metadata: "0x42deadbeef" as `0x${string}`,
      consistencyLevel: CONSISTENCY_FINALIZED,
    };
    const data = encodeAnnounceWithRelay(args);
    const decoded = decodeFunctionData({ abi: uabSenderAbi, data });
    expect(decoded.functionName).toBe("announceWithRelay");
    expect(decoded.args[0]).toBe(1n);
    expect((decoded.args[1] as string).toLowerCase()).toBe(args.stealthAddress.toLowerCase());
    expect(decoded.args[4]).toBe(CONSISTENCY_FINALIZED);
  });
});

describe("UAB receiver mapping", () => {
  it("maps a CrossChainAnnouncement to a scannable indexer row", () => {
    const payload = decodeUabPayload(SOL_TO_ETH.hex);
    const record: CrossChainAnnouncementRecord = {
      sourceChain: 1,
      sourceEmitter: ("0x" + "ab".repeat(32)) as `0x${string}`,
      sequence: 7n,
      payload,
      payloadHex: SOL_TO_ETH.hex,
      transactionHash: ("0x" + "ee".repeat(32)) as `0x${string}`,
      blockNumber: 123n,
      logIndex: 2,
    };
    const row = toIndexerAnnouncement(record);
    expect(row.stealthAddress).toBe(getAddress(SOL_TO_ETH.stealthAddressEvm));
    expect(row.viewTag).toBe(SOL_TO_ETH.viewTag);
    expect(row.etherealPublicKey).toBe(SOL_TO_ETH.ephemeralPubKey);
    expect(row.metadata.startsWith("0x42deadbeef")).toBe(true);
    expect(row.blockNumber).toBe("123");
    expect(row.transactionHash).toBe(record.transactionHash);
  });
});

describe("UAB deployment registry", () => {
  it("knows the Sepolia deployment", () => {
    const d = getUabDeployment(11155111);
    expect(d?.uabSender.toLowerCase()).toBe("0x872787c0bd1a0c71e6d1be5a144eb044e0cb2069");
    expect(d?.uabReceiver.toLowerCase()).toBe("0x9ef189f7a263f870cf80f9a89d1349a6af7b15cf");
    expect(d?.whChain).toBe(2);
    expect(d?.sourceWhChain).toBe(1);
  });
});
