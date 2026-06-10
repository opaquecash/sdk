/**
 * Read Ethereum-originated announcements mirrored on Solana by the `uab-receiver`
 * program. The program verifies a posted Wormhole VAA and re-emits the canonical
 * 96-byte payload as a `CrossChainAnnouncement` Anchor event; this module decodes
 * those events into the same chain-neutral {@link Announcement} shape as native
 * announcer logs, so the universal scan loop needs no special casing.
 */

import { Connection, PublicKey, type Finality } from "@solana/web3.js";
import type { Announcement, Hex } from "@opaquecash/adapter";
import {
  decodeUabPayload,
  uabPayloadToMetadata,
  uabStealthAddressEvm,
  UAB_PAYLOAD_LENGTH,
  type UabPayload,
} from "@opaquecash/stealth-core";
import { ByteReader, bytesToHex } from "./bytes.js";
import {
  CROSS_CHAIN_ANNOUNCEMENT_EVENT_DISCRIMINATOR,
  SCHEME_ID_SECP256K1,
} from "./programs.js";

const PROGRAM_DATA_PREFIX = "Program data: ";

/** A decoded `CrossChainAnnouncement` event from the `uab-receiver` program. */
export interface DecodedCrossChainAnnouncementEvent {
  /** Wormhole chain id of the origin chain (Ethereum = 2). */
  sourceChain: number;
  /** Wormhole-formatted 32-byte emitter address on the origin chain. */
  sourceEmitter: Uint8Array;
  /** Wormhole sequence number of the carrying VAA. */
  sequence: bigint;
  /** Decoded canonical 96-byte payload. */
  payload: UabPayload;
}

function discriminatorMatches(data: Uint8Array, disc: Uint8Array): boolean {
  if (data.length < disc.length) return false;
  for (let i = 0; i < disc.length; i++) if (data[i] !== disc[i]) return false;
  return true;
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

/**
 * Decode a single `CrossChainAnnouncement` event payload (the bytes after the
 * `Program data: ` base64 decode). Returns `null` when the discriminator does not
 * match or the buffer is malformed.
 */
export function decodeCrossChainAnnouncementEventData(
  data: Uint8Array,
): DecodedCrossChainAnnouncementEvent | null {
  if (!discriminatorMatches(data, CROSS_CHAIN_ANNOUNCEMENT_EVENT_DISCRIMINATOR)) {
    return null;
  }
  try {
    const r = new ByteReader(data, CROSS_CHAIN_ANNOUNCEMENT_EVENT_DISCRIMINATOR.length);
    const sourceChain = r.readU16();
    const sourceEmitter = r.readBytes(32);
    const sequence = r.readU64();
    const payloadBytes = r.readVecU8();
    if (payloadBytes.length !== UAB_PAYLOAD_LENGTH) return null;
    return {
      sourceChain,
      sourceEmitter,
      sequence,
      payload: decodeUabPayload(payloadBytes),
    };
  } catch {
    return null;
  }
}

/** Map a decoded cross-chain event to the chain-neutral {@link Announcement} shape. */
export function crossChainEventToAnnouncement(
  event: DecodedCrossChainAnnouncementEvent,
  provenance: { txHash?: string; cursor?: bigint } = {},
): Announcement {
  const p = event.payload;
  return {
    // The scanner matches the 20-byte EVM-style identifier on both chains (CSAP §2.3).
    stealthAddress: ("0x" + bytesToHex(uabStealthAddressEvm(p))) as Hex,
    ephemeralPubKey: p.ephemeralPubKey,
    viewTag: p.viewTag,
    metadata: uabPayloadToMetadata(p),
    // The announcement's origin chain, NOT Solana — callers can distinguish
    // relayed announcements from native ones by comparing against the adapter's id.
    chainId: p.sourceChainId,
    txHash: provenance.txHash,
    cursor: provenance.cursor,
  };
}

/**
 * Decode every `CrossChainAnnouncement` event in a transaction's log messages.
 * Non-matching `Program data:` lines are skipped, as are payloads whose scheme id
 * is not secp256k1 (scheme 1).
 */
export function decodeCrossChainAnnouncementLogs(
  logs: string[],
  provenance: { txHash?: string; cursor?: bigint } = {},
): Announcement[] {
  const out: Announcement[] = [];
  for (const log of logs) {
    if (!log.startsWith(PROGRAM_DATA_PREFIX)) continue;
    const data = base64ToBytes(log.slice(PROGRAM_DATA_PREFIX.length));
    const event = decodeCrossChainAnnouncementEventData(data);
    if (!event) continue;
    if (BigInt(event.payload.schemeId) !== SCHEME_ID_SECP256K1) continue;
    out.push(crossChainEventToAnnouncement(event, provenance));
  }
  return out;
}

/**
 * Fetch historical cross-chain announcements by walking recent signatures for the
 * `uab-receiver` program and decoding each transaction's logs. Returns chain-neutral
 * {@link Announcement}s (with the *origin* chain id) in signature order (newest first).
 */
export async function fetchCrossChainAnnouncementsRange(
  connection: Connection,
  params: {
    uabReceiverProgramId: PublicKey;
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
    params.uabReceiverProgramId,
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
      ...decodeCrossChainAnnouncementLogs(logs, {
        txHash: sig.signature,
        cursor: BigInt(sig.slot),
      }),
    );
  }
  return out;
}
