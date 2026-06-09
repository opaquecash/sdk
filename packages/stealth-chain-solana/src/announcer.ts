/**
 * `StealthAddressAnnouncer` (Solana) — `announce` instruction building, `Announcement`
 * event decoding from transaction logs, historical range fetch, and live subscription.
 *
 * The on-chain `Announcement` event (Anchor `emit!`) is surfaced in transaction logs as a
 * `Program data: <base64>` line: an 8-byte event discriminator followed by the Borsh body
 * `{ scheme_id: u64, stealth_address: Vec<u8>, caller: Pubkey, ephemeral_pub_key: Vec<u8>,
 * metadata: Vec<u8> }`. See `solana/target/idl/stealth_announcer.json`.
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  type Finality,
} from "@solana/web3.js";
import {
  type Announcement,
  WORMHOLE_CHAIN_SOLANA,
  type AnnouncementHandlers,
  type Hex,
} from "@opaquecash/adapter";
import { ByteReader, bytesToHex, concatBytes, u64le, vecU8 } from "./bytes.js";
import {
  ANNOUNCE_DISCRIMINATOR,
  ANNOUNCEMENT_EVENT_DISCRIMINATOR,
  SCHEME_ID_SECP256K1,
} from "./programs.js";

const PROGRAM_DATA_PREFIX = "Program data: ";
const EPHEMERAL_PUBKEY_LEN = 33;

/** Raw fields of a decoded on-chain `Announcement` event. */
export interface DecodedAnnouncementEvent {
  schemeId: bigint;
  /** Stealth address bytes as stored on-chain (20-byte EVM-style for scanner matching). */
  stealthAddress: Uint8Array;
  /** Announcer (caller) pubkey, 32 bytes. */
  caller: Uint8Array;
  /** Compressed secp256k1 ephemeral public key, 33 bytes. */
  ephemeralPubKey: Uint8Array;
  /** Announcement metadata (`metadata[0]` is the view tag). */
  metadata: Uint8Array;
}

/**
 * Build an `announce` instruction. `caller` signs and pays; the app's wallet layer submits.
 */
export function buildAnnounceInstruction(params: {
  announcerProgramId: PublicKey;
  caller: PublicKey;
  /** Stealth address bytes (1..=32 bytes; Opaque uses the 20-byte EVM-style address). */
  stealthAddress: Uint8Array;
  /** 33-byte compressed secp256k1 ephemeral public key. */
  ephemeralPubKey: Uint8Array;
  /** Metadata; `metadata[0]` MUST be the view tag. */
  metadata: Uint8Array;
  schemeId?: bigint;
}): TransactionInstruction {
  const data = concatBytes(
    ANNOUNCE_DISCRIMINATOR,
    u64le(params.schemeId ?? SCHEME_ID_SECP256K1),
    vecU8(params.stealthAddress),
    vecU8(params.ephemeralPubKey),
    vecU8(params.metadata),
  );
  return new TransactionInstruction({
    programId: params.announcerProgramId,
    keys: [{ pubkey: params.caller, isSigner: true, isWritable: true }],
    data: Buffer.from(data),
  });
}

/**
 * Encode the `Announcement` event body the way the program emits it (8-byte discriminator
 * + Borsh). Useful for fixtures and round-trip tests.
 */
export function encodeAnnouncementEventData(event: {
  schemeId: bigint;
  stealthAddress: Uint8Array;
  caller: Uint8Array | PublicKey;
  ephemeralPubKey: Uint8Array;
  metadata: Uint8Array;
}): Uint8Array {
  const caller =
    event.caller instanceof PublicKey
      ? event.caller.toBytes()
      : event.caller;
  if (caller.length !== 32) {
    throw new Error("caller must be a 32-byte pubkey");
  }
  return concatBytes(
    ANNOUNCEMENT_EVENT_DISCRIMINATOR,
    u64le(event.schemeId),
    vecU8(event.stealthAddress),
    caller,
    vecU8(event.ephemeralPubKey),
    vecU8(event.metadata),
  );
}

function discriminatorMatches(data: Uint8Array, disc: Uint8Array): boolean {
  if (data.length < disc.length) return false;
  for (let i = 0; i < disc.length; i++) {
    if (data[i] !== disc[i]) return false;
  }
  return true;
}

/**
 * Decode a single `Announcement` event payload (the bytes after the `Program data: ` base64
 * decode). Returns `null` when the discriminator does not match or the buffer is malformed.
 */
export function decodeAnnouncementEventData(
  data: Uint8Array,
): DecodedAnnouncementEvent | null {
  if (!discriminatorMatches(data, ANNOUNCEMENT_EVENT_DISCRIMINATOR)) return null;
  try {
    const r = new ByteReader(data, ANNOUNCEMENT_EVENT_DISCRIMINATOR.length);
    const schemeId = r.readU64();
    const stealthAddress = r.readVecU8();
    const caller = r.readBytes(32);
    const ephemeralPubKey = r.readVecU8();
    const metadata = r.readVecU8();
    return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback.
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Map a decoded event to the chain-neutral {@link Announcement} shape (Solana). */
export function eventToAnnouncement(
  event: DecodedAnnouncementEvent,
  provenance: { txHash?: string; cursor?: bigint } = {},
): Announcement {
  return {
    stealthAddress: ("0x" + bytesToHex(event.stealthAddress)) as Hex,
    ephemeralPubKey: event.ephemeralPubKey,
    viewTag: event.metadata.length > 0 ? event.metadata[0] : 0,
    metadata: event.metadata,
    chainId: WORMHOLE_CHAIN_SOLANA,
    txHash: provenance.txHash,
    cursor: provenance.cursor,
  };
}

/**
 * Decode every `Announcement` event in a transaction's log messages into chain-neutral
 * {@link Announcement}s. Non-matching `Program data:` lines (other events) are skipped, as
 * are events whose scheme id is not {@link SCHEME_ID_SECP256K1}.
 */
export function decodeAnnouncementLogs(
  logs: string[],
  provenance: { txHash?: string; cursor?: bigint } = {},
): Announcement[] {
  const out: Announcement[] = [];
  for (const log of logs) {
    if (!log.startsWith(PROGRAM_DATA_PREFIX)) continue;
    const data = base64ToBytes(log.slice(PROGRAM_DATA_PREFIX.length));
    const event = decodeAnnouncementEventData(data);
    if (!event) continue;
    if (event.schemeId !== SCHEME_ID_SECP256K1) continue;
    if (event.ephemeralPubKey.length !== EPHEMERAL_PUBKEY_LEN) continue;
    out.push(eventToAnnouncement(event, provenance));
  }
  return out;
}

/**
 * Fetch historical announcements by walking recent signatures for the announcer program and
 * decoding each transaction's logs. Returns chain-neutral {@link Announcement}s in signature
 * order (newest first, as returned by the RPC).
 */
export async function fetchAnnouncementsRange(
  connection: Connection,
  params: {
    announcerProgramId: PublicKey;
    /** Max signatures to scan (RPC `getSignaturesForAddress` limit; default 1000). */
    limit?: number;
    /** Start searching backwards from this signature (pagination). */
    before?: string;
    /** Search until this signature (pagination). */
    until?: string;
    commitment?: Finality;
  },
): Promise<Announcement[]> {
  const commitment: Finality = params.commitment ?? "confirmed";
  const signatures = await connection.getSignaturesForAddress(
    params.announcerProgramId,
    { limit: params.limit ?? 1000, before: params.before, until: params.until },
    commitment,
  );

  const out: Announcement[] = [];
  for (const sig of signatures) {
    if (sig.err) continue;
    const tx = await connection.getTransaction(sig.signature, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages;
    if (!logs) continue;
    out.push(
      ...decodeAnnouncementLogs(logs, {
        txHash: sig.signature,
        cursor: BigInt(sig.slot),
      }),
    );
  }
  return out;
}

/**
 * Subscribe to new announcer logs and decode them. Returns an unsubscribe function.
 * `cursor` (slot) is not provided by `onLogs`; callers needing the slot should re-fetch by
 * signature.
 */
export function watchAnnouncements(
  connection: Connection,
  params: {
    announcerProgramId: PublicKey;
    commitment?: Finality;
  } & AnnouncementHandlers,
): () => void {
  const id = connection.onLogs(
    params.announcerProgramId,
    (logInfo) => {
      if (logInfo.err) return;
      try {
        for (const a of decodeAnnouncementLogs(logInfo.logs, {
          txHash: logInfo.signature,
        })) {
          params.onAnnouncement(a);
        }
      } catch (e) {
        params.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    },
    params.commitment ?? "confirmed",
  );
  return () => {
    void connection.removeOnLogsListener(id);
  };
}
