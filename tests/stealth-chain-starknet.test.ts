import { describe, expect, it } from "vitest";
import {
  buildAnnounceCall,
  buildRegisterKeysCall,
  decodeAnnouncementEvent,
  decodeByteArray,
  encodeByteArray,
  OPAQUE_CHAIN_STARKNET,
  StarknetAdapter,
  starknetKeccak,
  STARKNET_SEPOLIA,
  type StarknetEmittedEvent,
} from "@opaquecash/stealth-chain-starknet";

const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from(h.replace(/^0x/, "").match(/../g)!.map((b) => parseInt(b, 16)));

/** CSAP canonical vector 1 (spec/CSAP.md Test Vectors). */
const EPHEMERAL =
  "02b95c249d84f417e3e395a127425428b540671cc15881eb828c17b722a53fc599";
const STEALTH_ADDRESS = "0xa5847a467208cbcd5d238369865a90716310183a";
const VIEW_TAG = 225;

/**
 * The REAL Sepolia event emitted by announcing canonical vector 1 through the
 * live announcer with calldata produced by `buildAnnounceCall` (tx
 * 0x006efbb9a62f28e529815fd4e1e71126e11462b869658019f587beed40d242d8,
 * block 12158304) — captured verbatim from `starknet_getTransactionReceipt`.
 * Everything below decodes against on-chain truth, not our own encoder.
 */
const LIVE_EVENT: StarknetEmittedEvent = {
  from_address:
    "0x3b8258e84e6feec93239b442e6a91f532fda35fed67de4093b1d97150d2aa2",
  keys: [
    "0x3b0aef39a70b56ef15742493d76e4564fece25d63e44474e1e3434aa467a374",
    "0x1",
    "0x0",
    "0xa5847a467208cbcd5d238369865a90716310183a",
    "0x29db6e717afae61c5693afb65da25fb71974ccfe6705a8cc9282a8c9d725ceb",
  ],
  data: [
    "0x1",
    "0x2b95c249d84f417e3e395a127425428b540671cc15881eb828c17b722a53f",
    "0xc599",
    "0x2",
    "0x0",
    "0xe1",
    "0x1",
  ],
  block_number: 12158304,
  transaction_hash:
    "0x006efbb9a62f28e529815fd4e1e71126e11462b869658019f587beed40d242d8",
};

describe("stealth-chain-starknet", () => {
  it("roundtrips ByteArray encoding across word boundaries", () => {
    for (const len of [0, 1, 30, 31, 32, 33, 61, 62, 66, 98]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 7 + 3) & 0xff);
      const { bytes: decoded, consumed } = decodeByteArray(encodeByteArray(bytes));
      expect(decoded).toEqual(bytes);
      expect(consumed).toBe(encodeByteArray(bytes).length);
    }
  });

  it("computes the Announcement selector the chain uses", () => {
    // keys[0] of the live Sepolia event — on-chain truth for sn_keccak.
    expect(starknetKeccak("Announcement")).toBe(
      0x3b0aef39a70b56ef15742493d76e4564fece25d63e44474e1e3434aa467a374n,
    );
  });

  it("decodes the live Sepolia announcement to the canonical vector", () => {
    const a = decodeAnnouncementEvent(LIVE_EVENT);
    expect(a).not.toBeNull();
    expect(a!.stealthAddress).toBe(STEALTH_ADDRESS);
    expect(a!.ephemeralPubKey).toEqual(hexToBytes(EPHEMERAL));
    expect(a!.viewTag).toBe(VIEW_TAG);
    expect(a!.metadata).toEqual(Uint8Array.from([VIEW_TAG]));
    expect(a!.chainId).toBe(OPAQUE_CHAIN_STARKNET);
    expect(a!.cursor).toBe(12158304n);
  });

  it("builds announce calldata matching the accepted transaction", () => {
    const call = buildAnnounceCall({
      stealthAddress: STEALTH_ADDRESS,
      ephemeralPubKey: hexToBytes(EPHEMERAL),
      metadata: Uint8Array.from([VIEW_TAG]),
    });
    // Exactly the calldata Sepolia accepted in the tx above (scheme u256,
    // stealth felt, ByteArray ephemeral, ByteArray metadata).
    expect(call.calldata).toEqual([
      "0x1",
      "0x0",
      "0xa5847a467208cbcd5d238369865a90716310183a",
      "0x1",
      "0x2b95c249d84f417e3e395a127425428b540671cc15881eb828c17b722a53f",
      "0xc599",
      "0x2",
      "0x0",
      "0xe1",
      "0x1",
    ]);
    expect(call.entrypoint).toBe("announce");
    expect(call.contractAddress).toBe(STARKNET_SEPOLIA.stealthAnnouncer);
  });

  it("rejects malformed announcements without throwing", () => {
    expect(decodeAnnouncementEvent({ ...LIVE_EVENT, keys: LIVE_EVENT.keys.slice(0, 3) })).toBeNull();
    // scheme id != 1
    expect(
      decodeAnnouncementEvent({
        ...LIVE_EVENT,
        keys: [LIVE_EVENT.keys[0], "0x2", "0x0", LIVE_EVENT.keys[3], LIVE_EVENT.keys[4]],
      }),
    ).toBeNull();
    // truncated data
    expect(decodeAnnouncementEvent({ ...LIVE_EVENT, data: LIVE_EVENT.data.slice(0, 2) })).toBeNull();
  });

  it("fetches and normalises announcements through the adapter", async () => {
    const fetchFn = (async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as { body: string }).body);
      expect(body.method).toBe("starknet_getEvents");
      expect(body.params[0].address).toBe(STARKNET_SEPOLIA.stealthAnnouncer);
      return {
        json: async () => ({ result: { events: [LIVE_EVENT] } }),
      };
    }) as unknown as typeof fetch;

    const adapter = new StarknetAdapter({ fetchFn });
    expect(adapter.chainId).toBe(OPAQUE_CHAIN_STARKNET);
    expect(adapter.name).toBe("starknet");
    const out = await adapter.fetchAnnouncements();
    expect(out).toHaveLength(1);
    expect(out[0].stealthAddress).toBe(STEALTH_ADDRESS);
    expect(out[0].viewTag).toBe(VIEW_TAG);
  });

  it("resolves meta-addresses via registry calls", async () => {
    const meta = Uint8Array.from({ length: 98 }, (_, i) => i);
    const felts = encodeByteArray(meta).map((f) => `0x${f.toString(16)}`);
    const fetchFn = (async () => ({
      json: async () => ({ result: felts }),
    })) as unknown as typeof fetch;

    const adapter = new StarknetAdapter({ fetchFn });
    const resolved = await adapter.resolveMetaAddress("0x1234");
    expect(resolved).toBe(
      `0x${Array.from(meta, (b) => b.toString(16).padStart(2, "0")).join("")}`,
    );

    const emptyFetch = (async () => ({
      json: async () => ({ result: ["0x0", "0x0", "0x0"] }),
    })) as unknown as typeof fetch;
    const empty = new StarknetAdapter({ fetchFn: emptyFetch });
    expect(await empty.resolveMetaAddress("0x1234")).toBeNull();
    expect(await empty.isRegistered("0x1234")).toBe(false);
  });

  it("validates register_keys input lengths", () => {
    expect(() => buildRegisterKeysCall(new Uint8Array(97))).toThrow(/66 or 98/);
    const call = buildRegisterKeysCall(new Uint8Array(98));
    expect(call.entrypoint).toBe("register_keys");
    expect(call.calldata[0]).toBe("0x1");
  });

  // Live network check (public RPC): finds the canonical announcement on
  // Sepolia end-to-end. Gated to avoid CI flakiness.
  it.skipIf(!process.env.OPAQUE_STARKNET_LIVE)(
    "finds the live canonical announcement on Sepolia",
    async () => {
      const adapter = new StarknetAdapter({});
      const out = await adapter.fetchAnnouncements();
      const hit = out.find((a) => a.stealthAddress === STEALTH_ADDRESS);
      expect(hit).toBeDefined();
      expect(hit!.viewTag).toBe(VIEW_TAG);
    },
    30_000,
  );
});
