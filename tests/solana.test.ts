import { describe, it, expect } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
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
  // stealth (native ed25519)
  ed25519SpendPublicKey,
  deriveSolanaStealthPoint,
  reconstructSolanaStealthScalar,
  deriveStealthSolanaAddress,
  stealthSolanaSigner,
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
    const meta = Uint8Array.from(Array(98).fill(0xcd));
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

  it("decodes a 98-byte meta-address out of a RegistryEntry account", () => {
    const meta = Uint8Array.from(Array(98).fill(0xab));
    const acct = new Uint8Array(8 + 32 + 8 + 4 + 98);
    acct.set(meta, 8 + 32 + 8 + 4);
    expect(decodeRegistryEntryMetaAddress(acct)).toBe("0x" + "ab".repeat(98));
    expect(decodeRegistryEntryMetaAddress(new Uint8Array(10))).toBeNull();
  });

  it("resolves a meta-address through a connection (and null when missing)", async () => {
    const meta = Uint8Array.from(Array(98).fill(0x05));
    const acct = new Uint8Array(8 + 32 + 8 + 4 + 98);
    acct.set(meta, 52);

    const present = {
      getAccountInfo: async () => ({ data: Buffer.from(acct) }),
    } as unknown as Connection;
    const absent = {
      getAccountInfo: async () => null,
    } as unknown as Connection;

    expect(
      await resolveMetaAddress(present, { registryProgramId, registrant }),
    ).toBe("0x" + "05".repeat(98));
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

describe("native ed25519 Solana stealth derivation (OPQ-002)", () => {
  // A shared secp256k1 ECDH secret (33-byte compressed point) stands in for `v·R`.
  const shared = Uint8Array.from([0x02, ...Array(32).fill(0x11)]);

  it("the sender-computed address equals the recipient's reconstructed signer, and signs", () => {
    const spendSeed = Uint8Array.from(Array(32).fill(7)); // recipient s_ed seed
    const S_ed = ed25519SpendPublicKey(spendSeed);

    // Sender / view-only scanner: derive the address from PUBLIC material only.
    const point = deriveSolanaStealthPoint(S_ed, shared);
    const address = deriveStealthSolanaAddress(point);

    // Recipient: reconstruct the one-time spend scalar and build the signer.
    const scalar = reconstructSolanaStealthScalar(spendSeed, shared);
    const signer = stealthSolanaSigner(scalar);
    expect(signer.publicKey.toBase58()).toBe(address);

    // The signer produces a standard ed25519 signature that verifies against the address.
    const msg = Uint8Array.from(Array(48).fill(9));
    const sig = signer.sign(msg);
    expect(sig).toHaveLength(64);
    expect(ed25519.verify(sig, msg, point)).toBe(true);
  });

  it("maps distinct shared secrets to distinct destinations", () => {
    const S_ed = ed25519SpendPublicKey(Uint8Array.from(Array(32).fill(3)));
    const a = deriveSolanaStealthPoint(S_ed, Uint8Array.from([0x02, ...Array(32).fill(1)]));
    const b = deriveSolanaStealthPoint(S_ed, Uint8Array.from([0x02, ...Array(32).fill(2)]));
    expect(deriveStealthSolanaAddress(a)).not.toBe(deriveStealthSolanaAddress(b));
  });

  it("binds the spend scalar to s_ed: the payer (lacking s_ed) cannot derive it", () => {
    // OPQ-002 regression: the address is public-derivable, the spend scalar is not.
    const s1 = reconstructSolanaStealthScalar(Uint8Array.from(Array(32).fill(7)), shared);
    const s2 = reconstructSolanaStealthScalar(Uint8Array.from(Array(32).fill(8)), shared);
    expect(Buffer.from(s1).equals(Buffer.from(s2))).toBe(false);
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
    const meta = Uint8Array.from(Array(98).fill(0x05));
    const acct = new Uint8Array(8 + 32 + 8 + 4 + 98);
    acct.set(meta, 52);
    const conn = {
      getSignaturesForAddress: async () => [{ signature: "s", slot: 1, err: null }],
      getTransaction: async () => ({ meta: { logMessages: [line] } }),
      getAccountInfo: async () => ({ data: Buffer.from(acct) }),
    } as unknown as Connection;

    const adapter = new SolanaAdapter({ connection: conn });
    expect(await adapter.fetchAnnouncements({ limit: 5 })).toHaveLength(1);
    expect(await adapter.resolveMetaAddress(DEVNET_REGISTRY)).toBe("0x" + "05".repeat(98));
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
