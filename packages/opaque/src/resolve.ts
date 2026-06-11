/**
 * Recipient identity resolution beyond the on-chain registries (CSAP §2.9).
 *
 * `OpaqueClient.resolveRecipient` accepts, in one entry point:
 *   - a raw 66-byte meta-address (`0x…` 132 hex, optionally `st:opq:`-prefixed)
 *   - a 20-byte EVM address  → ERC-6538 `StealthMetaAddressRegistry`
 *   - a Solana base58 pubkey → `stealth-registry` PDA
 *   - `ipfs://…` / bare CID  → off-chain DID document fetch (gateway or injected loader)
 *   - `*.eth`                → ENS `com.opaque.meta` text record (read path; ONS is Phase 6)
 *
 * Every path funnels through {@link parseMetaAddressValue}, which validates that both
 * 33-byte halves are valid compressed secp256k1 points before the value is used.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import type { Hex } from "viem";

/** ENSIP-5 reverse-DNS record key for a published meta-address (CSAP §2.9). */
export const OPAQUE_META_RECORD_KEY = "com.opaque.meta";

/** Optional self-describing prefix for published meta-address values (CSAP §2.9). */
export const META_ADDRESS_VALUE_PREFIX = "st:opq:";

/** Default public IPFS gateways tried in order for `ipfs://` recipients. */
export const DEFAULT_IPFS_GATEWAYS = [
  "https://ipfs.io",
  "https://cloudflare-ipfs.com",
] as const;

/** How a recipient input was resolved to a meta-address. */
export type ResolvedRecipientSource =
  | "meta-address"
  | "evm-registry"
  | "solana-registry"
  | "ipfs-did"
  | "ens-text";

/** Result of {@link OpaqueClient.resolveRecipient}. */
export interface ResolvedRecipient {
  /** Validated 66-byte `V‖S` meta-address (`0x` + 132 hex). */
  metaAddressHex: Hex;
  /** Resolution path that produced the meta-address. */
  source: ResolvedRecipientSource;
  /** The (trimmed) input that was resolved. */
  input: string;
}

/** Injectable transports for the off-chain resolution paths (all optional). */
export interface ResolveTransports {
  /**
   * ENS text-record reader: returns the raw record value or `null` when unset.
   * Inject your own (e.g. viem `getEnsText` on a mainnet client, or a mock in tests).
   */
  ensGetText?: (name: string, key: string) => Promise<string | null>;
  /** IPFS gateway base URLs tried in order (default {@link DEFAULT_IPFS_GATEWAYS}). */
  ipfsGateways?: readonly string[];
  /** Fetch implementation for gateway requests (default `globalThis.fetch`). */
  fetchFn?: typeof fetch;
}

/**
 * Parse and validate a published meta-address value: the §2.1 serialisation
 * (`0x` + 132 hex, `V‖S`), optionally `st:opq:`-prefixed. Returns the canonical
 * `0x`-form, or `null` when malformed or when either 33-byte half is not a valid
 * compressed secp256k1 point.
 */
export function parseMetaAddressValue(value: string): Hex | null {
  let v = value.trim();
  if (v.startsWith(META_ADDRESS_VALUE_PREFIX)) {
    v = v.slice(META_ADDRESS_VALUE_PREFIX.length).trim();
  }
  if (!v.startsWith("0x") && /^[0-9a-fA-F]{132}$/.test(v)) v = `0x${v}`;
  if (!/^0x[0-9a-fA-F]{132}$/.test(v)) return null;
  const viewHalf = v.slice(2, 68);
  const spendHalf = v.slice(68, 134);
  for (const half of [viewHalf, spendHalf]) {
    if (!isCompressedSecp256k1Point(half)) return null;
  }
  return v.toLowerCase() as Hex;
}

function isCompressedSecp256k1Point(hex66: string): boolean {
  const prefix = hex66.slice(0, 2);
  if (prefix !== "02" && prefix !== "03") return false;
  try {
    secp256k1.ProjectivePoint.fromHex(hex66).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/** True for a 20-byte `0x` EVM address. */
export function isEvmAddressInput(input: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(input);
}

/** True for a plausible Solana base58 pubkey (32 bytes ≈ 32–44 base58 chars). */
export function isSolanaPubkeyInput(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

/** True for an ENS name (`*.eth`). */
export function isEnsNameInput(input: string): boolean {
  return /^[^\s.]+(\.[^\s.]+)*\.eth$/i.test(input);
}

/**
 * Extract the `<cid>[/path]` from an `ipfs://` URI, an `/ipfs/` gateway path, or a
 * bare CID (v0 `Qm…` base58 or v1 base32). Returns `null` when the input is not IPFS-shaped.
 */
export function ipfsPathFromInput(input: string): string | null {
  let rest: string | null = null;
  if (input.startsWith("ipfs://")) {
    rest = input.slice("ipfs://".length).replace(/^ipfs\//, "");
  } else if (input.startsWith("/ipfs/")) {
    rest = input.slice("/ipfs/".length);
  } else if (
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}(\/.*)?$/.test(input) ||
    /^b[a-z2-7]{30,}(\/.*)?$/.test(input)
  ) {
    rest = input;
  }
  if (!rest) return null;
  const cid = rest.split("/")[0];
  const cidOk =
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{30,}$/.test(cid);
  return cidOk ? rest : null;
}

/**
 * Pull a meta-address out of a DID document (or any JSON object) fetched from IPFS.
 * Accepted shapes, in order:
 *   1. a `service` entry of type `OpaqueStealthMetaAddress` whose `serviceEndpoint`
 *      carries the value (W3C DID style)
 *   2. a top-level `com.opaque.meta` or `opaqueMetaAddress` field
 * Values may be `st:opq:`-prefixed; both halves are point-validated.
 */
export function extractMetaAddressFromDidDocument(doc: unknown): Hex | null {
  if (doc == null || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const services = Array.isArray(d.service) ? d.service : [];
  for (const s of services) {
    if (s == null || typeof s !== "object") continue;
    const svc = s as Record<string, unknown>;
    if (svc.type !== "OpaqueStealthMetaAddress") continue;
    const endpoint = svc.serviceEndpoint;
    if (typeof endpoint === "string") {
      const meta = parseMetaAddressValue(endpoint);
      if (meta) return meta;
    }
  }
  for (const key of [OPAQUE_META_RECORD_KEY, "opaqueMetaAddress"]) {
    const v = d[key];
    if (typeof v === "string") {
      const meta = parseMetaAddressValue(v);
      if (meta) return meta;
    }
  }
  return null;
}

/**
 * Fetch a DID document from IPFS via the configured gateways (tried in order) and
 * extract its meta-address. Throws when every gateway fails or no valid meta-address
 * is present in the document.
 */
export async function resolveIpfsDidMetaAddress(
  cidPath: string,
  transports: ResolveTransports = {},
): Promise<Hex> {
  const gateways = transports.ipfsGateways ?? DEFAULT_IPFS_GATEWAYS;
  const fetchFn = transports.fetchFn ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      "Opaque: no fetch implementation available for IPFS resolution; pass transports.fetchFn.",
    );
  }
  let lastError: unknown = null;
  for (const gateway of gateways) {
    const url = `${gateway.replace(/\/$/, "")}/ipfs/${cidPath}`;
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        lastError = new Error(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const doc: unknown = await res.json();
      const meta = extractMetaAddressFromDidDocument(doc);
      if (!meta) {
        throw new Error(
          `Opaque: DID document at ipfs://${cidPath} carries no valid com.opaque.meta meta-address.`,
        );
      }
      return meta;
    } catch (e) {
      if (e instanceof Error && e.message.includes("com.opaque.meta")) throw e;
      lastError = e;
    }
  }
  throw new Error(
    `Opaque: failed to fetch DID document ipfs://${cidPath} from ${gateways.length} gateway(s): ${String(lastError)}`,
  );
}

/**
 * Read the `com.opaque.meta` text record for an ENS name through the injected reader
 * and validate it. Throws when the record is unset or invalid. The on-chain registry
 * stays authoritative on conflict (CSAP §2.9) — callers who also hold a registry entry
 * for the name's address SHOULD prefer that entry.
 */
export async function resolveEnsMetaAddress(
  name: string,
  transports: ResolveTransports,
): Promise<Hex> {
  if (!transports.ensGetText) {
    throw new Error(
      "Opaque: ENS resolution needs an ens.getText reader (pass `ens` to OpaqueClient.create " +
        "or transports.ensGetText). An ENS-capable RPC (mainnet/Sepolia) is required.",
    );
  }
  const value = await transports.ensGetText(name, OPAQUE_META_RECORD_KEY);
  if (!value) {
    throw new Error(`Opaque: ${name} has no ${OPAQUE_META_RECORD_KEY} text record.`);
  }
  const meta = parseMetaAddressValue(value);
  if (!meta) {
    throw new Error(
      `Opaque: ${name}'s ${OPAQUE_META_RECORD_KEY} record is not a valid 66-byte meta-address.`,
    );
  }
  return meta;
}
