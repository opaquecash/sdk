import { describe, it, expect } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getSolanaDeployment,
  WORMHOLE_CORE_DEVNET,
  SCHEME_ID_SECP256K1,
  ANNOUNCE_WITH_RELAY_DISCRIMINATOR,
  deriveWormholeEmitterPda,
  deriveWormholeConfigPda,
  deriveWormholeFeeCollectorPda,
  deriveWormholeSequencePda,
  fetchWormholeMessageFee,
  buildAnnounceWithRelayInstruction,
  buildAnnounceWithRelay,
  SolanaAdapter,
  ByteReader,
} from "@opaquecash/stealth-chain-solana";

const DEVNET_ANNOUNCER = "HGFn2fH7bVQ5cSuiG52NjzN9m11YrB3FZUfoN9b9A5jf";

const announcer = new PublicKey(DEVNET_ANNOUNCER);
const core = new PublicKey(WORMHOLE_CORE_DEVNET);

function sampleArgs(over: Partial<{
  stealthAddress: Uint8Array;
  ephemeralPubKey: Uint8Array;
  metadata: Uint8Array;
  batchId: number;
  wormholeFee: bigint;
}> = {}) {
  return {
    caller: PublicKey.default,
    stealthAddress: over.stealthAddress ?? Uint8Array.from(Array(20).fill(0x42)),
    ephemeralPubKey: over.ephemeralPubKey ?? Uint8Array.from([0x02, ...Array(32).fill(0x09)]),
    metadata: over.metadata ?? Uint8Array.from([0x7f, 0xab, 0xcd]),
    batchId: over.batchId,
    wormholeFee: over.wormholeFee,
  };
}

describe("deployment exposes the Wormhole core", () => {
  it("bundles the devnet core program id", () => {
    expect(getSolanaDeployment("devnet").wormholeCore.toBase58()).toBe(WORMHOLE_CORE_DEVNET);
    expect(ANNOUNCE_WITH_RELAY_DISCRIMINATOR).toHaveLength(8);
    expect([...ANNOUNCE_WITH_RELAY_DISCRIMINATOR]).toEqual([3, 242, 201, 249, 200, 171, 146, 79]);
  });
});

describe("Wormhole PDA derivation", () => {
  it("is deterministic", () => {
    const emitter = deriveWormholeEmitterPda(announcer);
    expect(deriveWormholeEmitterPda(announcer).toBase58()).toBe(emitter.toBase58());
    expect(emitter).toBeInstanceOf(PublicKey);
    // emitter PDA seeded under the announcer; sequence seeded under the core with that emitter.
    const seq = deriveWormholeSequencePda(core, emitter);
    expect(deriveWormholeSequencePda(core, emitter).toBase58()).toBe(seq.toBase58());
    expect(deriveWormholeConfigPda(core)).toBeInstanceOf(PublicKey);
    expect(deriveWormholeFeeCollectorPda(core)).toBeInstanceOf(PublicKey);
  });
});

describe("buildAnnounceWithRelayInstruction", () => {
  it("encodes the discriminator + Borsh args round-trippable via ByteReader", () => {
    const message = Keypair.generate().publicKey;
    const args = sampleArgs({ batchId: 7, wormholeFee: 12345n });
    const ix = buildAnnounceWithRelayInstruction({
      announcerProgramId: announcer,
      wormholeCore: core,
      wormholeMessage: message,
      ...args,
    });
    expect(ix.programId.toBase58()).toBe(DEVNET_ANNOUNCER);

    const data = new Uint8Array(ix.data);
    expect([...data.slice(0, 8)]).toEqual([...ANNOUNCE_WITH_RELAY_DISCRIMINATOR]);
    const r = new ByteReader(data, 8);
    expect(r.readU64()).toBe(SCHEME_ID_SECP256K1);
    expect([...r.readVecU8()]).toEqual([...args.stealthAddress]);
    expect([...r.readVecU8()]).toEqual([...args.ephemeralPubKey]);
    expect([...r.readVecU8()]).toEqual([...args.metadata]);
    expect(r.readU32()).toBe(7);
    expect(r.readU64()).toBe(12345n);
  });

  it("orders accounts to match the IDL with correct signer/writable flags", () => {
    const message = Keypair.generate().publicKey;
    const ix = buildAnnounceWithRelayInstruction({
      announcerProgramId: announcer,
      wormholeCore: core,
      wormholeMessage: message,
      ...sampleArgs(),
    });
    const emitter = deriveWormholeEmitterPda(announcer);
    expect(ix.keys).toHaveLength(10);
    // caller (signer + writable)
    expect(ix.keys[0].pubkey.toBase58()).toBe(PublicKey.default.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    // wormhole_emitter (PDA, neither signer nor writable in the outer ix)
    expect(ix.keys[1].pubkey.toBase58()).toBe(emitter.toBase58());
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(false);
    // config / fee_collector / sequence are writable, not signers
    for (const i of [2, 3, 4]) {
      expect(ix.keys[i].isSigner).toBe(false);
      expect(ix.keys[i].isWritable).toBe(true);
    }
    expect(ix.keys[2].pubkey.toBase58()).toBe(deriveWormholeConfigPda(core).toBase58());
    expect(ix.keys[3].pubkey.toBase58()).toBe(deriveWormholeFeeCollectorPda(core).toBase58());
    expect(ix.keys[4].pubkey.toBase58()).toBe(deriveWormholeSequencePda(core, emitter).toBase58());
    // wormhole_message (signer + writable)
    expect(ix.keys[5].pubkey.toBase58()).toBe(message.toBase58());
    expect(ix.keys[5].isSigner).toBe(true);
    expect(ix.keys[5].isWritable).toBe(true);
    // wormhole_program = core (readonly)
    expect(ix.keys[6].pubkey.toBase58()).toBe(WORMHOLE_CORE_DEVNET);
    expect(ix.keys[6].isSigner).toBe(false);
    expect(ix.keys[6].isWritable).toBe(false);
    // clock / rent / system_program (readonly, not signers)
    for (const i of [7, 8, 9]) {
      expect(ix.keys[i].isSigner).toBe(false);
      expect(ix.keys[i].isWritable).toBe(false);
    }
  });

  it("defaults batch_id to 0 and wormhole_fee to 0", () => {
    const ix = buildAnnounceWithRelayInstruction({
      announcerProgramId: announcer,
      wormholeCore: core,
      wormholeMessage: Keypair.generate().publicKey,
      ...sampleArgs(),
    });
    const data = new Uint8Array(ix.data);
    const r = new ByteReader(data, 8);
    r.readU64(); // schemeId
    r.readVecU8(); // stealthAddress
    r.readVecU8(); // ephemeralPubKey
    r.readVecU8(); // metadata
    expect(r.readU32()).toBe(0);
    expect(r.readU64()).toBe(0n);
  });
});

describe("buildAnnounceWithRelay (mints message keypair)", () => {
  it("returns a fresh signer keypair referenced by the instruction", () => {
    const a = buildAnnounceWithRelay({
      announcerProgramId: announcer,
      wormholeCore: core,
      ...sampleArgs(),
    });
    const b = buildAnnounceWithRelay({
      announcerProgramId: announcer,
      wormholeCore: core,
      ...sampleArgs(),
    });
    expect(a.messageKeypair.publicKey.toBase58()).not.toBe(b.messageKeypair.publicKey.toBase58());
    expect(a.instruction.keys[5].pubkey.toBase58()).toBe(a.messageKeypair.publicKey.toBase58());
    expect(a.instruction.keys[5].isSigner).toBe(true);
  });
});

describe("fetchWormholeMessageFee", () => {
  it("reads the u64 LE fee at offset 16", async () => {
    const data = new Uint8Array(24);
    new DataView(data.buffer).setBigUint64(16, 6500n, true);
    const conn = {
      getAccountInfo: async () => ({ data: Buffer.from(data) }),
    } as unknown as Connection;
    expect(await fetchWormholeMessageFee(conn, core)).toBe(6500n);
  });

  it("returns 0n when the config account is missing or short", async () => {
    const absent = { getAccountInfo: async () => null } as unknown as Connection;
    const short = {
      getAccountInfo: async () => ({ data: Buffer.from(new Uint8Array(8)) }),
    } as unknown as Connection;
    expect(await fetchWormholeMessageFee(absent, core)).toBe(0n);
    expect(await fetchWormholeMessageFee(short, core)).toBe(0n);
  });
});

describe("SolanaAdapter.buildAnnounceWithRelay", () => {
  it("uses the deployment announcer + core program ids", () => {
    const adapter = new SolanaAdapter();
    const { instruction, messageKeypair } = adapter.buildAnnounceWithRelay(sampleArgs());
    expect(instruction.programId.toBase58()).toBe(DEVNET_ANNOUNCER);
    expect(instruction.keys[6].pubkey.toBase58()).toBe(WORMHOLE_CORE_DEVNET);
    expect(instruction.keys[5].pubkey.toBase58()).toBe(messageKeypair.publicKey.toBase58());
  });
});
