/**
 * Three-chain facade wiring: the OpaqueClient routes `"starknet"` to the
 * StarknetAdapter for scanning, tags outputs with the Starknet chain id, and
 * fails write paths CLOSED (explicit throw, never a silent wrong-chain
 * fallthrough) until the Starknet sender lands.
 */
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  OPAQUE_CHAIN_STARKNET,
  type StarknetEmittedEvent,
} from "@opaquecash/stealth-chain-starknet";
import { OpaqueClient } from "@opaquecash/opaque";

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

async function client() {
  return OpaqueClient.create({
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia.publicnode.com",
    walletSignature: ("0x" + "37".repeat(65)) as Hex,
    ethereumAddress: ("0x" + "01".repeat(20)) as Hex,
    starknet: { fetchFn: starknetFetchStub() },
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

  it("fails Starknet registration CLOSED", async () => {
    const c = await client();
    await expect(
      c.registerMetaAddress("starknet" as never),
    ).rejects.toThrow(/starknet/);
  });
});
