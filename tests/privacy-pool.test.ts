/**
 * Phase 6.5 — @opaquecash/privacy-pool: the SDK's Poseidon commitments + Merkle trees
 * must be byte-identical to the circuit (withdrawal.circom) and contract
 * (OpaquePrivacyPool). We cross-check against the COMMITTED circuit fixture in
 * circuits/test/fixtures/pool/: rebuilding its commitment, label, nullifier hash,
 * roots, and remainder commitment from the fixture's private inputs must reproduce the
 * fixture's public signals exactly. Also covers note generation, witness assembly, and
 * tx building. No network, no proving.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPoolCrypto,
  PoolMerkleTree,
  POOL_LEVELS,
  buildWithdrawalWitness,
  generateDepositNote,
  buildDepositTx,
  buildWithdrawTx,
} from "@opaquecash/privacy-pool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "..", "circuits", "test", "fixtures", "pool");
const load = async (f: string) => JSON.parse(await readFile(path.join(FIX, f), "utf8"));
// The circuits repo lives as a SIBLING of the sdk checkout in the monorepo layout;
// in CI the sdk is checked out alone, so the fixture-backed test skips (same pattern
// as the WASM-gated suites).
const fixturesPresent = existsSync(FIX);

function singleLeafRoot(crypto: Awaited<ReturnType<typeof buildPoolCrypto>>, leaf: bigint): bigint {
  let n = leaf;
  for (let i = 0; i < POOL_LEVELS; i++) n = crypto.hash([n, crypto.zeros[i]]);
  return n;
}

describe("pool crypto matches the committed circuit fixture", () => {
  it.skipIf(!fixturesPresent)("reproduces the fixture public signals from its private inputs", async () => {
    const crypto = await buildPoolCrypto();
    const input = await load("input.json");
    const pub: string[] = await load("public.json");

    const value = BigInt(input.value);
    const label = BigInt(input.label);
    const nullifier = BigInt(input.nullifier);
    const secret = BigInt(input.secret);
    const withdrawnValue = BigInt(input.withdrawn_value);

    const commitment = crypto.commitment(value, label, crypto.precommitment(nullifier, secret));
    const remainder = value - withdrawnValue;
    const newCommitment = crypto.commitment(
      remainder,
      label,
      crypto.precommitment(BigInt(input.new_nullifier), BigInt(input.new_secret)),
    );

    // Public order: withdrawn_value, state_root, asp_root, nullifier_hash, new_commitment, context.
    expect(pub[0]).toBe(withdrawnValue.toString());
    expect(pub[1]).toBe(singleLeafRoot(crypto, commitment).toString()); // state_root
    expect(pub[2]).toBe(singleLeafRoot(crypto, label).toString()); // asp_root
    expect(pub[3]).toBe(crypto.nullifierHash(nullifier).toString()); // nullifier_hash
    expect(pub[4]).toBe(newCommitment.toString()); // new_commitment
  });

  it("zeros[0] is the empty leaf and zeros chain by Poseidon doubling", async () => {
    const crypto = await buildPoolCrypto();
    expect(crypto.zeros[0]).toBe(0n);
    expect(crypto.zeros[1]).toBe(crypto.hash([0n, 0n]));
    expect(crypto.zeros.length).toBe(POOL_LEVELS + 1);
  });

  it("PoolMerkleTree root + proof reconstruct the root", async () => {
    const crypto = await buildPoolCrypto();
    const leaves = [111n, 222n, 333n];
    const tree = new PoolMerkleTree(crypto, leaves);
    const { siblings, pathIndices } = tree.proof(1);
    // Recompute the root from leaf 1 + its path.
    let node = leaves[1];
    for (let i = 0; i < POOL_LEVELS; i++) {
      node = pathIndices[i] === 1 ? crypto.hash([siblings[i], node]) : crypto.hash([node, siblings[i]]);
    }
    expect(node).toBe(tree.root());
    // Single-leaf tree matches the helper.
    expect(new PoolMerkleTree(crypto, [111n]).root()).toBe(singleLeafRoot(crypto, 111n));
  });
});

describe("witness + tx building", () => {
  it("builds a withdrawal witness whose publics match recomputed values", async () => {
    const crypto = await buildPoolCrypto();
    const note = { value: 10n ** 18n, label: crypto.label(42n, 0n), nullifier: 7n, secret: 9n };
    const commitment = crypto.commitment(note.value, note.label, crypto.precommitment(note.nullifier, note.secret));

    const witness = buildWithdrawalWitness(crypto, {
      note,
      withdrawnValue: 4n * 10n ** 17n,
      newNullifier: 1n,
      newSecret: 2n,
      stateLeaves: [commitment],
      stateIndex: 0,
      aspLeaves: [note.label],
      aspIndex: 0,
      context: 12345n,
    });
    expect(witness.publics.stateRoot).toBe(singleLeafRoot(crypto, commitment));
    expect(witness.publics.aspRoot).toBe(singleLeafRoot(crypto, note.label));
    expect(witness.publics.nullifierHash).toBe(crypto.nullifierHash(note.nullifier));
    expect(witness.input.context).toBe("12345");
    expect((witness.input.state_siblings as string[]).length).toBe(POOL_LEVELS);
  });

  it("rejects over-withdrawal", async () => {
    const crypto = await buildPoolCrypto();
    const note = { value: 100n, label: 1n, nullifier: 2n, secret: 3n };
    expect(() =>
      buildWithdrawalWitness(crypto, {
        note,
        withdrawnValue: 101n,
        newNullifier: 1n,
        newSecret: 2n,
        stateLeaves: [crypto.commitment(100n, 1n, crypto.precommitment(2n, 3n))],
        stateIndex: 0,
        aspLeaves: [1n],
        aspIndex: 0,
        context: 0n,
      }),
    ).toThrow(/exceeds/);
  });

  it("generates a deposit note and deposit/withdraw txs", async () => {
    const crypto = await buildPoolCrypto();
    let i = 0;
    const det = (n: number) => Uint8Array.from({ length: n }, () => (i++ % 251) + 1);
    const note = generateDepositNote(crypto, det);
    expect(note.precommitment).toBe(crypto.precommitment(note.nullifier, note.secret));

    const pool = "0x5fA252e2D22058a4ec3420573a3B3A5dca025837" as const;
    const dep = buildDepositTx(pool, note, 10n ** 18n);
    expect(dep.value).toBe(10n ** 18n);
    expect(dep.to).toBe(pool);
    expect(dep.data.startsWith("0x")).toBe(true);

    const w = buildWithdrawTx(
      pool,
      { a: [1n, 2n], b: [[3n, 4n], [5n, 6n]], c: [7n, 8n] },
      { withdrawnValue: 1n, stateRoot: 2n, nullifierHash: 3n, newCommitment: 4n },
      { recipient: pool, feeRecipient: "0x0000000000000000000000000000000000000000", fee: 0n },
    );
    expect(w.value).toBe(0n);
    expect(w.data.startsWith("0x")).toBe(true);
  });
});
