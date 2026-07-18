import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BN254_R,
  buildIsNullifierUsedCall,
  buildUpdateMerkleRootCall,
  buildVerifyReputationCall,
  encodeFullProofWithHints,
  STARKNET_SEPOLIA_PSR,
  toU256Limbs,
} from "@opaquecash/psr-chain-starknet";

/**
 * Golden-vector cross-validation of the Starknet proof encoder.
 *
 * The committed V2 fixture proof (circuits repo) is encoded with Garaga's
 * WASM bindings and compared felt-for-felt against the calldata produced by
 * the Python `garaga calldata` CLI, which the Cairo verifier's fork tests and
 * the live Sepolia verification transaction consumed (starknet repo). Both
 * repos live outside this one, so the suite skips on a solo checkout.
 */
const ROOT = new URL("../..", import.meta.url).pathname;
const FIXTURES = `${ROOT}circuits/test/fixtures/v2/`;
const GOLDEN = `${ROOT}starknet/contracts/psr_groth16_verifier/tests/proof_calldata.txt`;

const artifactsPresent =
  existsSync(`${FIXTURES}proof.json`) &&
  existsSync(`${FIXTURES}public.json`) &&
  existsSync(`${FIXTURES}verification_key.json`) &&
  existsSync(GOLDEN);

describe("psr-chain-starknet", () => {
  it.skipIf(!artifactsPresent)(
    "encodes the fixture proof identically to the garaga Python CLI",
    async () => {
      const proof = JSON.parse(readFileSync(`${FIXTURES}proof.json`, "utf8"));
      const publicSignals = JSON.parse(
        readFileSync(`${FIXTURES}public.json`, "utf8"),
      );
      const vk = JSON.parse(
        readFileSync(`${FIXTURES}verification_key.json`, "utf8"),
      );

      const encoded = await encodeFullProofWithHints(
        { proof, publicSignals },
        vk,
      );
      const golden = readFileSync(GOLDEN, "utf8")
        .trim()
        .split(/\s+/)
        .map(BigInt);

      // Length-prefixed Span serialisation: [n, ...n felts].
      expect(encoded.length).toBe(golden.length + 1);
      expect(encoded[0]).toBe(BigInt(golden.length));
      expect(encoded.slice(1)).toEqual(golden);
    },
    60_000,
  );

  it.skipIf(!artifactsPresent)(
    "builds an invoke-ready verify_reputation call",
    async () => {
      const proof = JSON.parse(readFileSync(`${FIXTURES}proof.json`, "utf8"));
      const publicSignals = JSON.parse(
        readFileSync(`${FIXTURES}public.json`, "utf8"),
      );
      const vk = JSON.parse(
        readFileSync(`${FIXTURES}verification_key.json`, "utf8"),
      );
      const encoded = await encodeFullProofWithHints(
        { proof, publicSignals },
        vk,
      );

      const call = buildVerifyReputationCall(encoded);
      expect(call.contractAddress).toBe(
        STARKNET_SEPOLIA_PSR.reputationVerifier.address,
      );
      expect(call.entrypoint).toBe("verify_reputation");
      expect(call.calldata.length).toBe(encoded.length);
      expect(BigInt(call.calldata[0])).toBe(BigInt(call.calldata.length - 1));

      // Un-prefixed input (e.g. a `garaga calldata` file) gains the prefix.
      const fromBody = buildVerifyReputationCall(encoded.slice(1));
      expect(fromBody.calldata).toEqual(call.calldata);
    },
    60_000,
  );

  it("splits u256 limbs in [low, high] calldata order", () => {
    const root =
      0x0d7809eb6f273f2f7b2da04ac0028f53c1cb14f63ce153a004ed08b728e70edbn;
    const { low, high } = toU256Limbs(root);
    expect(low).toBe(0xc1cb14f63ce153a004ed08b728e70edbn);
    expect(high).toBe(0x0d7809eb6f273f2f7b2da04ac0028f53n);

    const call = buildUpdateMerkleRootCall(root);
    expect(call.entrypoint).toBe("update_merkle_root");
    expect(call.calldata).toEqual([
      "0xc1cb14f63ce153a004ed08b728e70edb",
      "0xd7809eb6f273f2f7b2da04ac0028f53",
    ]);

    expect(() => buildUpdateMerkleRootCall(BN254_R)).toThrow(/scalar field/);
  });

  it("builds the is_nullifier_used view call", () => {
    const call = buildIsNullifierUsedCall(
      0x12b010b6f66b40387e5dc720325f79a6978756d15b8dba232d38789098a21376n,
    );
    expect(call.entrypoint).toBe("is_nullifier_used");
    expect(call.calldata).toEqual([
      "0x978756d15b8dba232d38789098a21376",
      "0x12b010b6f66b40387e5dc720325f79a6",
    ]);
  });
});
