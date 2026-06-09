import { describe, it, expect } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { WORMHOLE_CHAIN_SOLANA, type Announcement } from "@opaquecash/adapter";
import {
  // programs
  getSolanaDeployment,
  CLUSTER_ENDPOINTS,
  SCHEME_ID_SECP256K1,
  ANNOUNCE_DISCRIMINATOR,
  REGISTER_KEYS_DISCRIMINATOR,
  ANNOUNCEMENT_EVENT_DISCRIMINATOR,
  // registry
  getRegistryEntryPda,
  buildRegisterKeysInstruction,
  decodeRegistryEntryMetaAddress,
  resolveMetaAddress,
  isRegistered,
  // announcer
  buildAnnounceInstruction,
  encodeAnnouncementEventData,
  decodeAnnouncementEventData,
  decodeAnnouncementLogs,
  fetchAnnouncementsRange,
  watchAnnouncements,
  // stealth
  deriveStealthSolanaKeypair,
  deriveStealthSolanaAddress,
  deriveStealthSolanaKeypairFromStealthPrivKey,
  deriveStealthSolanaAddressFromStealthPrivKey,
  // adapter
  SolanaAdapter,
  // bytes
  ByteReader,
  bytesToHex,
} from "@opaquecash/stealth-chain-solana";

const DEVNET_ANNOUNCER = "HGFn2fH7bVQ5cSuiG52NjzN9m11YrB3FZUfoN9b9A5jf";
const DEVNET_REGISTRY = "E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno";

function progDataLine(bytes: Uint8Array): string {
  return "Program data: " + Buffer.from(bytes).toString("base64");
}

function sampleEvent(over: Partial<{
  schemeId: bigint;
  stealthAddress: Uint8Array;
  caller: Uint8Array;
  ephemeralPubKey: Uint8Array;
  metadata: Uint8Array;
}> = {}) {
  return {
    schemeId: over.schemeId ?? SCHEME_ID_SECP256K1,
    stealthAddress: over.stealthAddress ?? Uint8Array.from(Array(20).fill(0xab)),
    caller: over.caller ?? PublicKey.default.toBytes(),
    ephemeralPubKey:
      over.ephemeralPubKey ?? Uint8Array.from([0x02, ...Array(32).fill(0x11)]),
    metadata: over.metadata ?? Uint8Array.from([0x7f, 0xde, 0xad]),
  };
}

describe("programs / deployment config", () => {
  it("resolves bundled devnet program ids", () => {
    const d = getSolanaDeployment("devnet");
    expect(d.cluster).toBe("devnet");
    expect(d.stealthAnnouncer.toBase58()).toBe(DEVNET_ANNOUNCER);
    expect(d.stealthRegistry.toBase58()).toBe(DEVNET_REGISTRY);
    expect(d.stealthAnnouncer).toBeInstanceOf(PublicKey);
  });

  it("defaults to devnet and throws for clusters without bundled ids", () => {
    expect(getSolanaDeployment().cluster).toBe("devnet");
    expect(() => getSolanaDeployment("mainnet-beta")).toThrow(/no bundled/i);
  });

  it("exposes 8-byte discriminators and a public RPC per cluster", () => {
    expect(ANNOUNCE_DISCRIMINATOR).toHaveLength(8);
    expect(REGISTER_KEYS_DISCRIMINATOR).toHaveLength(8);
    expect(ANNOUNCEMENT_EVENT_DISCRIMINATOR).toHaveLength(8);
    expect([...ANNOUNCE_DISCRIMINATOR]).toEqual([7, 30, 100, 250, 110, 253, 3, 149]);
    expect(CLUSTER_ENDPOINTS.devnet).toMatch(/devnet/);
  });
});

describe("registry", () => {
  const registryProgramId = new PublicKey(DEVNET_REGISTRY);
  const registrant = PublicKey.default;

  it("derives a deterministic registry entry PDA", () => {
    const a = getRegistryEntryPda(registryProgramId, registrant);
    const b = getRegistryEntryPda(registryProgramId, registrant);
    expect(a.toBase58()).toBe(b.toBase58());
    expect(a).toBeInstanceOf(PublicKey);
  });

  it("builds register_keys instruction data and accounts", () => {
    const meta = Uint8Array.from(Array(66).fill(0xcd));
    const ix = buildRegisterKeysInstruction({
      registryProgramId,
      registrant,
      stealthMetaAddress: meta,
    });
    expect(ix.programId.toBase58()).toBe(DEVNET_REGISTRY);
    // accounts: [entryPda, registrant(signer,writable), systemProgram]
    expect(ix.keys).toHaveLength(3);
    expect(ix.keys[1].pubkey.toBase58()).toBe(registrant.toBase58());
    expect(ix.keys[1].isSigner).toBe(true);

    const data = new Uint8Array(ix.data);
    expect([...data.slice(0, 8)]).toEqual([...REGISTER_KEYS_DISCRIMINATOR]);
    const r = new ByteReader(data, 8);
    expect(r.readU64()).toBe(SCHEME_ID_SECP256K1);
    expect([...r.readVecU8()]).toEqual([...meta]);
  });

  it("decodes a 66-byte meta-address out of a RegistryEntry account", () => {
    const meta = Uint8Array.from(Array(66).fill(0xab));
    const acct = new Uint8Array(8 + 32 + 8 + 4 + 66);
    acct.set(meta, 8 + 32 + 8 + 4);
    expect(decodeRegistryEntryMetaAddress(acct)).toBe("0x" + "ab".repeat(66));
    expect(decodeRegistryEntryMetaAddress(new Uint8Array(10))).toBeNull();
  });

  it("resolves a meta-address through a connection (and null when missing)", async () => {
    const meta = Uint8Array.from(Array(66).fill(0x05));
    const acct = new Uint8Array(8 + 32 + 8 + 4 + 66);
    acct.set(meta, 52);

    const present = {
      getAccountInfo: async () => ({ data: Buffer.from(acct) }),
    } as unknown as Connection;
    const absent = {
      getAccountInfo: async () => null,
    } as unknown as Connection;

    expect(
      await resolveMetaAddress(present, { registryProgramId, registrant }),
    ).toBe("0x" + "05".repeat(66));
    expect(await isRegistered(present, { registryProgramId, registrant })).toBe(true);
    expect(
      await resolveMetaAddress(absent, { registryProgramId, registrant }),
    ).toBeNull();
    expect(await isRegistered(absent, { registryProgramId, registrant })).toBe(false);
  });
});

describe("announcer", () => {
  const announcerProgramId = new PublicKey(DEVNET_ANNOUNCER);
  const caller = PublicKey.default;

  it("builds announce instruction data round-trippable via ByteReader", () => {
    const stealthAddress = Uint8Array.from(Array(20).fill(0x42));
    const ephemeralPubKey = Uint8Array.from([0x03, ...Array(32).fill(0x09)]);
    const metadata = Uint8Array.from([0x7f]);
    const ix = buildAnnounceInstruction({
      announcerProgramId,
      caller,
      stealthAddress,
      ephemeralPubKey,
      metadata,
    });
    expect(ix.programId.toBase58()).toBe(DEVNET_ANNOUNCER);
    expect(ix.keys).toHaveLength(1);
    expect(ix.keys[0].isSigner).toBe(true);

    const data = new Uint8Array(ix.data);
    expect([...data.slice(0, 8)]).toEqual([...ANNOUNCE_DISCRIMINATOR]);
    const r = new ByteReader(data, 8);
    expect(r.readU64()).toBe(SCHEME_ID_SECP256K1);
    expect([...r.readVecU8()]).toEqual([...stealthAddress]);
    expect([...r.readVecU8()]).toEqual([...ephemeralPubKey]);
    expect([...r.readVecU8()]).toEqual([...metadata]);
  });

  it("encodes and decodes an Announcement event symmetrically", () => {
    const ev = sampleEvent();
    const decoded = decodeAnnouncementEventData(encodeAnnouncementEventData(ev));
    expect(decoded).not.toBeNull();
    expect(decoded!.schemeId).toBe(ev.schemeId);
    expect([...decoded!.stealthAddress]).toEqual([...ev.stealthAddress]);
    expect([...decoded!.caller]).toEqual([...ev.caller]);
    expect([...decoded!.ephemeralPubKey]).toEqual([...ev.ephemeralPubKey]);
    expect([...decoded!.metadata]).toEqual([...ev.metadata]);
  });

  it("returns null when the event discriminator does not match", () => {
    const bad = new Uint8Array(64); // all-zero discriminator
    expect(decodeAnnouncementEventData(bad)).toBeNull();
  });

  it("decodes matching Announcement logs into chain-neutral announcements", () => {
    const ev = sampleEvent({ metadata: Uint8Array.from([0x7f, 0x01]) });
    const logs = [
      "Program log: some unrelated log",
      progDataLine(encodeAnnouncementEventData(ev)),
    ];
    const out = decodeAnnouncementLogs(logs, { txHash: "sigA", cursor: 99n });
    expect(out).toHaveLength(1);
    const a = out[0];
    expect(a.stealthAddress).toBe("0x" + bytesToHex(ev.stealthAddress));
    expect(a.viewTag).toBe(0x7f);
    expect(a.ephemeralPubKey).toHaveLength(33);
    expect(a.chainId).toBe(WORMHOLE_CHAIN_SOLANA);
    expect(a.txHash).toBe("sigA");
    expect(a.cursor).toBe(99n);
  });

  it("filters wrong scheme ids and malformed ephemeral keys", () => {
    const wrongScheme = progDataLine(encodeAnnouncementEventData(sampleEvent({ schemeId: 2n })));
    const shortEph = progDataLine(
      encodeAnnouncementEventData(
        sampleEvent({ ephemeralPubKey: Uint8Array.from([0x02, 0x02]) }),
      ),
    );
    expect(decodeAnnouncementLogs([wrongScheme, shortEph])).toHaveLength(0);
  });

  it("fetches a range via a connection mock", async () => {
    const line = progDataLine(encodeAnnouncementEventData(sampleEvent()));
    const conn = {
      getSignaturesForAddress: async () => [
        { signature: "sig1", slot: 123, err: null },
        { signature: "sigErr", slot: 124, err: {} },
      ],
      getTransaction: async (sig: string) =>
        sig === "sig1" ? { meta: { logMessages: [line] } } : null,
    } as unknown as Connection;

    const out = await fetchAnnouncementsRange(conn, { announcerProgramId, limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].txHash).toBe("sig1");
    expect(out[0].cursor).toBe(123n);
  });

  it("watches logs and unsubscribes", () => {
    const line = progDataLine(encodeAnnouncementEventData(sampleEvent()));
    let cb: ((info: { err: unknown; logs: string[]; signature: string }) => void) | undefined;
    let removed: number | undefined;
    const conn = {
      onLogs: (_pid: unknown, callback: typeof cb) => {
        cb = callback;
        return 7;
      },
      removeOnLogsListener: (id: number) => {
        removed = id;
      },
    } as unknown as Connection;

    const received: Announcement[] = [];
    const unsub = watchAnnouncements(conn, {
      announcerProgramId,
      onAnnouncement: (a) => received.push(a),
    });
    cb!({ err: null, logs: [line], signature: "sigW" });
    expect(received).toHaveLength(1);
    expect(received[0].txHash).toBe("sigW");
    unsub();
    expect(removed).toBe(7);
  });
});

describe("stealth Solana destination derivation", () => {
  it("is deterministic and agrees between pubkey and privkey paths", () => {
    const priv = Uint8Array.from(Array(32).fill(7));
    const uncompressed = secp256k1.getPublicKey(priv, false);

    const fromPub = deriveStealthSolanaKeypair(uncompressed).publicKey.toBase58();
    const fromPriv = deriveStealthSolanaKeypairFromStealthPrivKey(priv).publicKey.toBase58();
    expect(fromPriv).toBe(fromPub);
    expect(deriveStealthSolanaAddress(uncompressed)).toBe(fromPub);
    expect(deriveStealthSolanaAddressFromStealthPrivKey(priv)).toBe(fromPub);

    // deterministic across calls
    expect(deriveStealthSolanaAddress(uncompressed)).toBe(
      deriveStealthSolanaAddress(uncompressed),
    );
  });

  it("maps distinct stealth points to distinct destinations", () => {
    const a = secp256k1.getPublicKey(Uint8Array.from(Array(32).fill(7)), false);
    const b = secp256k1.getPublicKey(Uint8Array.from(Array(32).fill(9)), false);
    expect(deriveStealthSolanaAddress(a)).not.toBe(deriveStealthSolanaAddress(b));
  });
});

describe("SolanaAdapter", () => {
  it("reports the Wormhole Solana chain id and name", () => {
    const a = new SolanaAdapter();
    expect(a.chainId).toBe(WORMHOLE_CHAIN_SOLANA);
    expect(a.name).toBe("solana");
    expect(a.deployment.cluster).toBe("devnet");
    expect(a.deployment.stealthAnnouncer.toBase58()).toBe(DEVNET_ANNOUNCER);
  });

  it("delegates fetch/resolve to its connection and builds instructions", async () => {
    const line = progDataLine(encodeAnnouncementEventData(sampleEvent()));
    const meta = Uint8Array.from(Array(66).fill(0x05));
    const acct = new Uint8Array(8 + 32 + 8 + 4 + 66);
    acct.set(meta, 52);
    const conn = {
      getSignaturesForAddress: async () => [{ signature: "s", slot: 1, err: null }],
      getTransaction: async () => ({ meta: { logMessages: [line] } }),
      getAccountInfo: async () => ({ data: Buffer.from(acct) }),
    } as unknown as Connection;

    const adapter = new SolanaAdapter({ connection: conn });
    expect(await adapter.fetchAnnouncements({ limit: 5 })).toHaveLength(1);
    expect(await adapter.resolveMetaAddress(DEVNET_REGISTRY)).toBe("0x" + "05".repeat(66));
    expect(await adapter.isRegistered(DEVNET_REGISTRY)).toBe(true);

    const ix = adapter.buildAnnounceInstruction({
      caller: PublicKey.default,
      stealthAddress: Uint8Array.from(Array(20).fill(1)),
      ephemeralPubKey: Uint8Array.from([0x02, ...Array(32).fill(3)]),
      metadata: Uint8Array.from([0x10]),
    });
    expect(ix.programId.toBase58()).toBe(DEVNET_ANNOUNCER);
  });
});
