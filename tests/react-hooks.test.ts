// @vitest-environment jsdom
/**
 * Phase 2.7 — @opaquecash/react hooks against a stubbed OpaqueClient:
 * provider/context, useScan (initial scan, refresh, error), useStealthBalance.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  OpaqueProvider,
  useOpaqueClient,
  useOpaqueClientOrNull,
  useScan,
  useStealthBalance,
} from "@opaquecash/react";
import type { OpaqueClient, UnifiedOwnedOutput } from "@opaquecash/opaque";

const OUTPUT: UnifiedOwnedOutput = {
  chain: "ethereum",
  chainId: 2,
  source: "native",
  stealthAddress: "0x1111111111111111111111111111111111111111",
  transactionHash: "0xabc",
  blockNumber: 1,
  logIndex: 0,
  viewTag: 7,
  ephemeralPublicKey: ("0x02" + "11".repeat(32)) as `0x${string}`,
};

function wrapperWith(client: OpaqueClient | null) {
  return ({ children }: { children: ReactNode }) =>
    createElement(OpaqueProvider, { client }, children);
}

describe("OpaqueProvider / useOpaqueClient", () => {
  it("provides the client and throws outside a connected provider", () => {
    const client = { marker: true } as unknown as OpaqueClient;
    const { result } = renderHook(() => useOpaqueClient(), {
      wrapper: wrapperWith(client),
    });
    expect(result.current).toBe(client);

    const { result: orNull } = renderHook(() => useOpaqueClientOrNull(), {
      wrapper: wrapperWith(null),
    });
    expect(orNull.current).toBeNull();

    expect(() => renderHook(() => useOpaqueClient(), { wrapper: wrapperWith(null) }))
      .toThrow(/no OpaqueClient in context/);
  });
});

describe("useScan", () => {
  it("scans on mount and exposes outputs", async () => {
    const scan = vi.fn(async () => [OUTPUT]);
    const client = { scan } as unknown as OpaqueClient;
    const { result } = renderHook(() => useScan({ chains: ["ethereum"] }), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.outputs).toEqual([OUTPUT]);
    expect(result.current.error).toBeNull();
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ chains: ["ethereum"] }),
    );
  });

  it("re-scans on refresh and surfaces errors", async () => {
    let calls = 0;
    const scan = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new Error("rpc down");
      return [OUTPUT];
    });
    const client = { scan } as unknown as OpaqueClient;
    const { result } = renderHook(() => useScan({ chains: ["ethereum"] }), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.outputs).toHaveLength(1));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("rpc down");

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it("stays idle without a client", () => {
    const { result } = renderHook(() => useScan(), { wrapper: wrapperWith(null) });
    expect(result.current.outputs).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

describe("useStealthBalance", () => {
  it("fetches per-output balances and sums totals per chain", async () => {
    const getBalancesForOutputs = vi.fn(async (outputs: UnifiedOwnedOutput[]) =>
      outputs.map((o) => ({
        chain: o.chain,
        stealthAddress: o.stealthAddress,
        address: o.stealthAddress,
        nativeRaw: 5n,
      })),
    );
    const client = { getBalancesForOutputs } as unknown as OpaqueClient;
    const { result } = renderHook(
      () => useStealthBalance([OUTPUT, { ...OUTPUT, stealthAddress: "0x2222222222222222222222222222222222222222" }]),
      { wrapper: wrapperWith(client) },
    );
    await waitFor(() => expect(result.current.balances).toHaveLength(2));
    expect(result.current.totals.ethereum).toBe(10n);
    expect(result.current.totals.solana).toBe(0n);
    expect(result.current.error).toBeNull();
  });

  it("clears balances when the output set empties", async () => {
    const client = {
      getBalancesForOutputs: async () => [
        { chain: "ethereum", stealthAddress: OUTPUT.stealthAddress, address: OUTPUT.stealthAddress, nativeRaw: 1n },
      ],
    } as unknown as OpaqueClient;
    const { result, rerender } = renderHook(
      ({ outputs }: { outputs: UnifiedOwnedOutput[] }) => useStealthBalance(outputs),
      { wrapper: wrapperWith(client), initialProps: { outputs: [OUTPUT] } },
    );
    await waitFor(() => expect(result.current.balances).toHaveLength(1));
    rerender({ outputs: [] });
    await waitFor(() => expect(result.current.balances).toHaveLength(0));
  });
});
