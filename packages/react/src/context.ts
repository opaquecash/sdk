import { createContext, createElement, useContext, type ReactNode } from "react";
import type { OpaqueClient } from "@opaquecash/opaque";

const OpaqueContext = createContext<OpaqueClient | null>(null);

/** Props for {@link OpaqueProvider}. */
export interface OpaqueProviderProps {
  /** The shared client, or `null` while the wallet/session is not connected yet. */
  client: OpaqueClient | null;
  children?: ReactNode;
}

/**
 * Provide one `OpaqueClient` to the tree. Construct it with `OpaqueClient.fromWallet`
 * (one unified-signer shape per chain) and rebuild it when the connected wallets change;
 * the hooks below re-run automatically because the context value is the client instance.
 */
export function OpaqueProvider(props: OpaqueProviderProps) {
  return createElement(OpaqueContext.Provider, { value: props.client }, props.children);
}

/** The provided client, or `null` when the session is not connected. */
export function useOpaqueClientOrNull(): OpaqueClient | null {
  return useContext(OpaqueContext);
}

/** The provided client; throws when used outside a connected {@link OpaqueProvider}. */
export function useOpaqueClient(): OpaqueClient {
  const client = useContext(OpaqueContext);
  if (!client) {
    throw new Error(
      "useOpaqueClient: no OpaqueClient in context. Wrap the tree in <OpaqueProvider client={…}> " +
        "and gate on useOpaqueClientOrNull() while the session connects.",
    );
  }
  return client;
}
