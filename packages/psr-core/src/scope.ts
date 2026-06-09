import { keccak256, stringToBytes } from "viem";

/**
 * Semantic version string for Circom / artifact compatibility (bump when circuits change).
 */
export const PSR_CIRCUIT_VERSION = "0.1.0" as const;

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
  return BigInt(hash);
}
