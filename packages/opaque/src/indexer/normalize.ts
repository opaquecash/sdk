import { hexToBytes, type Hex } from "viem";
import type { AnnouncementJsonRecord } from "@opaquecash/stealth-core";
import type { IndexerAnnouncement } from "../types/indexer.js";

function toNumberArray(h: Hex): number[] {
  return Array.from(hexToBytes(h));
}

/**
 * Map a subgraph/indexer row into the JSON record expected by `scan_attestations_wasm`.
 */
export function indexerAnnouncementToScannerRecord(
  row: IndexerAnnouncement,
): AnnouncementJsonRecord {
  const bn = Number.parseInt(row.blockNumber, 10);
  if (!Number.isFinite(bn)) {
    throw new Error(
      `Invalid blockNumber on announcement ${row.transactionHash}: ${row.blockNumber}`,
    );
  }
  const epkBytes = hexToBytes(row.etherealPublicKey);
  if (epkBytes.length !== 33) {
    throw new Error(
      `Invalid etherealPublicKey on announcement ${row.transactionHash}: expected 33-byte compressed secp256k1 pubkey, got ${epkBytes.length} bytes`,
    );
  }
  if (epkBytes[0] !== 0x02 && epkBytes[0] !== 0x03) {
    throw new Error(
      `Invalid etherealPublicKey on announcement ${row.transactionHash}: expected compressed prefix 0x02 or 0x03, got 0x${epkBytes[0].toString(16)}`,
    );
  }

  const vtRaw = (row as any)?.viewTag as unknown;
  const vt =
    typeof vtRaw === "number"
      ? vtRaw
      : typeof vtRaw === "string"
        ? Number.parseInt(vtRaw, 10)
        : Number(vtRaw);
  if (!Number.isFinite(vt) || !Number.isInteger(vt) || vt < 0 || vt > 255) {
    throw new Error(
      `Invalid viewTag on announcement ${row.transactionHash}: expected integer 0..255, got ${String(vtRaw)}`,
    );
  }
  return {
    stealthAddress: row.stealthAddress,
    viewTag: vt,
    ephemeralPubKey: Array.from(epkBytes),
    metadata: toNumberArray(row.metadata),
    txHash: row.transactionHash,
    blockNumber: bn,
  };
}

/**
 * Batch-normalize indexer rows for WASM or playground inspection.
 */
export function indexerAnnouncementsToScannerJson(
  rows: IndexerAnnouncement[],
): string {
  return JSON.stringify(rows.map(indexerAnnouncementToScannerRecord));
}
