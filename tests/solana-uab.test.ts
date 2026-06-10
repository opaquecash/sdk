import { describe, expect, it } from "vitest";
import { Connection } from "@solana/web3.js";
import { encodeUabPayload } from "@opaquecash/stealth-core";
import {
  CROSS_CHAIN_ANNOUNCEMENT_EVENT_DISCRIMINATOR,
  SolanaAdapter,
  decodeCrossChainAnnouncementLogs,
  getSolanaDeployment,
} from "@opaquecash/stealth-chain-solana";

/** Borsh-encode a CrossChainAnnouncement event as the uab-receiver program emits it. */
function encodeEvent(params: {
  sourceChain: number;
  sequence: bigint;
  payload: Uint8Array;
}): string {
  const buf = Buffer.alloc(8 + 2 + 32 + 8 + 4 + params.payload.length);
  let o = 0;
  Buffer.from(CROSS_CHAIN_ANNOUNCEMENT_EVENT_DISCRIMINATOR).copy(buf, o);
  o += 8;
  buf.writeUInt16LE(params.sourceChain, o);
  o += 2;
  Buffer.alloc(32, 0x11).copy(buf, o); // source emitter
  o += 32;
  buf.writeBigUInt64LE(params.sequence, o);
  o += 8;
  buf.writeUInt32LE(params.payload.length, o);
  o += 4;
  Buffer.from(params.payload).copy(buf, o);
  return `Program data: ${buf.toString("base64")}`;
}

const stealthAddress20 = Uint8Array.from({ length: 20 }, (_, i) => 0xa0 + i);
const ephemeralPubKey = Uint8Array.from([2, ...Array(32).fill(7)]);
const payload = encodeUabPayload({
  viewTag: 0xe1,
  ephemeralPubKey,
  stealthAddress: stealthAddress20,
  sourceChainId: 2, // Ethereum
  schemeId: 1,
  metadata: Uint8Array.from([9, 9]),
});

describe("uab-receiver event decoding", () => {
  it("decodes a CrossChainAnnouncement log into a chain-neutral Announcement", () => {
    const log = encodeEvent({ sourceChain: 2, sequence: 42n, payload });
    const [a, ...rest] = decodeCrossChainAnnouncementLogs([log], {
      txHash: "sig123",
      cursor: 99n,
    });
    expect(rest).to.have.length(0);
    expect(a.stealthAddress).toBe("0x" + Buffer.from(stealthAddress20).toString("hex"));
    expect(Buffer.from(a.ephemeralPubKey)).toEqual(Buffer.from(ephemeralPubKey));
    expect(a.viewTag).toBe(0xe1);
    expect(a.metadata[0]).toBe(0xe1); // view tag re-attached for the scanner
    expect(a.chainId).toBe(2); // origin chain, NOT Solana
    expect(a.txHash).toBe("sig123");
    expect(a.cursor).toBe(99n);
  });

  it("skips non-matching program data and malformed payloads", () => {
    const bogus = `Program data: ${Buffer.from([1, 2, 3]).toString("base64")}`;
    const truncated = encodeEvent({ sourceChain: 2, sequence: 1n, payload: payload.slice(0, 50) });
    expect(decodeCrossChainAnnouncementLogs([bogus, truncated, "Program log: hi"])).toEqual([]);
  });

  it("skips payloads with a non-secp256k1 scheme id", () => {
    const otherScheme = encodeUabPayload({
      viewTag: 1,
      ephemeralPubKey,
      stealthAddress: stealthAddress20,
      sourceChainId: 2,
      schemeId: 7,
      metadata: new Uint8Array(0),
    });
    const log = encodeEvent({ sourceChain: 2, sequence: 1n, payload: otherScheme });
    expect(decodeCrossChainAnnouncementLogs([log])).toEqual([]);
  });
});

describe("SolanaAdapter cross-chain merge", () => {
  function stubConnection(perProgramLogs: Map<string, string[]>): Connection {
    let i = 0;
    return {
      getSignaturesForAddress: async (program: { toBase58(): string }) => {
        const logs = perProgramLogs.get(program.toBase58());
        return logs ? [{ signature: `sig-${program.toBase58().slice(0, 4)}-${i++}`, slot: 7, err: null }] : [];
      },
      getTransaction: async (signature: string) => {
        for (const [program, logs] of perProgramLogs) {
          if (signature.includes(program.slice(0, 4))) {
            return { meta: { logMessages: logs } };
          }
        }
        return null;
      },
    } as unknown as Connection;
  }

  it("fetchAnnouncements merges uab-receiver events with native announcements", async () => {
    const deployment = getSolanaDeployment("devnet");
    const uabLog = encodeEvent({ sourceChain: 2, sequence: 5n, payload });
    const connection = stubConnection(
      new Map([[deployment.uabReceiver.toBase58(), [uabLog]]]),
    );

    const adapter = new SolanaAdapter({ connection, deployment });
    const all = await adapter.fetchAnnouncements();
    expect(all).toHaveLength(1);
    expect(all[0].chainId).toBe(2); // Ethereum-originated, relayed to Solana

    const nativeOnly = await adapter.fetchAnnouncements({ includeCrossChain: false });
    expect(nativeOnly).toHaveLength(0);
  });
});
