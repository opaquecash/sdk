import type { Attestation, DiscoveredTrait } from "./types.js";

/**
 * Convert raw WASM/JSON {@link Attestation} rows into {@link DiscoveredTrait}.
 *
 * @param rows - Parsed JSON array from `scan_attestations_wasm`.
 * @param nowMs - Optional clock override (defaults to `Date.now()`).
 */
export function attestationsToDiscoveredTraits(
  rows: Attestation[],
  nowMs: number = Date.now(),
): DiscoveredTrait[] {
  return rows.map((a) => ({
    attestationId: a.attestation_id,
    stealthAddress: a.stealth_address,
    txHash: a.tx_hash,
    blockNumber: a.block_number,
    discoveredAt: nowMs,
    ephemeralPubkey: a.ephemeral_pubkey,
  }));
}
