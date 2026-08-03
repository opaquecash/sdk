/**
 * Three-chain facade wiring: the OpaqueClient routes `"starknet"` to the
 * StarknetAdapter for scanning, tags outputs with the Starknet chain id, and
 * dispatches Starknet writes (`registerMetaAddress`, `isMetaAddressRegistered`,
 * `submitReputationVerification`) through the configured `starknet.account` —
 * a starknet.js `Account`/`WalletAccount`-shaped object, mirroring the other
 * chains' signer config. Sends stay builder-based (`buildStarknetStealthSend`)
 * and fail CLOSED on the generic path. The proof encoder itself is
 * golden-tested against the garaga Python CLI in `psr-starknet-calldata.test.ts`;
 * the fixture-gated case here asserts the facade emits that same invoke.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  OPAQUE_CHAIN_STARKNET,
  STARKNET_SEPOLIA,
  decodeByteArray,
  encodeByteArray,
  toFeltHex,
  type StarknetCall,
  type StarknetEmittedEvent,
} from "@opaquecash/stealth-chain-starknet";
import { STARKNET_SEPOLIA_PSR } from "@opaquecash/psr-chain-starknet";
import { OpaqueClient, type StarknetAccountLike } from "@opaquecash/opaque";
import type { ProofData } from "@opaquecash/psr-core";

/** Real Sepolia announcement of CSAP canonical vector 1 (see starknet repo). */
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
  data: ["0x1", "0x2b95c249d84f417e3e395a127425428b540671cc15881eb828c17b722a53f", "0xc599", "0x2", "0x0", "0xe1", "0x1"],
  block_number: 12158304,
  transaction_hash: "0x006efbb9",
};

function starknetFetchStub(): typeof fetch {
  return (async (_url: unknown, init: unknown) => {
    const body = JSON.parse((init as { body: string }).body);
    const result =
      body.method === "starknet_getEvents"
        ? { events: [LIVE_EVENT] }
        : body.method === "starknet_blockNumber"
          ? 12160000
          : [];
    return { json: async () => ({ result }) };
  }) as unknown as typeof fetch;
}

/** `starknet_call` stub answering `stealth_meta_address_of` with `bytes`. */
function registryFetchStub(bytes: Uint8Array): typeof fetch {
  return (async () => ({
    json: async () => ({ result: encodeByteArray(bytes).map(toFeltHex) }),
  })) as unknown as typeof fetch;
}

/** Fake wallet: records every execute() and returns a fixed tx hash. */
function fakeAccount(address = "0xabc"): StarknetAccountLike & {
  executed: StarknetCall[][];
} {
  const executed: StarknetCall[][] = [];
  return {
    address,
    executed,
    async execute(calls: StarknetCall[]) {
      executed.push(calls);
      return { transaction_hash: "0xfacade" };
    },
  };
}

async function client(starknet: object = { fetchFn: starknetFetchStub() }) {
  return OpaqueClient.create({
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia.publicnode.com",
    walletSignature: ("0x" + "37".repeat(65)) as Hex,
    ethereumAddress: ("0x" + "01".repeat(20)) as Hex,
    starknet,
  });
}

describe("OpaqueClient Starknet facade", () => {
  it("routes scan(['starknet']) through the StarknetAdapter", async () => {
    const c = await client();
    const out = await c.scan({ chains: ["starknet"] });
    // The recipient here is not the vector's owner, so no output is OWNED —
    // the point is the adapter ran and returned without touching EVM/Solana.
    expect(Array.isArray(out)).toBe(true);
    for (const o of out) {
      expect(o.chain).toBe("starknet");
      expect(o.chainId).toBe(OPAQUE_CHAIN_STARKNET);
    }
  });

  it("accepts starknet alongside the other chains in one scan", async () => {
    const c = await client();
    // Ethereum RPC is never contacted: stub it to an empty range-aware client.
    (c as unknown as { publicClient: unknown }).publicClient = {
      getContractEvents: async () => [],
      getLogs: async () => [],
      getBlockNumber: async () => 11_050_000n,
    };
    const out = await c.scan({
      chains: ["ethereum", "starknet"],
      includeCrossChain: false,
    });
    expect(Array.isArray(out)).toBe(true);
  });

  it("fails Starknet sends CLOSED, not silently on another chain", async () => {
    const c = await client();
    // A resolvable, chain-neutral recipient (this client's own meta-address),
    // so resolution succeeds and dispatch reaches the unsupported-chain guard.
    await expect(
      c.sendStealthPayment({
        chain: "starknet" as never,
        recipient: c.getMetaAddressHex(),
      } as never),
    ).rejects.toThrow(/starknet/);
  });
});

describe("OpaqueClient.registerMetaAddress (starknet)", () => {
  it("throws without a configured starknet.account", async () => {
    const c = await client();
    await expect(c.registerMetaAddress("starknet")).rejects.toThrow(
      /starknet\.account/,
    );
  });

  it("executes register_keys on the registry via the configured account", async () => {
    const account = fakeAccount();
    const c = await client({ account });
    const res = await c.registerMetaAddress("starknet");

    expect(res.chain).toBe("starknet");
    expect(res.txHash).toBe("0xfacade");
    expect(res.metaAddressHex).toBe(c.getMetaAddressHex());

    expect(account.executed).toHaveLength(1);
    const [call] = account.executed[0];
    expect(call.entrypoint).toBe("register_keys");
    expect(call.contractAddress).toBe(STARKNET_SEPOLIA.stealthRegistry);
    // scheme_id u256 = 1, then the ByteArray meta-address round-trips.
    expect(call.calldata.slice(0, 2)).toEqual(["0x1", "0x0"]);
    const { bytes } = decodeByteArray(call.calldata.slice(2).map(BigInt));
    expect(`0x${Buffer.from(bytes).toString("hex")}`).toBe(
      c.getMetaAddressHex(),
    );
  });

  it("buildStarknetRegisterMetaAddress returns the same unsigned call", async () => {
    const c = await client();
    const { call, metaAddressHex } = c.buildStarknetRegisterMetaAddress();
    expect(metaAddressHex).toBe(c.getMetaAddressHex());
    expect(call.entrypoint).toBe("register_keys");
    expect(call.contractAddress).toBe(STARKNET_SEPOLIA.stealthRegistry);
  });
});

describe("OpaqueClient.isMetaAddressRegistered (starknet)", () => {
  it("throws without a configured starknet.account", async () => {
    const c = await client();
    await expect(c.isMetaAddressRegistered("starknet")).rejects.toThrow(
      /starknet\.account/,
    );
  });

  it("reads the registry for the account address", async () => {
    const registered = await client({
      account: fakeAccount("0x123"),
      fetchFn: registryFetchStub(new Uint8Array(66).fill(2)),
    });
    expect(await registered.isMetaAddressRegistered("starknet")).toBe(true);

    const empty = await client({
      account: fakeAccount("0x123"),
      fetchFn: registryFetchStub(new Uint8Array(0)),
    });
    expect(await empty.isMetaAddressRegistered("starknet")).toBe(false);
  });
});

describe("OpaqueClient.buildStarknetReputationVerification", () => {
  const ROOT = new URL("../..", import.meta.url).pathname;
  const FIXTURES = `${ROOT}circuits/test/fixtures/v2/`;
  const fixturesPresent =
    existsSync(`${FIXTURES}proof.json`) &&
    existsSync(`${FIXTURES}public.json`) &&
    existsSync(`${FIXTURES}verification_key.json`);

  const proofData = (publicSignals: string[]): ProofData => ({
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals,
    nullifier: publicSignals[3] ?? "0",
    attestationId: { schemaId: "0x1", uid: "0x2" } as ProofData["attestationId"],
  });

  it("rejects a non-V2 signal count", async () => {
    const c = await client();
    await expect(
      c.buildStarknetReputationVerification({
        proofData: proofData(["1", "2", "3"]),
        merkleRoot: "1",
        externalNullifier: "3",
      }),
    ).rejects.toThrow(/4 V2 public signals/);
  });

  it("rejects merkleRoot / externalNullifier mismatches against the signals", async () => {
    const c = await client();
    const data = proofData(["1", "2", "3", "4"]);
    await expect(
      c.buildStarknetReputationVerification({
        proofData: data,
        merkleRoot: "999",
        externalNullifier: "3",
      }),
    ).rejects.toThrow(/merkleRoot/);
    await expect(
      c.buildStarknetReputationVerification({
        proofData: data,
        merkleRoot: "0x1", // hex and decimal forms must compare equal
        externalNullifier: "999",
      }),
    ).rejects.toThrow(/externalNullifier/);
  });

  it("requires starknet.psrVerificationKey", async () => {
    const c = await client();
    await expect(
      c.buildStarknetReputationVerification({
        proofData: proofData(["1", "2", "3", "4"]),
        merkleRoot: "1",
        externalNullifier: "3",
      }),
    ).rejects.toThrow(/psrVerificationKey/);
  });

  it.skipIf(!fixturesPresent)(
    "encodes the fixture proof into a verify_reputation invoke and submits it",
    async () => {
      const proof = JSON.parse(readFileSync(`${FIXTURES}proof.json`, "utf8"));
      const publicSignals: string[] = JSON.parse(
        readFileSync(`${FIXTURES}public.json`, "utf8"),
      );
      const vk = JSON.parse(
        readFileSync(`${FIXTURES}verification_key.json`, "utf8"),
      );
      const args = {
        proofData: { ...proofData(publicSignals), proof },
        merkleRoot: publicSignals[0],
        externalNullifier: publicSignals[2],
      };

      const account = fakeAccount();
      // Also exercises the path form of psrVerificationKey (node fs branch).
      const c = await client({
        account,
        psrVerificationKey: `${FIXTURES}verification_key.json`,
      });

      const call = await c.buildStarknetReputationVerification(args);
      expect(call.entrypoint).toBe("verify_reputation");
      expect(call.contractAddress).toBe(
        STARKNET_SEPOLIA_PSR.reputationVerifier.address,
      );
      // Length-prefixed Span<felt252>: [n, ...n felts].
      expect(BigInt(call.calldata[0])).toBe(BigInt(call.calldata.length - 1));

      const res = await c.submitReputationVerification("starknet", args);
      expect(res.txHash).toBe("0xfacade");
      expect(account.executed[0][0].calldata).toEqual(call.calldata);

      // An object vkey behaves identically to the path form.
      const c2 = await client({ account, psrVerificationKey: vk });
      const call2 = await c2.buildStarknetReputationVerification(args);
      expect(call2.calldata).toEqual(call.calldata);
    },
  );
});
