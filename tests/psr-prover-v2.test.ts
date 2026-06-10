import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWitnessV2, generateReputationProof } from "@opaquecash/psr-prover";
import type { DiscoveredTrait } from "@opaquecash/psr-core";

/**
 * V2 prover round-trip against the production artifacts.
 *
 * Uses the wasm/zkey shipped in the app and the verification key pinned in the
 * circuits repo. Both live outside this repo, so the suite skips when run in
 * isolation (e.g. sdk CI) and exercises the full pipeline on a full checkout.
 */
const ROOT = new URL("../..", import.meta.url).pathname;
const WASM = `${ROOT}app/public/circuits/v2/stealth_reputation.wasm`;
const ZKEY = `${ROOT}app/public/circuits/v2/stealth_reputation_final.zkey`;
const VKEY = `${ROOT}circuits/test/fixtures/v2/verification_key.json`;

const artifactsPresent = existsSync(WASM) && existsSync(ZKEY) && existsSync(VKEY);

const trait: DiscoveredTrait = {
  attestationId: 42,
  stealthAddress: "0x" + "ab".repeat(20),
  txHash: "0x" + "cd".repeat(32),
  blockNumber: 1,
  discoveredAt: 0,
};
const stealthPrivKeyBytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

describe("psr-prover V2", () => {
  it("builds a witness with the V2 input names and a consistent root", async () => {
    const w = await buildWitnessV2({
      attestationId: 42,
      stealthPrivKeyBytes,
      externalNullifier: "7",
    });
    expect(w.schema_id).toBe("42");
    expect(w.attestation_id).toBe("42");
    expect(w.external_nullifier).toBe("7");
    expect(w.merkle_path).toHaveLength(20);
    expect(w.merkle_path_indices).toHaveLength(20);
    expect(BigInt(w.nullifier_hash)).toBeGreaterThan(0n);
    // deterministic: same inputs → same root (dev-root stability across sessions)
    const w2 = await buildWitnessV2({
      attestationId: 42,
      stealthPrivKeyBytes,
      externalNullifier: "7",
    });
    expect(w2.merkle_root).toBe(w.merkle_root);
    expect(w2.nonce).toBe(w.nonce);
  });

  it.skipIf(!artifactsPresent)(
    "generates a fresh V2 proof that verifies against the production vkey",
    async () => {
      const proofData = await generateReputationProof({
        trait,
        stealthPrivKeyBytes,
        externalNullifier: "7",
        artifacts: { wasmPath: WASM, zkeyPath: ZKEY },
      });

      expect(proofData.publicSignals).toHaveLength(4);
      expect(proofData.attestationId).toBe(42);
      expect(proofData.publicSignals[2]).toBe("7");
      // ProofData.nullifier carries nullifier_hash = publicSignals[3]
      expect(proofData.nullifier).toBe(proofData.publicSignals[3]);

      const snarkjs = (await import("snarkjs")) as unknown as {
        groth16: { verify: (vk: unknown, pub: unknown, proof: unknown) => Promise<boolean> };
      };
      const vkey = JSON.parse(readFileSync(VKEY, "utf8"));
      const ok = await snarkjs.groth16.verify(vkey, proofData.publicSignals, {
        pi_a: proofData.proof.pi_a,
        pi_b: proofData.proof.pi_b,
        pi_c: proofData.proof.pi_c,
      });
      expect(ok).toBe(true);
    },
    120_000,
  );
});
