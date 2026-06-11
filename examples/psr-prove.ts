/**
 * Runnable example: generate a PSR V2 reputation proof offline and verify it against
 * the production verification key. No transactions sent; uses the circuit artifacts
 * from the full checkout (app/public/circuits/v2 + circuits/test/fixtures/v2).
 *
 *   npx tsx examples/psr-prove.ts
 *
 * In production the trait comes from `client.discoverTraits(...)` (scanned attestation
 * markers) and the stealth key from `client.getStealthSignerPrivateKeyForReputationTrait`;
 * the proof is then submitted with `client.submitReputationVerification(chain, args)`.
 */
import { existsSync, readFileSync } from "node:fs";
import { OpaqueClient } from "@opaquecash/opaque";
import { generateReputationProof } from "@opaquecash/psr-prover";
import type { DiscoveredTrait } from "@opaquecash/psr-core";

const ROOT = new URL("..", import.meta.url).pathname;
const WASM = `${ROOT}../app/public/circuits/v2/stealth_reputation.wasm`;
const ZKEY = `${ROOT}../app/public/circuits/v2/stealth_reputation_final.zkey`;
const VKEY = `${ROOT}../circuits/test/fixtures/v2/verification_key.json`;

async function main() {
  for (const p of [WASM, ZKEY, VKEY]) {
    if (!existsSync(p)) throw new Error(`Missing circuit artifact ${p} (full checkout required).`);
  }

  // Demo trait + key (dev-mode witness defaults build a deterministic zero-hash tree).
  const trait: DiscoveredTrait = {
    attestationId: 42,
    stealthAddress: "0x" + "ab".repeat(20),
    txHash: "0x" + "cd".repeat(32),
    blockNumber: 1,
    discoveredAt: 0,
  };
  const stealthPrivKeyBytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const externalNullifier = OpaqueClient.reputationExternalNullifierFromScope(
    OpaqueClient.buildReputationActionScope(11155111, "example", "psr-prove"),
  );

  console.log("proving (Groth16, ~10-60s)…");
  const proofData = await generateReputationProof({
    trait,
    stealthPrivKeyBytes,
    externalNullifier,
    artifacts: { wasmPath: WASM, zkeyPath: ZKEY },
  });
  console.log("public signals  :", proofData.publicSignals);
  console.log("nullifier_hash  :", proofData.nullifier);

  const snarkjs = (await import("snarkjs")) as unknown as {
    groth16: { verify: (vk: unknown, pub: unknown, proof: unknown) => Promise<boolean> };
  };
  const vkey = JSON.parse(readFileSync(VKEY, "utf8"));
  const ok = await snarkjs.groth16.verify(vkey, proofData.publicSignals, {
    pi_a: proofData.proof.pi_a,
    pi_b: proofData.proof.pi_b,
    pi_c: proofData.proof.pi_c,
  });
  console.log("verifies        :", ok);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
