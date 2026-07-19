/**
 * Starknet send builders.
 *
 * The transfer builder and the facade `buildStarknetStealthSend` produce the
 * unsigned calls an app's Starknet wallet broadcasts. The multicall asserted
 * here was accepted on Sepolia (tx
 * 0x6c7b790534efe42bb3e51edfc82165395fc2382548e50a0c87afbf444798fa2), crediting
 * the counterfactual stealth address with STRK — so these shapes are on-chain
 * truth, not just self-consistency.
 */
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  buildStealthTransferCall,
  STRK_TOKEN_ADDRESS,
} from "@opaquecash/stealth-chain-starknet";
import { OpaqueClient } from "@opaquecash/opaque";

describe("buildStealthTransferCall", () => {
  it("encodes an ERC-20 transfer with a u256 amount", () => {
    const call = buildStealthTransferCall({
      stealthAddress:
        "0x352ca99119820cad28e788fc2159278cd018eb019b471d80a0cdd3a703abfd5",
      amount: 1_000_000_000_000_000n, // 0.001 STRK
    });
    expect(call.contractAddress).toBe(STRK_TOKEN_ADDRESS);
    expect(call.entrypoint).toBe("transfer");
    expect(call.calldata).toEqual([
      "0x352ca99119820cad28e788fc2159278cd018eb019b471d80a0cdd3a703abfd5",
      "0x38d7ea4c68000",
      "0x0",
    ]);
  });

  it("routes to a custom token and rejects non-positive amounts", () => {
    const call = buildStealthTransferCall({
      stealthAddress: "0x1",
      amount: 5n,
      token: "0xdead",
    });
    expect(call.contractAddress).toBe("0xdead");
    expect(() =>
      buildStealthTransferCall({ stealthAddress: "0x1", amount: 0n }),
    ).toThrow(/positive/);
  });
});

describe("OpaqueClient.buildStarknetStealthSend", () => {
  async function client() {
    return OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "https://ethereum-sepolia.publicnode.com",
      walletSignature: ("0x" + "42".repeat(65)) as Hex,
      ethereumAddress: ("0x" + "01".repeat(20)) as Hex,
    });
  }

  it("bundles a transfer then an announce to the stealth address", async () => {
    const c = await client();
    const send = await c.buildStarknetStealthSend({
      recipient: c.getMetaAddressHex(),
      amount: 1_000_000_000_000_000n,
    });

    expect(send.stealthAddress).toMatch(/^0x[0-9a-f]+$/);
    expect(send.calls).toHaveLength(2);

    const [transfer, announce] = send.calls;
    expect(transfer.entrypoint).toBe("transfer");
    expect(transfer.contractAddress).toBe(STRK_TOKEN_ADDRESS);
    // Transfer target is the counterfactual stealth account address.
    expect(BigInt(transfer.calldata[0])).toBe(BigInt(send.stealthAddress));
    expect(transfer.calldata.slice(1)).toEqual(["0x38d7ea4c68000", "0x0"]);

    expect(announce.entrypoint).toBe("announce");
    // announce carries the 20-byte scanner id, not the custody address.
    expect(BigInt(announce.calldata[2])).not.toBe(BigInt(send.stealthAddress));
  });

  it("is deterministic for a fixed wallet and recipient", async () => {
    const c = await client();
    const meta = c.getMetaAddressHex();
    // The ephemeral key is random per call, so the stealth address differs —
    // but the recipient meta-address resolution and call shape stay stable.
    const a = await c.buildStarknetStealthSend({ recipient: meta, amount: 1n });
    const b = await c.buildStarknetStealthSend({ recipient: meta, amount: 1n });
    expect(a.metaAddressHex).toBe(b.metaAddressHex);
    expect(a.stealthAddress).not.toBe(b.stealthAddress); // fresh ephemeral key
  });

  it("rejects non-positive amounts", async () => {
    const c = await client();
    await expect(
      c.buildStarknetStealthSend({ recipient: c.getMetaAddressHex(), amount: 0n }),
    ).rejects.toThrow(/positive/);
  });
});
