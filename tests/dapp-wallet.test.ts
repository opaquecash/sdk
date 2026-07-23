// Per-dApp wallet derivation (extension Phase 0): origin normalization, determinism,
// origin/chain isolation, scalar validity, and the ephemeral/linked mode salts.
import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  deriveDappEvmKey,
  deriveDappRoot,
  deriveDappSolanaKeypair,
  deriveKeysFromSignature,
  normalizeOrigin,
} from "@opaquecash/opaque";

const SIG = ("0x" + "11".repeat(65)) as `0x${string}`;
const ROOT = deriveDappRoot(SIG);
const ORIGIN = "https://app.uniswap.org";

describe("normalizeOrigin", () => {
  it("lowercases scheme+host and strips path/query/hash", () => {
    expect(normalizeOrigin("HTTPS://App.Uniswap.ORG/swap?x=1#y")).toBe("https://app.uniswap.org");
  });

  it("strips default ports but keeps explicit non-default ones", () => {
    expect(normalizeOrigin("https://app.uniswap.org:443/")).toBe("https://app.uniswap.org");
    expect(normalizeOrigin("http://localhost:5173/page")).toBe("http://localhost:5173");
  });

  it("rejects opaque and unparsable origins", () => {
    expect(() => normalizeOrigin("data:text/html,hi")).toThrow(/opaque/);
    expect(() => normalizeOrigin("not a url")).toThrow(/invalid dApp origin/);
  });
});

describe("deriveDappRoot", () => {
  it("equals okm[96:128] from deriveKeysFromSignature", () => {
    expect(ROOT).toEqual(deriveKeysFromSignature(SIG).dappRoot);
    expect(ROOT).toHaveLength(32);
  });
});

describe("deriveDappEvmKey", () => {
  it("is deterministic and origin-normalization-invariant", () => {
    const a = deriveDappEvmKey(ROOT, ORIGIN);
    const b = deriveDappEvmKey(ROOT, "HTTPS://app.uniswap.org:443/swap");
    expect(a.privateKey).toBe(b.privateKey);
    expect(a.address).toBe(b.address);
  });

  it("yields a valid non-zero secp256k1 scalar and a checksummed address", () => {
    const { privateKey, address } = deriveDappEvmKey(ROOT, ORIGIN);
    const scalar = BigInt(privateKey);
    expect(scalar).toBeGreaterThan(0n);
    expect(scalar).toBeLessThan(secp256k1.CURVE.n);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("isolates different origins", () => {
    const a = deriveDappEvmKey(ROOT, "https://app.uniswap.org");
    const b = deriveDappEvmKey(ROOT, "https://aave.com");
    const c = deriveDappEvmKey(ROOT, "https://sub.uniswap.org"); // full-origin salt: subdomain ≠ apex
    expect(new Set([a.address, b.address, c.address]).size).toBe(3);
  });

  it("ephemeral: distinct session nonces give distinct addresses", () => {
    const base = deriveDappEvmKey(ROOT, ORIGIN);
    const s1 = deriveDappEvmKey(ROOT, ORIGIN, { sessionNonce: "n1" });
    const s2 = deriveDappEvmKey(ROOT, ORIGIN, { sessionNonce: "n2" });
    expect(new Set([base.address, s1.address, s2.address]).size).toBe(3);
    // Same nonce is reproducible within its session.
    expect(deriveDappEvmKey(ROOT, ORIGIN, { sessionNonce: "n1" }).address).toBe(s1.address);
  });

  it("linked: alias resolves the target origin's key", () => {
    const target = deriveDappEvmKey(ROOT, ORIGIN);
    const aliased = deriveDappEvmKey(ROOT, "https://other.example", { aliasTarget: ORIGIN });
    expect(aliased.address).toBe(target.address);
  });
});

describe("deriveDappSolanaKeypair", () => {
  it("is deterministic and independent from the EVM key for the same origin", () => {
    const kp1 = deriveDappSolanaKeypair(ROOT, ORIGIN);
    const kp2 = deriveDappSolanaKeypair(ROOT, ORIGIN);
    expect(kp1.publicKey.toBase58()).toBe(kp2.publicKey.toBase58());
    // Different HKDF info: the ed25519 seed is unrelated to the EVM scalar.
    const evm = deriveDappEvmKey(ROOT, ORIGIN);
    expect(Buffer.from(kp1.secretKey.slice(0, 32)).toString("hex")).not.toBe(
      evm.privateKey.slice(2),
    );
  });

  it("isolates origins and supports ephemeral/linked salts", () => {
    const a = deriveDappSolanaKeypair(ROOT, ORIGIN).publicKey.toBase58();
    const b = deriveDappSolanaKeypair(ROOT, "https://jup.ag").publicKey.toBase58();
    const eph = deriveDappSolanaKeypair(ROOT, ORIGIN, { sessionNonce: "n1" }).publicKey.toBase58();
    const linked = deriveDappSolanaKeypair(ROOT, "https://other.example", {
      aliasTarget: ORIGIN,
    }).publicKey.toBase58();
    expect(new Set([a, b, eph]).size).toBe(3);
    expect(linked).toBe(a);
  });
});
