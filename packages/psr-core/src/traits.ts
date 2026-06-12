import type {
  Attestation,
  AttestationIdentifier,
  DiscoveredTrait,
  V2Attestation,
} from "./types.js";

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

/**
 * Convert raw V2 WASM scanner rows into {@link DiscoveredTrait}.
 *
 * V2 uses the schema id as the public circuit identifier, so the resulting
 * `attestationId` may be a hex string rather than a V1-safe JavaScript number.
 */
export function v2AttestationsToDiscoveredTraits(
  rows: V2Attestation[],
  nowMs: number = Date.now(),
): DiscoveredTrait[] {
  return rows.map((a) => {
    const schemaId = ensure0x(a.schema_id);
    const preimage = a.merkle_leaf_preimage;
    return {
      attestationId: fieldIdentifier(preimage.schema_id_field),
      stealthAddress: a.stealth_address,
      txHash: a.tx_hash,
      blockNumber: a.slot,
      discoveredAt: nowMs,
      ephemeralPubkey: a.ephemeral_pubkey,
      schemaId,
      schemaName: a.schema_name ?? null,
      issuer: ensure0x(a.issuer),
      attestationUid: ensure0x(a.attestation_uid),
      dataHex: ensure0x(a.data_hex),
      nonce: ensure0x(a.nonce),
      merkleLeafPreimage: {
        stealthPkField: preimage.stealth_pk_field,
        schemaIdField: preimage.schema_id_field,
        issuerPkX: preimage.issuer_pk_x,
        traitDataHash: preimage.trait_data_hash,
        nonceField: preimage.nonce_field,
      },
      isValid: a.is_valid,
      issuerAuthorized: a.issuer_authorized,
    };
  });
}

function ensure0x(value: string): string {
  if (!value) return "0x";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function fieldIdentifier(value: string): AttestationIdentifier {
  const normalized = ensure0x(value);
  try {
    const n = BigInt(normalized);
    return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : normalized;
  } catch {
    return value;
  }
}
