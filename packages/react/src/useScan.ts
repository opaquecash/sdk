import { useCallback, useEffect, useRef, useState } from "react";
import type { OpaqueScanChain, UnifiedOwnedOutput } from "@opaquecash/opaque";
import { useOpaqueClientOrNull } from "./context.js";

/** Options for {@link useScan} (mirrors `OpaqueClient.scan`). */
export interface UseScanOptions {
  /** Chains to scan (default both). */
  chains?: OpaqueScanChain[];
  /** Lower-bound cursor: EVM block number (Solana scans the most recent signatures). */
  fromBlock?: bigint;
  /** Upper-bound EVM block; omit for the chain tip. */
  toBlock?: bigint;
  /** Max Solana signatures to scan (adapter default when omitted). */
  solanaLimit?: number;
  /** Merge cross-chain (UAB) announcements (adapter default when omitted). */
  includeCrossChain?: boolean;
  /** Re-scan interval in ms; omit for scan-once (call `refresh` manually). */
  pollInterval?: number;
  /** Skip scanning while true (e.g. tab hidden). */
  paused?: boolean;
}

/** State returned by {@link useScan}. */
export interface UseScanResult {
  /** Owned outputs from the unified inbox (empty while loading the first scan). */
  outputs: UnifiedOwnedOutput[];
  /** True while a scan is in flight. */
  loading: boolean;
  /** Last scan error, cleared by the next successful scan. */
  error: Error | null;
  /** Trigger a re-scan now. */
  refresh: () => void;
}

/**
 * Scan the unified cross-chain inbox for outputs owned by the provided client's wallet.
 * Scans once on mount (and whenever the client or options change); set `pollInterval`
 * to keep it fresh. Returns empty state with `loading: false` while the client is null.
 */
export function useScan(options: UseScanOptions = {}): UseScanResult {
  const client = useOpaqueClientOrNull();
  const [outputs, setOutputs] = useState<UnifiedOwnedOutput[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);

  const {
    fromBlock,
    toBlock,
    solanaLimit,
    includeCrossChain,
    pollInterval,
    paused,
  } = options;
  const chainsKey = (options.chains ?? ["ethereum", "solana"]).join(",");

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!client || paused) return;
    const gen = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      setLoading(true);
      try {
        const result = await client.scan({
          chains: chainsKey.split(",") as OpaqueScanChain[],
          fromBlock,
          toBlock,
          solanaLimit,
          includeCrossChain,
        });
        if (generation.current !== gen) return;
        setOutputs(result);
        setError(null);
      } catch (e) {
        if (generation.current !== gen) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (generation.current === gen) {
          setLoading(false);
          if (pollInterval != null) timer = setTimeout(run, pollInterval);
        }
      }
    };
    void run();
    return () => {
      generation.current++;
      if (timer != null) clearTimeout(timer);
    };
  }, [
    client,
    chainsKey,
    fromBlock,
    toBlock,
    solanaLimit,
    includeCrossChain,
    pollInterval,
    paused,
    nonce,
  ]);

  return { outputs, loading, error, refresh };
}
