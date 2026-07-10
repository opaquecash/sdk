import { describe, it, expect } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { buildActionScope, externalNullifierFromScope, FIELD } from "@opaquecash/psr-core";

describe("PSR action scope", () => {
  it("builds a deterministic scope string", () => {
    const a = buildActionScope({ chainId: 11155111, module: "vote", actionId: 42 });
    const b = buildActionScope({ chainId: 11155111, module: "vote", actionId: 42n });
    expect(a).toBe(b);
  });

  it("derives the external nullifier as keccak256(scope) reduced into the BN254 field (OPQ-008)", () => {
    const scope = buildActionScope({ chainId: 1, module: "loan", actionId: "abc" });
    const nullifier = externalNullifierFromScope(scope);
    // Reduced, so it is a valid Groth16 public signal the on-chain verifier will accept.
    expect(nullifier).toBe(BigInt(keccak256(stringToBytes(scope))) % FIELD);
    expect(nullifier).toBeLessThan(FIELD);
  });

  it("different actions produce different nullifiers", () => {
    const s1 = buildActionScope({ chainId: 1, module: "vote", actionId: 1 });
    const s2 = buildActionScope({ chainId: 1, module: "vote", actionId: 2 });
    expect(externalNullifierFromScope(s1)).not.toBe(externalNullifierFromScope(s2));
  });
});
