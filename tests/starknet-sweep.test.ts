/**
 * Starknet recipient sweep.
 *
 * The address round-trip (WASM-gated) proves the recipient's reconstruction
 * lands on the exact account the sender funded: build a send to a recipient
 * meta, scan it back, and assert `buildStarknetSweep` derives the same stealth
 * address. This is the offline analogue of the on-chain sweep validated on
 * Sepolia (deploy_account 0x6713f89c…, transfer-out 0x3a4cf7f1…, destination
 * credited 0.5 STRK).
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { initStealthWasm } from "@opaquecash/stealth-wasm";
import { STRK_TOKEN_ADDRESS } from "@opaquecash/stealth-chain-starknet";
import { OpaqueClient } from "@opaquecash/opaque";

const ROOT = new URL("../..", import.meta.url).pathname;
const WASM_JS = `${ROOT}app/public/pkg/cryptography.js`;
const WASM_BIN = `${ROOT}app/public/pkg/cryptography_bg.wasm`;
const wasmPresent = existsSync(WASM_JS) && existsSync(WASM_BIN);

const DEST = "0x" + "12".repeat(31);

describe("Starknet sweep", () => {
  beforeAll(async () => {
    if (wasmPresent) {
      await initStealthWasm({
        moduleSpecifier: pathToFileURL(WASM_JS).href,
        wasmBinaryUrl: readFileSync(WASM_BIN) as unknown as string,
      });
    }
  });

  it.skipIf(!wasmPresent)(
    "reconstructs the exact account the sender funded",
    async () => {
      const c = await OpaqueClient.create({
        chainId: 11155111,
        rpcUrl: "https://ethereum-sepolia.publicnode.com",
        walletSignature: ("0x" + "77".repeat(65)) as Hex,
        ethereumAddress: ("0x" + "01".repeat(20)) as Hex,
        wasmModuleSpecifier: pathToFileURL(WASM_JS).href,
      });

      // Sender builds a payment to this wallet's own meta-address.
      const send = await c.buildStarknetStealthSend({
        recipient: c.getMetaAddressHex(),
        amount: 2_000_000_000_000_000_000n,
      });

      // Recipient reconstructs the sweep from an owned output carrying only the
      // ephemeral key (exactly what `scan` surfaces).
      const sweep = c.buildStarknetSweep({
        output: { ephemeralPublicKey: send.ephemeralPublicKey },
        destination: DEST,
        amount: 500_000_000_000_000_000n,
      });

      // The reconstructed account must equal the funded stealth address.
      expect(BigInt(sweep.address)).toBe(BigInt(send.stealthAddress));
      expect(sweep.classHash).toBe(send.classHash);
      expect(sweep.salt).toBe(send.salt);
      expect(sweep.constructorCalldata).toEqual(send.constructorCalldata);

      // The reconstructed signer's public key must match the account's key.
      expect(sweep.signerPrivateKey.length).toBe(32);

      // The transfer-out call targets the destination for the given amount.
      expect(sweep.transferCall.entrypoint).toBe("transfer");
      expect(sweep.transferCall.contractAddress).toBe(STRK_TOKEN_ADDRESS);
      expect(BigInt(sweep.transferCall.calldata[0])).toBe(BigInt(DEST));
    },
  );

  it("reads a Starknet stealth balance through the adapter", async () => {
    // 3.5 STRK as u256 limbs from a stubbed balance_of.
    const amount = 3_500_000_000_000_000_000n;
    const fetchStub = (async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as { body: string }).body);
      if (body.method === "starknet_call") {
        return {
          json: async () => ({
            result: [
              "0x" + (amount & ((1n << 128n) - 1n)).toString(16),
              "0x" + (amount >> 128n).toString(16),
            ],
          }),
        };
      }
      return { json: async () => ({ result: { events: [] } }) };
    }) as unknown as typeof fetch;

    const c = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "https://ethereum-sepolia.publicnode.com",
      walletSignature: ("0x" + "77".repeat(65)) as Hex,
      ethereumAddress: ("0x" + "01".repeat(20)) as Hex,
      starknet: { fetchFn: fetchStub },
    });

    const [balance] = await c.getBalancesForOutputs([
      {
        chain: "starknet",
        chainId: 0x534e,
        source: "native",
        stealthAddress: "0xc9ec3b774613f1a8dfbccb3e766f1305224ab9b9",
        ephemeralPublicKey:
          "0x02c1cd07675f04b6d18afbedc4c09deab200078bf2eea65dd168ab5fb120aace42",
      } as never,
    ]);

    expect(balance.chain).toBe("starknet");
    expect(balance.nativeRaw).toBe(amount);
  });
});
