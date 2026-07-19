import { useEffect, useRef, useState } from "react";
import type {
  OpaqueScanChain,
  OutputBalance,
  UnifiedOwnedOutput,
} from "@opaquecash/opaque";
import { useOpaqueClientOrNull } from "./context.js";

/**
 * Per-chain native-balance sums. Chains with no owned outputs are absent, so
 * read with `?? 0n` (e.g. `totals.ethereum ?? 0n`). A partial record rather
 * than a fixed shape so a new scan chain never breaks the type.
 */
export type StealthBalanceTotals = Partial<Record<OpaqueScanChain, bigint>>;

/** State returned by {@link useStealthBalance}. */
export interface UseStealthBalanceResult {
  /** Native balance per owned output (wei / lamports), in input order. */
  balances: OutputBalance[];
  /** Sum of `balances` per chain, in base units (absent chains read as `0n`). */
  totals: StealthBalanceTotals;
  /** True while balances are being fetched. */
  loading: boolean;
  /** Last fetch error, cleared by the next successful fetch. */
  error: Error | null;
}

/**
 * Resolve the native balance of each owned stealth output (typically the `outputs`
 * from {@link useScan}). Refetches when the output set or client changes.
 */
export function useStealthBalance(
  outputs: UnifiedOwnedOutput[],
): UseStealthBalanceResult {
  const client = useOpaqueClientOrNull();
  const [balances, setBalances] = useState<OutputBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);

  // Re-run only when the set of outputs actually changes, not on array identity.
  const outputsKey = outputs
    .map((o) => `${o.chain}:${o.stealthAddress}:${o.ephemeralPublicKey}`)
    .join("|");

  useEffect(() => {
    if (!client || outputs.length === 0) {
      setBalances([]);
      return;
    }
    const gen = ++generation.current;
    setLoading(true);
    client
      .getBalancesForOutputs(outputs)
      .then((result) => {
        if (generation.current !== gen) return;
        setBalances(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (generation.current !== gen) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (generation.current === gen) setLoading(false);
      });
    return () => {
      generation.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- outputsKey covers outputs
  }, [client, outputsKey]);

  const totals = balances.reduce<StealthBalanceTotals>((acc, b) => {
    acc[b.chain] = (acc[b.chain] ?? 0n) + b.nativeRaw;
    return acc;
  }, {});

  return { balances, totals, loading, error };
}
