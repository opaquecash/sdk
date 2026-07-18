import {
  CurveId,
  getGroth16CallData,
  init,
  parseGroth16ProofFromObject,
  parseGroth16VerifyingKeyFromObject,
} from "garaga";
import type { ProofData } from "@opaquecash/psr-core";

/**
 * Garaga's WASM module must be initialised once per process; every encode call
 * awaits the same promise so concurrent callers share the initialisation.
 */
let wasmReady: Promise<unknown> | null = null;

function ensureGaragaInit(): Promise<unknown> {
  wasmReady ??= init();
  return wasmReady;
}

/**
 * Encode a snarkjs Groth16 proof into the Starknet verifier's
 * `full_proof_with_hints` calldata.
 *
 * Returns the **length-prefixed** `Span<felt252>` serialisation
 * (`[n, ...n felts]`), byte-identical to `garaga calldata --system groth16`
 * plus the Span length prefix — i.e. directly usable as the calldata of an
 * `invoke` on `verify_reputation` / `verify_groth16_proof_bn254`.
 *
 * The MSM/MPC hints inside the encoding are proof-specific and computed by
 * Garaga's WASM; their layout is coupled to the Garaga version the on-chain
 * verifier was generated with, which is why the `garaga` dependency is pinned
 * exactly.
 *
 * @param proofData - Prover output (`@opaquecash/psr-prover`); only `proof`
 *   and `publicSignals` are read. V2 signal order:
 *   `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`.
 * @param verificationKey - The snarkjs `verification_key.json` object. MUST be
 *   the same key the on-chain verifier was generated from.
 */
export async function encodeFullProofWithHints(
  proofData: Pick<ProofData, "proof" | "publicSignals">,
  verificationKey: object,
): Promise<bigint[]> {
  await ensureGaragaInit();
  const proof = parseGroth16ProofFromObject(
    proofData.proof,
    proofData.publicSignals.map((s) => BigInt(s)),
  );
  const vk = parseGroth16VerifyingKeyFromObject(verificationKey);
  return getGroth16CallData(proof, vk, CurveId.BN254);
}
