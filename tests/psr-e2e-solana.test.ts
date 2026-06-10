/**
 * Opt-in live PSR E2E test against the deployed Solana devnet V2 schema/attestation programs.
 * Skipped unless both SOLANA_DEVNET_RPC_URL and SOLANA_ISSUER_KEYPAIR are set.
 *
 * It SENDS transactions (register schema, attest) from the funded issuer keypair:
 *
 *   SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com \
 *   SOLANA_ISSUER_KEYPAIR=/path/to/id.json   # or an inline JSON byte array, or a base58 secret \
 *   npm test
 *
 * The whole issuer flow runs through OpaqueClient — no frontend programs.ts.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { OpaqueClient } from "@opaquecash/opaque";

const RPC = process.env.SOLANA_DEVNET_RPC_URL;
const KEY = process.env.SOLANA_ISSUER_KEYPAIR;

// Deterministic 65-byte "signature" used only as HKDF entropy for the test viewing/spending keys.
const TEST_WALLET_SIGNATURE = ("0x" + "cd".repeat(65)) as `0x${string}`;
// Dummy, unused EVM identity — Solana-only run never calls the EVM path.
const DUMMY_EVM_ADDRESS = "0x0000000000000000000000000000000000000001" as `0x${string}`;

/** Load a Keypair from an inline JSON byte array, a JSON keypair file path, or a base58 secret. */
function loadKeypair(spec: string): Keypair {
  const trimmed = spec.trim();
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
  }
  try {
    const fileContents = readFileSync(trimmed, "utf-8");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fileContents) as number[]));
  } catch {
    // Not a readable JSON file path; fall through to base58.
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

describe.skipIf(!RPC || !KEY)("PSR E2E (Solana devnet, sends txs)", () => {
  it(
    "creates a schema and issues an attestation through OpaqueClient",
    async () => {
      const keypair = loadKeypair(KEY!);

      const client = await OpaqueClient.create({
        chainId: 11155111, // EVM deployment is required by config but unused on this path.
        rpcUrl: "https://ethereum-sepolia.publicnode.com",
        walletSignature: TEST_WALLET_SIGNATURE,
        ethereumAddress: DUMMY_EVM_ADDRESS,
        solana: { rpcUrl: RPC!, cluster: "devnet" },
        solanaWallet: {
          publicKey: keypair.publicKey,
          signTransaction: async (tx: Transaction) => {
            tx.partialSign(keypair);
            return tx;
          },
        },
        // wasmModuleSpecifier intentionally omitted: the PSR admin API needs no WASM.
      });

      // 1. Register a unique schema (createSchema confirms the tx).
      const name = `e2e-test-${Date.now()}`;
      const { txHash, schemaId } = await client.createSchema("solana", {
        name,
        fieldDefinitions: "bool passed, string note",
        revocable: true,
      });
      expect(typeof txHash).toBe("string");
      expect(schemaId).toMatch(/^0x[0-9a-fA-F]{64}$/);

      // 2. The new schema shows up in this wallet's schemas.
      const mine = await client.getMySchemas("solana");
      expect(mine.some((s) => s.schemaId.toLowerCase() === schemaId.toLowerCase())).toBe(true);

      // 3. Issue an attestation to this wallet's own meta-address (full announce path).
      const result = await client.issueAttestation("solana", {
        schemaId,
        recipient: client.getMetaAddressHex(),
        fieldValues: { passed: "true", note: "e2e" },
      });
      expect(result.uid).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(result.stealthAddressHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

      // 4. The attestation shows up in this wallet's issued attestations.
      const issued = await client.getMyIssuedAttestations("solana");
      const found = issued.find((a) => a.uid.toLowerCase() === result.uid.toLowerCase());
      expect(found).toBeDefined();
      expect(found?.schemaId.toLowerCase()).toBe(schemaId.toLowerCase());
      expect(found?.issuer).toBe(keypair.publicKey.toBase58());
    },
    300_000,
  );
});
