/**
 * Offline coverage for the OpaqueClient cross-chain surface: the unified buildAnnounceWithRelay
 * dispatch (Solana path is pure instruction building) and scan() wiring. Live matching + the EVM
 * relay fee read are covered by the env-gated e2e-live tests.
 */
import { describe, it, expect } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { OpaqueClient } from "@opaquecash/opaque";

const DEVNET_ANNOUNCER = "HGFn2fH7bVQ5cSuiG52NjzN9m11YrB3FZUfoN9b9A5jf";
const WORMHOLE_CORE = "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";

const baseConfig = {
  chainId: 11155111,
  rpcUrl: "https://ethereum-sepolia.publicnode.com",
  walletSignature: ("0x" + "11".repeat(65)) as `0x${string}`,
  ethereumAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`,
};

const send = {
  schemeId: 1n,
  stealthAddress: ("0x" + "ab".repeat(20)) as `0x${string}`,
  viewTag: 0x7f,
  ephemeralPublicKey: Uint8Array.from([0x02, ...Array(32).fill(0x11)]),
  ephemeralPrivateKey: new Uint8Array(32),
  metadata: Uint8Array.from([0x7f]),
};

/** Connection that yields no announcements (keeps scan offline / WASM-free). */
function emptyConnection(): Connection {
  return {
    getSignaturesForAddress: async () => [],
  } as unknown as Connection;
}

describe("OpaqueClient.buildAnnounceWithRelay (Solana)", () => {
  it("builds an announce_with_relay instruction + message signer", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
      solanaWallet: { publicKey: PublicKey.default, signTransaction: async (t) => t },
    });
    const result = await client.buildAnnounceWithRelay("solana", send, { wormholeFee: 0n });
    expect(result.chain).toBe("solana");
    if (result.chain !== "solana") throw new Error("unreachable");
    expect(result.instructions).toHaveLength(1);
    expect(result.signers).toHaveLength(1);
    const ix = result.instructions[0];
    expect(ix.programId.toBase58()).toBe(DEVNET_ANNOUNCER);
    // wormhole_program account = the core; wormhole_message = the returned signer.
    expect(ix.keys[6].pubkey.toBase58()).toBe(WORMHOLE_CORE);
    expect(ix.keys[5].pubkey.toBase58()).toBe(result.signers[0].publicKey.toBase58());
  });

  it("requires a Solana wallet", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
    });
    await expect(
      client.buildAnnounceWithRelay("solana", send, { wormholeFee: 0n }),
    ).rejects.toThrow(/solanaWallet/);
  });

  it("rejects an unsupported chain", async () => {
    const client = await OpaqueClient.create(baseConfig);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.buildAnnounceWithRelay("dogecoin" as any, send),
    ).rejects.toThrow(/unsupported announce-with-relay chain/);
  });
});

describe("OpaqueClient.scan (offline wiring)", () => {
  it("returns an empty inbox when no announcements exist and cross-chain is off", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
    });
    const out = await client.scan({ chains: ["solana"], includeCrossChain: false });
    expect(out).toEqual([]);
  });
});
