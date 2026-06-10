/**
 * EVM PSR V2 registry client — schema + attestation CRUD over viem.
 *
 * Reads enumerate the `OpaqueSchemaRegistry` / `OpaqueAttestationRegistry` events (chunked,
 * RPC-adaptive `getLogs`) and read per-id state; writes register/attest/revoke/delegate/deprecate
 * and publish the post-attest V2 announcement. Returns the chain-neutral `SchemaV2` / `AttestationV2`
 * shapes from `@opaquecash/psr-core`, so callers handle Ethereum and Solana identically.
 *
 * Ported from `ethereum/frontend/src/lib/psr.ts`.
 */

import {
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  computeSchemaId,
  computeUid,
  encodeAttestationData,
  parseFieldDefs,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  type AttestationField,
  type AttestationV2,
  type SchemaV2,
} from "@opaquecash/psr-core";
import {
  ANNOUNCER_ABI,
  ATTESTATION_ABI,
  ATTESTED_EVENT,
  SCHEMA_REGISTERED_EVENT,
  SCHEMA_REGISTRY_ABI,
} from "./registry-abi.js";
import type { PsrV2Config } from "./registry-addresses.js";

/** Initial `getLogs` window; shrinks automatically when an RPC rejects the range. */
const LOG_CHUNK = 45_000n;

/** Clients needed for a PSR write (the wallet must carry an account + chain). */
export interface EvmPsrWriteClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** The issuing/authoring account (also the schema authority for `computeSchemaId`). */
  account: Address;
}

// ---------------------------------------------------------------------------
// Adaptive log collection
// ---------------------------------------------------------------------------

/** Detects an RPC "block range too large" error and any suggested toBlock. */
function rangeError(e: unknown): { suggestTo: bigint | null } | null {
  const parts: string[] = [];
  if (e && typeof e === "object") {
    for (const k of ["message", "details", "shortMessage"] as const) {
      const v = (e as Record<string, unknown>)[k];
      if (typeof v === "string") parts.push(v);
    }
    const cause = (e as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      const cm = (cause as Record<string, unknown>).message;
      if (typeof cm === "string") parts.push(cm);
    }
  }
  const msg = parts.join(" ") || String(e);
  if (/block range|10 block|range is too large|too large|too many results|limited|-32600|-32005/i.test(msg)) {
    const m = /\[\s*(0x[0-9a-fA-F]+)\s*,\s*(0x[0-9a-fA-F]+)\s*\]/.exec(msg);
    return { suggestTo: m ? BigInt(m[2]) : null };
  }
  return null;
}

/**
 * Collect logs over `[from, to]`, adapting the window to whatever the RPC allows: one call on
 * permissive RPCs; on tiers that cap `eth_getLogs` it shrinks to the suggested range (parsed from
 * the error) or halves it, so the scan completes instead of failing with a 400.
 */
export async function adaptiveCollect<T>(
  from: bigint,
  to: bigint,
  fetch: (f: bigint, t: bigint) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  if (to < from) return out;
  let cursor = from;
  let step = to - from + 1n < LOG_CHUNK ? to - from + 1n : LOG_CHUNK;
  if (step < 1n) step = 1n;
  while (cursor <= to) {
    const end = cursor + step - 1n > to ? to : cursor + step - 1n;
    try {
      out.push(...(await fetch(cursor, end)));
      cursor = end + 1n;
    } catch (e) {
      const r = rangeError(e);
      if (!r) throw e;
      if (r.suggestTo !== null && r.suggestTo >= cursor && r.suggestTo < end) {
        step = r.suggestTo - cursor + 1n;
      } else if (end > cursor) {
        step = (end - cursor + 1n) / 2n;
        if (step < 1n) step = 1n;
      } else {
        throw e;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Enumerate every registered V2 schema on this chain. */
export async function fetchAllSchemas(
  publicClient: PublicClient,
  cfg: PsrV2Config,
): Promise<SchemaV2[]> {
  const latest = await publicClient.getBlockNumber();
  const logs = await adaptiveCollect(cfg.fromBlock, latest, (f, t) =>
    publicClient.getLogs({ address: cfg.schemaRegistry, event: SCHEMA_REGISTERED_EVENT, fromBlock: f, toBlock: t }),
  );
  const ids = new Set<Hex>();
  for (const l of logs) if (l.args.schemaId) ids.add(l.args.schemaId);
  const schemas = await Promise.all([...ids].map((id) => fetchSchema(publicClient, cfg, id)));
  return schemas.filter((s): s is SchemaV2 => s != null);
}

/** Read one schema's full state by id, or `null` if it does not exist. */
export async function fetchSchema(
  publicClient: PublicClient,
  cfg: PsrV2Config,
  schemaId: Hex,
): Promise<SchemaV2 | null> {
  try {
    const [authority, resolver, revocable, deprecated, version, name, fieldDefinitions, createdAt, expiry] =
      (await publicClient.readContract({ address: cfg.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: "getSchema", args: [schemaId] })) as readonly [Address, Address, boolean, boolean, number, string, string, bigint, bigint];
    const delegates = (await publicClient.readContract({ address: cfg.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: "getDelegates", args: [schemaId] })) as readonly Address[];
    return {
      address: schemaId,
      schemaId,
      authority,
      resolver,
      revocable,
      name,
      fieldDefinitions,
      version: Number(version),
      delegates: [...delegates],
      createdAt: Number(createdAt),
      schemaExpirySlot: Number(expiry),
      deprecated,
    };
  } catch {
    return null;
  }
}

/** Enumerate every V2 attestation on this chain. */
export async function fetchAllAttestations(
  publicClient: PublicClient,
  cfg: PsrV2Config,
): Promise<AttestationV2[]> {
  const latest = await publicClient.getBlockNumber();
  const logs = await adaptiveCollect(cfg.fromBlock, latest, (f, t) =>
    publicClient.getLogs({ address: cfg.attestationRegistry, event: ATTESTED_EVENT, fromBlock: f, toBlock: t }),
  );
  const uids = new Set<Hex>();
  for (const l of logs) if (l.args.uid) uids.add(l.args.uid);
  const records = await Promise.all([...uids].map((uid) => fetchAttestation(publicClient, cfg, uid)));
  return records.filter((a): a is AttestationV2 => a != null);
}

/** Read one attestation's full state by uid, or `null` if it does not exist. */
export async function fetchAttestation(
  publicClient: PublicClient,
  cfg: PsrV2Config,
  uid: Hex,
): Promise<AttestationV2 | null> {
  try {
    const [schemaId, issuer, stealthAddressHash, createdAt, expiration, revocation, refUid, data] =
      (await publicClient.readContract({ address: cfg.attestationRegistry, abi: ATTESTATION_ABI, functionName: "getAttestation", args: [uid] })) as readonly [Hex, Address, Hex, bigint, bigint, bigint, Hex, Hex];
    return {
      address: uid,
      uid,
      schemaId,
      issuer,
      stealthAddressHash,
      dataHex: data,
      createdAt: Number(createdAt),
      expirationSlot: Number(expiration),
      revocationSlot: Number(revocation),
      refUid,
    };
  } catch {
    return null;
  }
}

/** Schemas where `wallet` is the authority OR an authorized delegate (case-insensitive). */
export async function fetchSchemasForWallet(
  publicClient: PublicClient,
  cfg: PsrV2Config,
  wallet: Address,
): Promise<SchemaV2[]> {
  const w = wallet.toLowerCase();
  const all = await fetchAllSchemas(publicClient, cfg);
  return all.filter(
    (s) =>
      s.authority.toLowerCase() === w ||
      s.delegates.some((d) => d.toLowerCase() === w),
  );
}

/** Attestations issued by `wallet` (case-insensitive `issuer` match). */
export async function fetchAttestationsIssuedBy(
  publicClient: PublicClient,
  cfg: PsrV2Config,
  wallet: Address,
): Promise<AttestationV2[]> {
  const w = wallet.toLowerCase();
  const all = await fetchAllAttestations(publicClient, cfg);
  return all.filter((a) => a.issuer.toLowerCase() === w);
}

/** On-chain check: is `candidate` the authority or a delegate of `schemaId`? */
export async function isAuthorizedIssuer(
  publicClient: PublicClient,
  cfg: PsrV2Config,
  schemaId: Hex,
  candidate: Address,
): Promise<boolean> {
  return (await publicClient.readContract({
    address: cfg.schemaRegistry,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "isAuthorizedIssuer",
    args: [schemaId, candidate],
  })) as boolean;
}

/** Current chain block number as a `number`. */
export async function getCurrentBlock(publicClient: PublicClient): Promise<number> {
  return Number(await publicClient.getBlockNumber());
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function chainOf(walletClient: WalletClient) {
  return walletClient.chain ?? null;
}

/** Register a new schema. Returns the tx hash and the derived `schemaId`. */
export async function registerSchema(
  clients: EvmPsrWriteClients,
  cfg: PsrV2Config,
  args: { name: string; fieldDefinitions: string; revocable: boolean; resolver?: Address; schemaExpiryBlock?: bigint },
): Promise<{ txHash: Hex; schemaId: Hex }> {
  const txHash = await clients.walletClient.writeContract({
    address: cfg.schemaRegistry,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "registerSchema",
    args: [args.name, args.fieldDefinitions, args.revocable, args.resolver ?? ZERO_ADDRESS, args.schemaExpiryBlock ?? 0n],
    account: clients.account,
    chain: chainOf(clients.walletClient),
  });
  return { txHash, schemaId: computeSchemaId(clients.account, args.name) };
}

async function writeSchema(
  clients: EvmPsrWriteClients,
  cfg: PsrV2Config,
  fn: "addDelegate" | "removeDelegate" | "updateResolver" | "deprecateSchema",
  args: readonly unknown[],
): Promise<Hex> {
  return clients.walletClient.writeContract({
    address: cfg.schemaRegistry,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: fn,
    args: args as never,
    account: clients.account,
    chain: chainOf(clients.walletClient),
  });
}

/** Authority-only: add a delegate to a schema. */
export async function addDelegate(clients: EvmPsrWriteClients, cfg: PsrV2Config, schemaId: Hex, delegate: Address): Promise<Hex> {
  return writeSchema(clients, cfg, "addDelegate", [schemaId, delegate]);
}
/** Authority-only: remove a delegate from a schema. */
export async function removeDelegate(clients: EvmPsrWriteClients, cfg: PsrV2Config, schemaId: Hex, delegate: Address): Promise<Hex> {
  return writeSchema(clients, cfg, "removeDelegate", [schemaId, delegate]);
}
/** Authority-only: set or clear (`ZERO_ADDRESS`) a schema resolver. */
export async function updateResolver(clients: EvmPsrWriteClients, cfg: PsrV2Config, schemaId: Hex, resolver: Address): Promise<Hex> {
  return writeSchema(clients, cfg, "updateResolver", [schemaId, resolver]);
}
/** Authority-only, irreversible: deprecate a schema (blocks new attestations). */
export async function deprecateSchema(clients: EvmPsrWriteClients, cfg: PsrV2Config, schemaId: Hex): Promise<Hex> {
  return writeSchema(clients, cfg, "deprecateSchema", [schemaId]);
}

/**
 * Issue an attestation. Encodes `fieldValues` per `fieldDefs` internally, waits for the receipt,
 * and derives the `uid` from the mined block (matching the contract's `computeUid`).
 */
export async function attest(
  clients: EvmPsrWriteClients,
  cfg: PsrV2Config,
  args: {
    schemaId: Hex;
    stealthAddressHash: Hex;
    fieldValues: Record<string, string>;
    fieldDefs: readonly AttestationField[];
    expirationBlock?: bigint;
    refUid?: Hex;
  },
): Promise<{ txHash: Hex; uid: Hex; dataHex: Hex }> {
  const dataHex = encodeAttestationData(args.fieldValues, args.fieldDefs);
  const refUid = args.refUid ?? ZERO_BYTES32;
  const txHash = await clients.walletClient.writeContract({
    address: cfg.attestationRegistry,
    abi: ATTESTATION_ABI,
    functionName: "attest",
    args: [args.schemaId, args.stealthAddressHash, dataHex, args.expirationBlock ?? 0n, refUid],
    account: clients.account,
    chain: chainOf(clients.walletClient),
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, dataHex, uid: computeUid(args.schemaId, clients.account, args.stealthAddressHash, receipt.blockNumber) };
}

/** Authority-only: revoke an attestation by uid (schema must be revocable). */
export async function revoke(clients: EvmPsrWriteClients, cfg: PsrV2Config, uid: Hex): Promise<Hex> {
  return clients.walletClient.writeContract({
    address: cfg.attestationRegistry,
    abi: ATTESTATION_ABI,
    functionName: "revoke",
    args: [uid],
    account: clients.account,
    chain: chainOf(clients.walletClient),
  });
}

/**
 * Publish a V2 attestation announcement via the `StealthAddressAnnouncer` so the recipient's
 * scanner can discover the trait. Build `metadata` with `encodeV2AttestationMetadata`.
 */
export async function announceV2Attestation(
  clients: EvmPsrWriteClients,
  announcer: Address,
  args: { stealthAddress: Address; ephemeralPubKey: Hex; metadata: Hex },
): Promise<Hex> {
  return clients.walletClient.writeContract({
    address: announcer,
    abi: ANNOUNCER_ABI,
    functionName: "announce",
    args: [1n, getAddress(args.stealthAddress), args.ephemeralPubKey, args.metadata],
    account: clients.account,
    chain: chainOf(clients.walletClient),
  });
}

/** Re-export so callers can reuse the field parser without reaching into psr-core. */
export { parseFieldDefs };
