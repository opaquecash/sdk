/**
 * Offline coverage for the OpaqueClient PSR admin surface: a client constructed without a WASM
 * module or signers is still usable for identity/derivation, surfaces clear errors when a
 * WASM-backed method or an unconfigured-signer write is attempted, and rejects unknown chains.
 * Live schema/attestation round-trips live in psr-e2e*.test.ts (env-gated).
 */
import { describe, it, expect } from "vitest";
import { OpaqueClient } from "@opaquecash/opaque";

const baseConfig = {
  chainId: 11155111,
  rpcUrl: "https://ethereum-sepolia.publicnode.com",
  walletSignature: ("0x" + "11".repeat(65)) as `0x${string}`,
  ethereumAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`,
};

const schemaParams = { name: "offline", fieldDefinitions: "bool passed", revocable: true };

describe("OpaqueClient PSR admin (offline)", () => {
  it("constructs without a wasmModuleSpecifier and derives a meta-address", async () => {
    const client = await OpaqueClient.create(baseConfig);
    expect(client.getMetaAddressHex()).toMatch(/^0x[0-9a-fA-F]{132}$/);
  });

  it("throws a clear error when a WASM-backed method is used without WASM", async () => {
    const client = await OpaqueClient.create(baseConfig);
    // 33-byte compressed ephemeral pubkey passes the length check, then hits the WASM proxy.
    expect(() =>
      client.getStealthSignerPrivateKey({
        ephemeralPublicKey: ("0x02" + "11".repeat(32)) as `0x${string}`,
      }),
    ).toThrow(/cryptography WASM/);
  });

  it("requires an Ethereum signer for Ethereum PSR writes", async () => {
    const client = await OpaqueClient.create(baseConfig);
    await expect(client.createSchema("ethereum", schemaParams)).rejects.toThrow(/ethereumProvider/);
  });

  it("requires a Solana wallet for Solana PSR writes", async () => {
    const client = await OpaqueClient.create(baseConfig);
    await expect(client.createSchema("solana", schemaParams)).rejects.toThrow(/solanaWallet/);
  });

  it("rejects an unsupported PSR chain", async () => {
    const client = await OpaqueClient.create(baseConfig);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.createSchema("dogecoin" as any, schemaParams),
    ).rejects.toThrow(/unsupported chain/);
  });
});
