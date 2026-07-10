import { describe, expect, it } from "vitest";
import { sha256Hex, verifyArtifactDigest } from "@opaquecash/psr-prover";

// Fixed 4-byte buffer with a precomputed SHA-256 (verified with `shasum -a 256`).
const BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const SHA256 = "5f78c33274e43fa9de5659265c1d917e25c03722dcb0b8d27db8d5feaa813953";

describe("psr-prover artifact integrity (OPQ-030)", () => {
  it("computes the SHA-256 of a fixed buffer", async () => {
    expect(await sha256Hex(BYTES)).toBe(SHA256);
  });

  it("returns the bytes when the digest matches", async () => {
    const out = await verifyArtifactDigest(BYTES, SHA256, "wasm");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual(Array.from(BYTES));
  });

  it("tolerates a 0x prefix and uppercase hex", async () => {
    await expect(verifyArtifactDigest(BYTES, `0x${SHA256.toUpperCase()}`, "wasm")).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });

  it("throws (fails closed) when the digest mismatches", async () => {
    const wrong = "0".repeat(64);
    await expect(verifyArtifactDigest(BYTES, wrong, "wasm")).rejects.toThrow(/Integrity check failed/);
  });
});
