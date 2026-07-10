import { ProofError } from "@opaquecash/psr-core";

/**
 * Expected SHA-256 digests for the proving artifacts, as lowercase hex (a leading
 * `0x` is tolerated).
 *
 * `snarkjs` executes the witness-generator wasm over the **secret** witness
 * (including the reconstructed one-time stealth private key), so when the wasm is
 * fetched from a remote origin an integrity digest is the only thing standing
 * between a compromised CDN/DNS and key exfiltration (OPQ-030). Ship the expected
 * digests alongside the artifacts and pass them here to fail closed on a mismatch.
 */
export interface ArtifactIntegrity {
  /** Expected SHA-256 of the fetched `.wasm` bytes (lowercase hex, optional `0x`). */
  wasmSha256?: string;
  /** Expected SHA-256 of the fetched `.zkey` bytes (lowercase hex, optional `0x`). */
  zkeySha256?: string;
}

/** Resolve a WebCrypto `SubtleCrypto`, falling back to `node:crypto` on old runtimes. */
async function getSubtle(): Promise<SubtleCrypto> {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.subtle) return g.crypto.subtle;
  const { webcrypto } = await import("node:crypto");
  return webcrypto.subtle as unknown as SubtleCrypto;
}

/** SHA-256 of `data` as lowercase hex, computed with WebCrypto. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = await getSubtle();
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeDigest(value: string): string {
  return value.toLowerCase().replace(/^0x/, "");
}

/**
 * Verify that `data` hashes to `expectedSha256`, throwing a {@link ProofError}
 * (fail-closed) on mismatch. Returns the bytes as a `Uint8Array` for the caller
 * to hand to snarkjs.
 *
 * @param data - The fetched artifact bytes.
 * @param expectedSha256 - Expected SHA-256 as lowercase hex (a leading `0x` is tolerated).
 * @param label - Human-readable artifact name for the error message (e.g. `"wasm"`).
 */
export async function verifyArtifactDigest(
  data: ArrayBuffer | Uint8Array,
  expectedSha256: string,
  label: string,
): Promise<Uint8Array> {
  const actual = await sha256Hex(data);
  const expected = normalizeDigest(expectedSha256);
  if (actual !== expected) {
    throw new ProofError(
      `Integrity check failed for proving artifact "${label}": expected SHA-256 ${expected}, ` +
        `got ${actual}. Refusing to run untrusted artifacts over the secret witness.`,
    );
  }
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}
