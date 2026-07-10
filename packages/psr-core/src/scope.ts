import { keccak256, stringToBytes } from "viem";

/**
 * Semantic version string for Circom / artifact compatibility (bump when circuits change).
 */
export const PSR_CIRCUIT_VERSION = "0.1.0" as const;

/**
 * BN254 scalar field modulus `r` — the field Groth16 public signals live in. Any value
 * used as a public signal (or a Poseidon preimage) MUST be reduced into `[0, r)`, or the
 * snarkjs-generated on-chain verifier's `checkField` rejects it.
 */
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Reduce a value into the BN254 scalar field so it is a valid Groth16 public signal. */
export function toField(value: bigint): bigint {
  return ((value % FIELD) + FIELD) % FIELD;
}

/**
 * Build a deterministic action scope string from chain + module + action id.
 *
 * Use stable `actionId` values (proposal id, campaign id, …). **Do not** use timestamps alone in production.
 *
 * @param params - Scope components.
 * @returns Canonical `chainId:module:actionId` string.
 *
 * @example
 * ```ts
 * const scope = buildActionScope({
 *   chainId: 11155111,
 *   module: "governance",
 *   actionId: "proposal-42",
 * });
 * ```
 */
export function buildActionScope(params: {
  chainId: number;
  module: string;
  actionId: string | bigint | number;
}): string {
  const id =
    typeof params.actionId === "bigint"
      ? params.actionId.toString()
      : String(params.actionId);
  return `${params.chainId}:${params.module}:${id}`;
}

/**
 * Map a scope string to a `uint256` external nullifier using Keccak-256 (left-padded to 32 bytes).
 *
 * Must stay consistent with how your circuit expects the external nullifier input.
 *
 * @param scope - Output of {@link buildActionScope}.
 */
export function externalNullifierFromScope(scope: string): bigint {
  const hash = keccak256(stringToBytes(scope));
  // Reduce into the BN254 scalar field: keccak256 is a full 256-bit value almost always
  // >= r, and the un-reduced value made the on-chain verifier's checkField revert while the
  // proof committed to `value mod r` — the two disagreed and every scope-derived proof was
  // unsubmittable (OPQ-008). This is the single source of truth for the reduced value.
  return toField(BigInt(hash));
}
