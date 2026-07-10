import type { ProofData } from "@opaquecash/psr-core";
import { ProofError } from "@opaquecash/psr-core";
import type { ArtifactIntegrity } from "./integrity.js";
import { verifyArtifactDigest } from "./integrity.js";
import type { CircuitWitness } from "./witness.js";

// snarkjs ships without TypeScript types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SnarkGroth16 = { fullProve: (...args: any[]) => Promise<any>; verify: (...args: any[]) => Promise<boolean> };

/**
 * Paths or URLs to Circom wasm + final zkey (Groth16).
 */
export interface ArtifactPaths {
  /** Path/URL to `stealth_reputation.wasm` (V2). */
  wasmPath: string;
  /** Path/URL to final `.zkey`. */
  zkeyPath: string;
  /**
   * Optional expected SHA-256 digests. When provided, the artifact bytes are
   * fetched, hashed, and verified before snarkjs runs the wasm over the secret
   * witness — a mismatch throws (fail-closed). Strongly recommended whenever the
   * artifacts are loaded from a remote origin (OPQ-030).
   */
  integrity?: ArtifactIntegrity;
}

/** Fetch an artifact's bytes (http(s) via `fetch`, local paths via `node:fs` in Node). */
async function fetchArtifactBytes(pathOrUrl: string): Promise<Uint8Array> {
  const isHttp = /^https?:\/\//i.test(pathOrUrl);
  if (!isHttp && typeof process !== "undefined" && process.versions?.node) {
    const { readFile } = await import("node:fs/promises");
    return new Uint8Array(await readFile(pathOrUrl));
  }
  const res = await fetch(pathOrUrl);
  if (!res.ok) {
    throw new ProofError(
      `Failed to fetch proving artifact ${pathOrUrl}: HTTP ${res.status} ${res.statusText}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Return the value handed to snarkjs for one artifact: the original path/URL when
 * no digest is pinned (snarkjs streams it), or the verified in-memory bytes when a
 * digest is provided. snarkjs' `fastfile` accepts a `Uint8Array` as an in-memory file.
 */
async function resolveProvingArtifact(
  pathOrUrl: string,
  expectedSha256: string | undefined,
  label: string,
): Promise<string | Uint8Array> {
  if (!expectedSha256) return pathOrUrl;
  const bytes = await fetchArtifactBytes(pathOrUrl);
  return verifyArtifactDigest(bytes, expectedSha256, label);
}

/**
 * Progress callback for long-running prove steps.
 */
export type ProofProgressCallback = (stage: string, percent: number) => void;

/**
 * Run `snarkjs.groth16.fullProve` on a prepared V2 witness.
 *
 * V2 public signals: `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`.
 * The returned {@link ProofData}'s `nullifier` field carries `nullifier_hash`
 * (`publicSignals[3]`) — the value the on-chain verifiers consume.
 *
 * @param witness - JSON object accepted by the V2 Circom wasm.
 * @param artifacts - Wasm + zkey locations (browser: serve static files; Node: file paths).
 * @param onProgress - Optional UI hook.
 */
export async function generateGroth16Proof(
  witness: CircuitWitness,
  artifacts: ArtifactPaths,
  onProgress?: ProofProgressCallback,
): Promise<ProofData> {
  onProgress?.("generating-proof", 10);
  const [wasm, zkey] = await Promise.all([
    resolveProvingArtifact(artifacts.wasmPath, artifacts.integrity?.wasmSha256, "wasm"),
    resolveProvingArtifact(artifacts.zkeyPath, artifacts.integrity?.zkeySha256, "zkey"),
  ]);
  const snarkjs = (await import("snarkjs")).groth16 as SnarkGroth16;
  const { proof, publicSignals } = await snarkjs.fullProve(witness, wasm, zkey);
  onProgress?.("generating-proof", 90);

  if (publicSignals.length !== 4) {
    throw new ProofError(
      `Expected 4 V2 public signals, got ${publicSignals.length} — the configured artifacts appear to be the retired V1 circuit.`,
    );
  }

  const nullifierHash = publicSignals[3];
  const attestationIdFromProof = Number(publicSignals[1]);

  return {
    proof: {
      pi_a: proof.pi_a.slice(0, 2),
      pi_b: proof.pi_b.slice(0, 2),
      pi_c: proof.pi_c.slice(0, 2),
    },
    publicSignals,
    nullifier: nullifierHash,
    attestationId: Number.isSafeInteger(attestationIdFromProof)
      ? attestationIdFromProof
      : publicSignals[1],
  };
}

/**
 * Verify a proof locally with snarkjs (development / diagnostics).
 *
 * @param proofData - Output of {@link generateGroth16Proof}.
 * @param vkeyPath - Path/URL to verification key JSON from the trusted setup.
 */
export async function verifyProofLocally(
  proofData: ProofData,
  vkeyPath: string,
): Promise<boolean> {
  const snarkjs = (await import("snarkjs")).groth16 as SnarkGroth16;
  return snarkjs.verify(vkeyPath, proofData.publicSignals, {
    pi_a: proofData.proof.pi_a,
    pi_b: proofData.proof.pi_b,
    pi_c: proofData.proof.pi_c,
  });
}
