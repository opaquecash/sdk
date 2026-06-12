/**
 * Phase 7.x — @opaquecash/disclosure client: the SDK's witness assembly, contexts,
 * and nullifier formula must be byte-identical to the circuit (cross-checked against
 * the COMMITTED fixture in circuits/test/fixtures/disclosure/), and the BIP-340
 * helpers must accept a REAL Rust FROST aggregate (tests/fixtures/frost/, generated
 * by the frost-custodian CLI's 2-of-3 ceremony) — the cross-implementation interop
 * proof. No network, no proving.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { buildPoolCrypto } from "@opaquecash/privacy-pool";
import {
  buildDisclosureWitness,
  disclosureNullifier,
  computeContextEvm,
  computeContextSolana,
  contextToMessage,
  parseFrostSignature,
  verifyQuorumSignature,
  liftEvenY,
  buildDiscloseTx,
  buildRegisterPolicyTx,
  buildDiscloseIx,
  toSolanaProof,
  toSolidityProof,
  policyPda,
  FIELD,
  type FrostSignatureFile,
} from "@opaquecash/disclosure";
// @ts-expect-error untyped
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUIT_FIX = path.join(__dirname, "..", "..", "circuits", "test", "fixtures", "disclosure");
const FROST_FIX = path.join(__dirname, "fixtures", "frost", "signature.json");
const load = async (f: string) => JSON.parse(await readFile(path.join(CIRCUIT_FIX, f), "utf8"));
// The circuits repo lives as a SIBLING of the sdk checkout in the monorepo layout;
// in CI the sdk is checked out alone, so fixture-backed tests skip (same pattern as
// the WASM-gated suites).
const circuitFixPresent = existsSync(CIRCUIT_FIX);

describe("disclosure witness matches the committed circuit fixture", () => {
  it.skipIf(!circuitFixPresent)("reproduces the fixture public signals from its private inputs", async () => {
    const crypto = await buildPoolCrypto();
    const input = await load("input.json");
    const pub: string[] = await load("public.json");

    const note = {
      value: BigInt(input.value),
      label: BigInt(input.label),
      nullifier: BigInt(input.nullifier),
      secret: BigInt(input.secret),
    };
    const commitment = crypto.commitment(
      note.value,
      note.label,
      crypto.precommitment(note.nullifier, note.secret),
    );
    const witness = buildDisclosureWitness(crypto, {
      note,
      threshold: BigInt(input.threshold),
      stateLeaves: [commitment], // fixture: single leaf at index 0
      stateIndex: 0,
      context: BigInt(input.context),
    });

    expect(witness.publics.value.toString()).toBe(pub[0]);
    expect(witness.publics.label.toString()).toBe(pub[1]);
    expect(witness.publics.threshold.toString()).toBe(pub[2]);
    expect(witness.publics.stateRoot.toString()).toBe(pub[3]);
    expect(witness.publics.disclosureNullifier.toString()).toBe(pub[4]);
    expect(witness.publics.context.toString()).toBe(pub[5]);
    // The assembled input is the fixture input (same key order not required).
    expect(witness.input.state_root).toBe(input.state_root);
  });

  it.skipIf(!circuitFixPresent)("verifies the fixture proof against the production vkey", async () => {
    const ok = await snarkjs.groth16.verify(
      await load("verification_key.json"),
      await load("public.json"),
      await load("proof.json"),
    );
    expect(ok).toBe(true);
    if ((globalThis as any).curve_bn128) await (globalThis as any).curve_bn128.terminate();
  });

  it("rejects a non-qualifying note before proving", async () => {
    const crypto = await buildPoolCrypto();
    const note = { value: 5n, label: 1n, nullifier: 2n, secret: 3n };
    const commitment = crypto.commitment(note.value, note.label, crypto.precommitment(2n, 3n));
    expect(() =>
      buildDisclosureWitness(crypto, {
        note,
        threshold: 5n, // strict: value must EXCEED the threshold
        stateLeaves: [commitment],
        stateIndex: 0,
        context: 7n,
      }),
    ).toThrow(/does not qualify/);
  });

  it("disclosure nullifiers are context-scoped", async () => {
    const crypto = await buildPoolCrypto();
    const a = disclosureNullifier(crypto, 42n, 1n);
    const b = disclosureNullifier(crypto, 42n, 2n);
    expect(a).not.toBe(b);
  });
});

describe("FROST ↔ SDK ↔ chain interop", () => {
  it("verifies the Rust frost-custodian 2-of-3 aggregate (committed fixture)", async () => {
    const file: FrostSignatureFile = JSON.parse(await readFile(FROST_FIX, "utf8"));
    const sig = parseFrostSignature(file);
    const groupKeyX = BigInt("0x" + file.group_key_x);
    const message = Uint8Array.from(Buffer.from(file.message, "hex"));

    expect(verifyQuorumSignature(groupKeyX, message, sig)).toBe(true);
    // The CLI's ry agrees with our even-Y lift (what the contracts receive).
    expect(sig.ry).toBe(BigInt("0x" + file.ry));
    expect(sig.ry % 2n).toBe(0n);

    // Tampering is rejected.
    expect(verifyQuorumSignature(groupKeyX, message, { ...sig, s: sig.s ^ 1n })).toBe(false);
    const other = new Uint8Array(message);
    other[0] ^= 0xff;
    expect(verifyQuorumSignature(groupKeyX, other, sig)).toBe(false);
  });

  it("liftEvenY rejects off-curve x", () => {
    expect(() => liftEvenY(5n)).toThrow(/not on the curve/);
  });
});

describe("contexts", () => {
  it("EVM context is field-reduced and deterministic", () => {
    const ctx = computeContextEvm(
      0n,
      ("0x" + "ca5e".padEnd(64, "0")) as `0x${string}`,
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    );
    expect(ctx).toBeLessThan(FIELD);
    expect(ctx).toBe(
      computeContextEvm(
        0n,
        ("0x" + "ca5e".padEnd(64, "0")) as `0x${string}`,
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ),
    );
    expect(contextToMessage(ctx)).toHaveLength(32);
  });

  it("Solana context clears the top 3 bits (< 2^253)", () => {
    const ctx = computeContextSolana(
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2),
      new Uint8Array(32).fill(3),
    );
    expect(ctx).toBeLessThan(1n << 253n);
    expect(ctx).toBeLessThan(FIELD);
  });
});

describe("tx builders", () => {
  const REGISTRY = "0x000000000000000000000000000000000000dEaD" as const;
  const PROGRAM = new PublicKey("7sDCTbMDwjzYA3KHhNPZUVa8Swvj6adJTgSkJqmsn6V7");

  it.skipIf(!circuitFixPresent)("encodes registerPolicy and disclose calldata", async () => {
    const reg = buildRegisterPolicyTx(REGISTRY, {
      pool: "0x49a5bB6d079a43d50596069b4F2632005CFe729E",
      groupKeyX: 123n,
      threshold: 10n ** 18n,
      m: 2,
      n: 3,
    });
    expect(reg.data.startsWith("0x")).toBe(true);

    const proof = await load("proof.json");
    const pub: string[] = await load("public.json");
    const tx = buildDiscloseTx(REGISTRY, {
      proof: toSolidityProof(proof),
      signals: pub.map(BigInt) as [bigint, bigint, bigint, bigint, bigint, bigint],
      policyId: 0n,
      caseId: ("0x" + "00".repeat(32)) as `0x${string}`,
      sig: { rx: 1n, ry: 2n, s: 3n },
    });
    expect(tx.to).toBe(REGISTRY);
    // selector + 19 static words: a(2) b(4) c(2) signals(6) policyId caseId sig(3)
    expect(tx.data.length).toBe(2 + 8 + 64 * 19);
  });

  it.skipIf(!circuitFixPresent)("builds the Solana disclose instruction with the program's account order", async () => {
    const proof = await load("proof.json");
    const input = await load("input.json");
    const requester = PublicKey.unique();
    const ix = buildDiscloseIx(PROGRAM, {
      pool: PublicKey.unique(),
      groupKeyX: 123n,
      proof: toSolanaProof(proof),
      value: BigInt(input.value),
      label: BigInt(input.label),
      stateRoot: BigInt(input.state_root),
      disclosureNullifier: BigInt(input.disclosure_nullifier),
      caseId: new Uint8Array(32),
      sig: { rx: 1n, ry: 2n, s: 3n },
      requester,
    });
    expect(ix.programId.equals(PROGRAM)).toBe(true);
    expect(ix.keys).toHaveLength(5);
    expect(ix.keys[0].pubkey.equals(policyPda(PROGRAM, 123n))).toBe(true);
    expect(ix.keys[3].pubkey.equals(requester)).toBe(true);
    // 8 (disc) + 256 (proof) + 8 (value) + 32*3 + 32 (case) + 32*3 (sig)
    expect(ix.data).toHaveLength(8 + 256 + 8 + 96 + 32 + 96);
  });
});
