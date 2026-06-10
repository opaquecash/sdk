/**
 * Opt-in live PSR E2E test against the deployed Sepolia V2 stack. Skipped unless both
 * SEPOLIA_RPC_URL and SEPOLIA_ISSUER_PRIVATE_KEY are set, so CI stays fast and offline.
 *
 * It SENDS transactions (register schema, attest) from the funded issuer wallet:
 *
 *   SEPOLIA_RPC_URL=https://... \
 *   SEPOLIA_ISSUER_PRIVATE_KEY=0x... \
 *   npm test
 *
 * The whole issuer flow runs through OpaqueClient — no frontend lib/psr.ts. Schema names are
 * timestamped so each run is unique (schemaId = hash(authority, name)).
 */
import { describe, it, expect } from "vitest";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { OpaqueClient } from "@opaquecash/opaque";

const RPC = process.env.SEPOLIA_RPC_URL;
const PK = process.env.SEPOLIA_ISSUER_PRIVATE_KEY as Hex | undefined;

// Deterministic 65-byte "signature" used only as HKDF entropy for the test viewing/spending keys.
const TEST_WALLET_SIGNATURE = ("0x" + "ab".repeat(65)) as Hex;

describe.skipIf(!RPC || !PK)("PSR E2E (Sepolia, sends txs)", () => {
  it(
    "creates a schema and issues an attestation through OpaqueClient",
    async () => {
      const account = privateKeyToAccount(PK!);
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
      const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });

      const client = await OpaqueClient.create({
        chainId: 11155111,
        rpcUrl: RPC!,
        walletSignature: TEST_WALLET_SIGNATURE,
        ethereumAddress: account.address,
        ethereumWalletClient: walletClient,
        // wasmModuleSpecifier intentionally omitted: the PSR admin API needs no WASM.
      });

      // 1. Register a unique schema.
      const name = `e2e-test-${Date.now()}`;
      const { txHash, schemaId } = await client.createSchema("ethereum", {
        name,
        fieldDefinitions: "bool passed, string note",
        revocable: true,
      });
      expect(txHash).toMatch(/^0x[0-9a-fA-F]+$/);
      expect(schemaId).toMatch(/^0x[0-9a-fA-F]{64}$/);
      await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });

      // 2. The new schema shows up in this wallet's schemas.
      const mine = await client.getMySchemas("ethereum");
      expect(mine.some((s) => s.schemaId.toLowerCase() === schemaId.toLowerCase())).toBe(true);

      // 3. Issue an attestation to this wallet's own meta-address (full announce path).
      const result = await client.issueAttestation("ethereum", {
        schemaId,
        recipient: client.getMetaAddressHex(),
        fieldValues: { passed: "true", note: "e2e" },
      });
      expect(result.uid).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(result.stealthAddressHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

      // 4. The attestation shows up in this wallet's issued attestations.
      const issued = await client.getMyIssuedAttestations("ethereum");
      const found = issued.find((a) => a.uid.toLowerCase() === result.uid.toLowerCase());
      expect(found).toBeDefined();
      expect(found?.schemaId.toLowerCase()).toBe(schemaId.toLowerCase());
      expect(found?.issuer.toLowerCase()).toBe(account.address.toLowerCase());
    },
    300_000,
  );
});
