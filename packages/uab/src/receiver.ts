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

/** Read CrossChainAnnouncement events from a UABReceiver over a block range. */
export async function fetchCrossChainAnnouncements(
  client: PublicClient,
  params: { uabReceiver: Address; fromBlock: bigint; toBlock?: bigint | "latest" },
): Promise<CrossChainAnnouncementRecord[]> {
  const logs = await client.getLogs({
    address: params.uabReceiver,
    event: crossChainAnnouncementEvent,
    fromBlock: params.fromBlock,
    toBlock: params.toBlock ?? "latest",
  });

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
