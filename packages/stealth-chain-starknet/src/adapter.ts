import type {
  Announcement,
  ChainAdapter,
  FetchAnnouncementsOptions,
  Hex,
} from "@opaquecash/adapter";
import { decodeByteArray, selectorHex } from "./bytearray.js";
import {
  getStarknetDeployment,
  OPAQUE_CHAIN_STARKNET,
  type StarknetDeployment,
} from "./deployment.js";
import { StarknetRpc, type StarknetEmittedEvent } from "./rpc.js";

const ANNOUNCEMENT_EVENT_KEY = selectorHex("Announcement");
const EVENTS_CHUNK_SIZE = 256;

export interface StarknetAdapterOptions {
  /** JSON-RPC 0.10.x endpoint; defaults to the deployment's public node. */
  nodeUrl?: string;
  deployment?: StarknetDeployment;
  /** Injectable fetch (tests). */
  fetchFn?: typeof fetch;
}

/**
 * `ChainAdapter` for Starknet. Fetches CSAP `Announcement` events from the
 * Cairo announcer and normalises them to the chain-neutral shape (20-byte
 * scanner id, 33-byte secp256k1 ephemeral key, view tag = `metadata[0]`), so
 * the shared view-tag filter and DKSAP recovery run unchanged.
 */
export class StarknetAdapter implements ChainAdapter {
  readonly chainId = OPAQUE_CHAIN_STARKNET;
  readonly name = "starknet";
  readonly deployment: StarknetDeployment;
  private readonly rpc: StarknetRpc;

  constructor(options: StarknetAdapterOptions = {}) {
    this.deployment = options.deployment ?? getStarknetDeployment("sepolia");
    this.rpc = new StarknetRpc(
      options.nodeUrl ?? this.deployment.nodeUrl,
      options.fetchFn,
    );
  }

  async fetchAnnouncements(
    opts: FetchAnnouncementsOptions = {},
  ): Promise<Announcement[]> {
    const out: Announcement[] = [];
    let continuationToken: string | undefined;
    const fromBlock = Number(
      opts.fromCursor ?? BigInt(this.deployment.announcerFromBlock),
    );
    do {
      const page = await this.rpc.getEvents({
        address: this.deployment.stealthAnnouncer,
        keys: [[ANNOUNCEMENT_EVENT_KEY]],
        from_block: { block_number: fromBlock },
        to_block:
          opts.toCursor != null
            ? { block_number: Number(opts.toCursor) }
            : "latest",
        chunk_size: EVENTS_CHUNK_SIZE,
        continuation_token: continuationToken,
      });
      for (const event of page.events) {
        const decoded = decodeAnnouncementEvent(event);
        if (decoded) out.push(decoded);
        if (opts.limit != null && out.length >= opts.limit) return out;
      }
      continuationToken = page.continuation_token;
    } while (continuationToken != null);
    return out;
  }

  /** Identity is a Starknet account address (`0x`-hex felt). */
  async resolveMetaAddress(identity: string): Promise<Hex | null> {
    const result = await this.rpc.call(
      this.deployment.stealthRegistry,
      "stealth_meta_address_of",
      [identity, "0x1", "0x0"],
    );
    const { bytes } = decodeByteArray(result.map(BigInt));
    if (bytes.length === 0) return null;
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return `0x${hex}` as Hex;
  }

  async isRegistered(identity: string): Promise<boolean> {
    return (await this.resolveMetaAddress(identity)) != null;
  }
}

/**
 * Decode one announcer event. Keys: `[selector, scheme_id.low, scheme_id.high,
 * stealth_address, caller]`; data: `ByteArray` ephemeral key then `ByteArray`
 * metadata. Returns `null` for events that are not CSAP scheme-1 announcements
 * or are malformed (skip, never throw — one bad event must not kill a scan).
 */
export function decodeAnnouncementEvent(
  event: StarknetEmittedEvent,
): Announcement | null {
  try {
    if (event.keys.length !== 5) return null;
    const schemeId = BigInt(event.keys[1]) + (BigInt(event.keys[2]) << 128n);
    if (schemeId !== 1n) return null;

    const data = event.data.map(BigInt);
    const ephemeral = decodeByteArray(data, 0);
    const metadata = decodeByteArray(data, ephemeral.consumed);
    if (ephemeral.bytes.length !== 33 || metadata.bytes.length === 0) {
      return null;
    }
    return {
      stealthAddress: `0x${BigInt(event.keys[3])
        .toString(16)
        .padStart(40, "0")}` as Hex,
      ephemeralPubKey: ephemeral.bytes,
      viewTag: metadata.bytes[0],
      metadata: metadata.bytes,
      chainId: OPAQUE_CHAIN_STARKNET,
      txHash: event.transaction_hash,
      cursor:
        event.block_number != null ? BigInt(event.block_number) : undefined,
    };
  } catch {
    return null;
  }
}
