/**
 * Resolving the association set a withdrawal must prove membership in (spec/privacy-pool.md §2).
 *
 * To withdraw, a client needs the ordered approved `label`s (`aspLeaves`) and its own
 * position in them (`aspIndex`) for `buildWithdrawalWitness`. Two decentralized ways to
 * obtain them, both *self-authenticating* — the result is verified by recomputing the
 * Merkle root and checking it equals the on-chain `aspRoot`, so the source is never trusted:
 *
 *  1. {@link reconstructAspSetFromDeposits} — rebuild the set directly from on-chain `Deposit`
 *     events. Works whenever the ASP policy is deterministic-from-chain (e.g. approve-all),
 *     where the set is a prefix of deposit labels ordered by `leafIndex`. The withdraw client
 *     already scans `Deposit` events to build the state tree, so this costs it nothing extra
 *     and depends only on the chain.
 *  2. {@link resolveAspSetViaEns} + {@link aspSetFromManifest} — fetch the ASP's published
 *     opening (a label list) via an ENS text record → IPFS, for selective policies whose set
 *     is not chain-derivable. Still verified against the on-chain root.
 */

import { PoolMerkleTree, type PoolCrypto } from "./crypto.js";

/** A pool deposit reduced to its association-set inputs (read from a `Deposit` event). */
export interface AspDeposit {
  label: bigint;
  leafIndex: number;
}

/** An association set resolved for (and verified against) a specific on-chain `aspRoot`. */
export interface AspSet {
  /** Ordered approved labels — the association tree's leaves. */
  aspLeaves: bigint[];
  /** The root these leaves hash to (=== the on-chain `aspRoot` they were matched against). */
  root: bigint;
}

/** Order deposits canonically: ascending `leafIndex`, de-duplicated on `leafIndex`. */
export function orderDeposits(deposits: AspDeposit[]): AspDeposit[] {
  const byIndex = new Map<number, bigint>();
  for (const d of deposits) if (!byIndex.has(d.leafIndex)) byIndex.set(d.leafIndex, d.label);
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([leafIndex, label]) => ({ leafIndex, label }));
}

/** The association-set root for an ordered label list (byte-identical to the pool/circuit). */
export function aspRootOf(crypto: PoolCrypto, labels: bigint[]): bigint {
  return new PoolMerkleTree(crypto, labels).root();
}

/** Self-authentication: true iff `labels` hash to `onchainRoot`. */
export function verifyAspRoot(crypto: PoolCrypto, labels: bigint[], onchainRoot: bigint): boolean {
  return aspRootOf(crypto, labels) === onchainRoot;
}

/** The position of `label` in the ordered set — a withdrawer's `aspIndex` — or -1 if absent. */
export function aspIndexOf(aspLeaves: bigint[], label: bigint): number {
  return aspLeaves.findIndex((l) => l === label);
}

/**
 * Reconstruct, purely from on-chain `Deposit` data, the association set whose Merkle root
 * equals `onchainRoot`. Valid when the ASP's policy is deterministic-from-chain (approve-all):
 * the set is then a prefix of labels ordered by `leafIndex`. Searches prefixes from longest
 * to shortest (the current root usually covers all but the most-recent, still-unconfirmed
 * deposits), returning the first match. Returns `null` when no prefix matches — i.e. the ASP
 * has not yet posted a root covering these deposits, or a selective policy was used and the
 * set is not chain-derivable (use {@link resolveAspSetViaEns} instead).
 */
export function reconstructAspSetFromDeposits(
  crypto: PoolCrypto,
  deposits: AspDeposit[],
  onchainRoot: bigint,
): AspSet | null {
  const ordered = orderDeposits(deposits);
  for (let k = ordered.length; k >= 0; k--) {
    const labels = ordered.slice(0, k).map((d) => d.label);
    if (aspRootOf(crypto, labels) === onchainRoot) return { aspLeaves: labels, root: onchainRoot };
  }
  return null;
}

// ── Off-chain published opening (ENS text record → IPFS) ─────────────────────

/** ENS text-record key the ASP publishes its latest manifest pointer under. */
export const ASP_SET_RECORD_KEY = "com.opaque.aspset";

/** Default public IPFS gateways tried in order. */
export const DEFAULT_IPFS_GATEWAYS = ["https://ipfs.io", "https://cloudflare-ipfs.com"] as const;

/** Injectable transports for off-chain set resolution (mirrors @opaquecash/opaque). */
export interface AspSetTransports {
  /** ENS text-record reader: the raw record value or `null` when unset. */
  ensGetText?: (name: string, key: string) => Promise<string | null>;
  /** IPFS gateway base URLs tried in order (default {@link DEFAULT_IPFS_GATEWAYS}). */
  ipfsGateways?: readonly string[];
  /** Fetch implementation (default `globalThis.fetch`). */
  fetchFn?: typeof fetch;
}

/** The ASP's published opening — the same shape the ASP service writes/pins. */
export interface AspManifest {
  poolId: string;
  /** The association-set root this opening proves (decimal string). */
  root: string;
  version: number;
  algo: string;
  levels: number;
  /** Ordered labels (decimal strings) — the tree leaves. */
  labels: string[];
  generatedAt: string;
}

/** Extract `<cid>[/path]` from an `ipfs://` URI, an `/ipfs/` path, or a bare CID; else `null`. */
export function ipfsPathFromInput(input: string): string | null {
  let rest: string | null = null;
  if (input.startsWith("ipfs://")) rest = input.slice("ipfs://".length).replace(/^ipfs\//, "");
  else if (input.startsWith("/ipfs/")) rest = input.slice("/ipfs/".length);
  else if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}(\/.*)?$/.test(input) || /^b[a-z2-7]{30,}(\/.*)?$/.test(input))
    rest = input;
  if (!rest) return null;
  const cid = rest.split("/")[0];
  const ok = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{30,}$/.test(cid);
  return ok ? rest : null;
}

function isAspManifest(doc: unknown): doc is AspManifest {
  if (doc == null || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  return typeof d.root === "string" && Array.isArray(d.labels) && d.labels.every((l) => typeof l === "string");
}

/** Fetch + parse an {@link AspManifest} from an `ipfs://` URI / bare CID via the gateways. */
export async function fetchAspManifestFromIpfs(
  cidPath: string,
  transports: AspSetTransports = {},
): Promise<AspManifest> {
  const gateways = transports.ipfsGateways ?? DEFAULT_IPFS_GATEWAYS;
  const fetchFn = transports.fetchFn ?? globalThis.fetch;
  if (!fetchFn) throw new Error("privacy-pool: no fetch available for IPFS; pass transports.fetchFn.");
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
      if (!isAspManifest(doc)) throw new Error(`privacy-pool: ipfs://${cidPath} is not an ASP manifest.`);
      return doc;
    } catch (e) {
      if (e instanceof Error && e.message.includes("not an ASP manifest")) throw e;
      lastError = e;
    }
  }
  throw new Error(
    `privacy-pool: failed to fetch ASP manifest ipfs://${cidPath} from ${gateways.length} gateway(s): ${String(lastError)}`,
  );
}

/**
 * Resolve the ASP's published manifest for an ENS name: read its `com.opaque.aspset` text
 * record (an `ipfs://` pointer), then fetch the manifest from IPFS. The manifest is still
 * verified against the on-chain root via {@link aspSetFromManifest} before use.
 */
export async function resolveAspSetViaEns(
  name: string,
  transports: AspSetTransports,
): Promise<AspManifest> {
  if (!transports.ensGetText) {
    throw new Error("privacy-pool: ENS resolution needs transports.ensGetText (an ENS-capable RPC).");
  }
  const value = await transports.ensGetText(name, ASP_SET_RECORD_KEY);
  if (!value) throw new Error(`privacy-pool: ${name} has no ${ASP_SET_RECORD_KEY} text record.`);
  const cidPath = ipfsPathFromInput(value);
  if (!cidPath) throw new Error(`privacy-pool: ${name}'s ${ASP_SET_RECORD_KEY} is not an ipfs:// pointer: ${value}`);
  return fetchAspManifestFromIpfs(cidPath, transports);
}

/**
 * Turn a fetched {@link AspManifest} into a verified {@link AspSet}, checking its labels
 * hash to `onchainRoot`. Throws on mismatch — so a wrong/stale/tampered manifest is rejected
 * before it can produce an invalid proof.
 */
export function aspSetFromManifest(
  crypto: PoolCrypto,
  manifest: AspManifest,
  onchainRoot: bigint,
): AspSet {
  const labels = manifest.labels.map((l) => BigInt(l));
  if (!verifyAspRoot(crypto, labels, onchainRoot)) {
    throw new Error(
      `privacy-pool: manifest root does not match on-chain aspRoot (manifest claims ${manifest.root}, chain has ${onchainRoot}).`,
    );
  }
  return { aspLeaves: labels, root: onchainRoot };
}
