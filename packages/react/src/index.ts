/**
 * `@opaquecash/react` — React hooks for the Opaque SDK.
 *
 * Wrap your tree in {@link OpaqueProvider} with a client built via
 * `OpaqueClient.fromWallet` (or `create`), then read it anywhere with
 * {@link useOpaqueClient}, scan the unified inbox with {@link useScan}, and resolve
 * per-output native balances with {@link useStealthBalance}.
 *
 * @packageDocumentation
 */

export { OpaqueProvider, useOpaqueClient, useOpaqueClientOrNull } from "./context.js";
export type { OpaqueProviderProps } from "./context.js";
export { useScan } from "./useScan.js";
export type { UseScanOptions, UseScanResult } from "./useScan.js";
export { useStealthBalance } from "./useStealthBalance.js";
export type { UseStealthBalanceResult } from "./useStealthBalance.js";
