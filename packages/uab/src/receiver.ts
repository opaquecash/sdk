import { bytesToHex, getAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  decodeUabPayload,
  uabPayloadToMetadata,
  uabStealthAddressEvm,
  type UabPayload,
} from "@opaquecash/stealth-core";
import { crossChainAnnouncementEvent } from "./abis.js";

/** A decoded cross-chain announcement re-emitted by the UABReceiver. */
export interface CrossChainAnnouncementRecord {
  sourceChain: number;
  sourceEmitter: Hex;
  sequence: bigint;
  payload: UabPayload;
  payloadHex: Hex;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
}

/**
 * Indexer-shaped row, structurally identical to `@opaquecash/opaque`'s `IndexerAnnouncement`,
 * so a cross-chain announcement can be scanned by the same `filterOwnedAnnouncements` path.
 */
export interface UabIndexerAnnouncement {
  blockNumber: string;
  etherealPublicKey: Hex;
  logIndex: number;
  metadata: Hex;
  stealthAddress: Address;
  transactionHash: Hex;
  viewTag: number;
}

/**
 * Default `eth_getLogs` window. Public RPCs cap the queryable range (publicnode: 50k blocks,
 * others as low as 10k); large ranges are split into windows of this size.
 */
const DEFAULT_LOG_CHUNK_BLOCKS = 45_000n;
/** Below this window size a range error is considered fatal rather than splittable. */
const MIN_LOG_CHUNK_BLOCKS = 1_000n;

/**
 * Read CrossChainAnnouncement events from a UABReceiver over a block range, in bounded
 * `eth_getLogs` windows (halved on provider range errors) so public RPC block-range caps
 * don't fail the scan.
 */
export async function fetchCrossChainAnnouncements(
  client: PublicClient,
  params: {
    uabReceiver: Address;
    fromBlock: bigint;
    toBlock?: bigint | "latest";
    /** Maximum blocks per `eth_getLogs` call (default 45000). */
    chunkBlocks?: bigint;
  },
): Promise<CrossChainAnnouncementRecord[]> {
  const toBlock =
    params.toBlock == null || params.toBlock === "latest"
      ? await client.getBlockNumber()
      : params.toBlock;
  if (params.fromBlock > toBlock) return [];

  type UabLogs = Awaited<ReturnType<typeof client.getLogs<typeof crossChainAnnouncementEvent>>>;
  const logs: UabLogs = [];
  let chunk = params.chunkBlocks ?? DEFAULT_LOG_CHUNK_BLOCKS;
  let from = params.fromBlock;
  while (from <= toBlock) {
    const to = from + chunk - 1n < toBlock ? from + chunk - 1n : toBlock;
    try {
      const page = await client.getLogs({
        address: params.uabReceiver,
        event: crossChainAnnouncementEvent,
        fromBlock: from,
        toBlock: to,
      });
      logs.push(...page);
      from = to + 1n;
    } catch (e) {
      if (chunk <= MIN_LOG_CHUNK_BLOCKS) throw e;
      chunk = chunk / 2n;
    }
  }

  return logs.map((log) => {
    const payloadHex = log.args.payload as Hex;
    return {
      sourceChain: Number(log.args.sourceChain),
      sourceEmitter: log.args.sourceEmitter as Hex,
      sequence: log.args.sequence as bigint,
      payload: decodeUabPayload(payloadHex),
      payloadHex,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
    };
  });
}

/** Convert a cross-chain announcement into an indexer-shaped row for the scanner. */
export function toIndexerAnnouncement(r: CrossChainAnnouncementRecord): UabIndexerAnnouncement {
  return {
    blockNumber: r.blockNumber.toString(),
    etherealPublicKey: bytesToHex(r.payload.ephemeralPubKey),
    logIndex: r.logIndex,
    metadata: bytesToHex(uabPayloadToMetadata(r.payload)),
    stealthAddress: getAddress(bytesToHex(uabStealthAddressEvm(r.payload))),
    transactionHash: r.transactionHash,
    viewTag: r.payload.viewTag,
  };
}
