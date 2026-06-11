import { useEffect, useRef, useState } from "react";
import type { OutputBalance, UnifiedOwnedOutput } from "@opaquecash/opaque";
import { useOpaqueClientOrNull } from "./context.js";

/** State returned by {@link useStealthBalance}. */
export interface UseStealthBalanceResult {
  /** Native balance per owned output (wei / lamports), in input order. */
  balances: OutputBalance[];
  /** Sum of `balances` per chain, in base units. */
  totals: { ethereum: bigint; solana: bigint };
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

  const totals = balances.reduce(
    (acc, b) => {
      acc[b.chain] += b.nativeRaw;
      return acc;
    },
    { ethereum: 0n, solana: 0n },
  );

  return { balances, totals, loading, error };
}
