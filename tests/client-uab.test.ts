/**
 * Offline coverage for the OpaqueClient cross-chain surface: the unified buildAnnounceWithRelay
 * dispatch (Solana path is pure instruction building) and scan() wiring. Live matching + the EVM
 * relay fee read are covered by the env-gated e2e-live tests.
 */
import { describe, it, expect } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  OpaqueClient,
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
} from "@opaquecash/opaque";

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

describe("OpaqueClient.registerMetaAddress", () => {
  it("requires an Ethereum signer for the Ethereum path", async () => {
    const client = await OpaqueClient.create(baseConfig);
    await expect(client.registerMetaAddress("ethereum")).rejects.toThrow(/ethereumProvider/);
  });

  it("requires a Solana wallet for the Solana path", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
    });
    await expect(client.registerMetaAddress("solana")).rejects.toThrow(/solanaWallet/);
  });

  it("rejects an unsupported chain", async () => {
    const client = await OpaqueClient.create(baseConfig);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(client.registerMetaAddress("dogecoin" as any)).rejects.toThrow(
      /unsupported register chain/,
    );
  });

  it("reads Solana registration status from the registry PDA", async () => {
    const meta = Uint8Array.from(Array(66).fill(0x05));
    const acct = new Uint8Array(8 + 32 + 8 + 4 + 66);
    acct.set(meta, 52);
    const registered = {
      getSignaturesForAddress: async () => [],
      getAccountInfo: async () => ({ data: Buffer.from(acct) }),
    } as unknown as Connection;
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: registered },
      solanaWallet: { publicKey: PublicKey.default, signTransaction: async (t) => t },
    });
    expect(await client.isMetaAddressRegistered("solana")).toBe(true);
  });
});

describe("OpaqueClient.submitReputationVerification", () => {
  const repArgs = {
    proofData: {
      proof: { pi_a: ["1", "2"], pi_b: [["1", "2"], ["3", "4"]], pi_c: ["1", "2"] },
      publicSignals: ["1"],
      nullifier: "1",
      attestationId: 1,
    },
    merkleRoot: "1",
    externalNullifier: "1",
  };

  it("requires an Ethereum signer for the Ethereum path", async () => {
    const client = await OpaqueClient.create(baseConfig);
    await expect(client.submitReputationVerification("ethereum", repArgs)).rejects.toThrow(
      /ethereumProvider/,
    );
  });

  it("requires a Solana wallet for the Solana path", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
    });
    await expect(client.submitReputationVerification("solana", repArgs)).rejects.toThrow(
      /solanaWallet/,
    );
  });

  it("rejects an unsupported chain", async () => {
    const client = await OpaqueClient.create(baseConfig);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.submitReputationVerification("dogecoin" as any, repArgs),
    ).rejects.toThrow(/unsupported chain/);
  });
});

describe("OpaqueClient.sendStealthPayment (offline)", () => {
  it("sends an ERC-20 to the stealth address as transfer calldata", async () => {
    const client = await OpaqueClient.create(baseConfig);
    const calls: Array<{ to?: string; data?: string; value?: bigint }> = [];
    (client as unknown as { evmWalletClientCache: unknown }).evmWalletClientCache = {
      chain: undefined,
      account: undefined,
      sendTransaction: async (tx: { to?: string; data?: string; value?: bigint }) => {
        calls.push(tx);
        return "0xsent";
      },
    };
    const meta = client.getMetaAddressHex();
    const token = "0x73197e8303904862d543f9706E8422F634D713cb";
    const res = await client.sendStealthPayment({
      chain: "ethereum",
      recipient: meta,
      amount: 1_000_000n,
      token,
      announce: false,
    });
    expect(res.txHash).toBe("0xsent");
    expect(calls).toHaveLength(1);
    expect(calls[0].to?.toLowerCase()).toBe(token.toLowerCase());
    // ERC-20 transfer(address,uint256) selector; no native value.
    expect(calls[0].data?.startsWith("0xa9059cbb")).toBe(true);
    expect(calls[0].value).toBeUndefined();
  });

  it("requires a Solana wallet for the Solana path", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
    });
    const meta = client.getMetaAddressHex();
    await expect(
      client.sendStealthPayment({ chain: "solana", recipient: meta, amount: 1000n }),
    ).rejects.toThrow(/solanaWallet/);
  });

  it("requires an Ethereum signer for the Ethereum path", async () => {
    const client = await OpaqueClient.create(baseConfig);
    const meta = client.getMetaAddressHex();
    await expect(
      client.sendStealthPayment({ chain: "ethereum", recipient: meta, amount: 1n }),
    ).rejects.toThrow(/ethereumProvider/);
  });

  it("throws when a Solana recipient has no registered meta-address", async () => {
    const conn = { getAccountInfo: async () => null } as unknown as Connection;
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: conn },
      solanaWallet: { publicKey: PublicKey.default, signTransaction: async (t) => t },
    });
    await expect(
      client.sendStealthPayment({
        chain: "solana",
        recipient: PublicKey.default.toBase58(),
        amount: 1000n,
      }),
    ).rejects.toThrow(/no registered meta-address/);
  });

  it("rejects an unsupported chain", async () => {
    const client = await OpaqueClient.create(baseConfig);
    const meta = client.getMetaAddressHex();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.sendStealthPayment({ chain: "dogecoin" as any, recipient: meta, amount: 1n }),
    ).rejects.toThrow(/unsupported send chain/);
  });
});

describe("OpaqueClient.scan / balances (offline wiring)", () => {
  it("returns an empty inbox when no announcements exist and cross-chain is off", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
    });
    const out = await client.scan({ chains: ["solana"], includeCrossChain: false });
    expect(out).toEqual([]);
  });

  it("returns no balances for an empty output set", async () => {
    const client = await OpaqueClient.create({
      ...baseConfig,
      solana: { connection: emptyConnection() },
    });
    expect(await client.getBalancesForOutputs([])).toEqual([]);
  });
});

describe("OpaqueClient.createViewOnly", () => {
  const output = { ephemeralPublicKey: ("0x02" + "11".repeat(32)) as `0x${string}` };

  it("reconstructs the same meta-address but cannot spend", async () => {
    const full = await OpaqueClient.create(baseConfig);
    const { viewingKey, spendingKey } = deriveKeysFromSignature(baseConfig.walletSignature);
    const { S } = keysToStealthMetaAddress(viewingKey, spendingKey);

    const viewer = await OpaqueClient.createViewOnly(
      {
        chainId: baseConfig.chainId,
        rpcUrl: baseConfig.rpcUrl,
        ethereumAddress: baseConfig.ethereumAddress,
      },
      { viewingKey, spendPublicKey: S },
    );

    expect(viewer.isViewOnly).toBe(true);
    expect(full.isViewOnly).toBe(false);
    // V is derived from v, S is passed through: the view-only meta-address matches the full one.
    expect(viewer.getMetaAddressHex()).toBe(full.getMetaAddressHex());

    expect(() => viewer.getStealthSignerPrivateKey(output)).toThrow(/view-only/);
    await expect(
      viewer.sweep({
        output,
        chain: "ethereum",
        destination: baseConfig.ethereumAddress,
      }),
    ).rejects.toThrow(/view-only/);
  });
});
