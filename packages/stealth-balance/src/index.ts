/**
 * `@opaquecash/stealth-balance` — optional portfolio-style helpers (token lists and RPC stay app-owned).
 *
 * This package defines **types** and a small **aggregation** helper; wire your own `publicClient`
 * calls for `getBalance` / `readContract` `balanceOf` per discovered stealth address.
 *
 * @packageDocumentation
 */

import type { Address } from "viem";
import type { Hex } from "@opaquecash/stealth-core";

/**
 * ERC-20 (or native) asset the app tracks for private balance UX.
 */
export interface TrackedToken {
  /** Contract address; use a sentinel for native ETH if your UI distinguishes it. */
  address: Address;
  symbol: string;
  decimals: number;
}

/**
 * One discovered output + balances filled in by your fetch layer.
 */
export interface StealthOutputBalance {
  /** One-time stealth address. */
  stealthAddress: Address;
  /** Per-token balances in minimal units (wei for native). */
  balances: Record<Hex, bigint>;
}

/**
 * Sum per-token balances across many outputs (simple reducer).
 *
 * @param outputs - Rows your indexer or scanner produced.
 * @returns Map token address (lowercase hex) → total raw amount.
 */
export function aggregateBalancesByToken(
  outputs: StealthOutputBalance[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const o of outputs) {
    for (const [token, amount] of Object.entries(o.balances)) {
      const key = token.toLowerCase();
      totals.set(key, (totals.get(key) ?? 0n) + amount);
    }
  }
  return totals;
}
