/**
 * PSR V2 schema codecs — chain-neutral. A schema defines an attestation class and controls who
 * may issue it. Ported from `ethereum/frontend/src/lib/schema.ts` (zod schemas dropped).
 */

import { encodePacked, sha256, type Address, type Hex } from "viem";

export type FieldType = "bool" | "u8" | "u16" | "u32" | "u64" | "string" | "pubkey";

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
}

/** A decoded V2 schema record (chain-neutral view). */
export interface SchemaV2 {
  /** Stable id (== schemaId). */
  address: string;
  /** schemaId = sha256(authority || name || version) as 0x-hex (bytes32). */
  schemaId: string;
  /** Wallet that created the schema. */
  authority: string;
  /** Optional resolver (zero address = none). */
  resolver: string;
  /** Whether attestations can be revoked. */
  revocable: boolean;
  /** Display name. */
  name: string;
  /** ABI-style field definitions, e.g. "bool passed, u64 score". */
  fieldDefinitions: string;
  /** Schema version (always 1 currently). */
  version: number;
  /** Authorized delegate addresses. */
  delegates: string[];
  /** Block/slot when registered. */
  createdAt: number;
  /** 0 = no expiry. */
  schemaExpirySlot: number;
  /** Whether the schema has been deprecated. */
  deprecated: boolean;
}

export const SCHEMA_VERSION = 1;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** Parse a `fieldDefinitions` string ("bool passed, u64 score") into {@link FieldDef}s. */
export function parseFieldDefs(fieldDefs: string): FieldDef[] {
  if (!fieldDefs.trim()) return [];
  return fieldDefs.split(",").map((part, i) => {
    const trimmed = part.trim();
    const spaceIdx = trimmed.indexOf(" ");
    const type = (spaceIdx === -1 ? "string" : trimmed.slice(0, spaceIdx)) as FieldType;
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(spaceIdx + 1);
    return { id: String(i), name: name.trim(), type: type.trim() as FieldType };
  });
}

/** Convert {@link FieldDef}s back to the canonical ABI string. */
export function fieldDefsToString(fields: readonly FieldDef[]): string {
  return fields
    .filter((f) => f.name.trim())
    .map((f) => `${f.type} ${f.name.trim()}`)
    .join(", ");
}

/**
 * `schemaId = sha256(abi.encodePacked(authority, bytes(name), version))`, byte-for-byte matching
 * the schema registry's `computeSchemaId` on-chain.
 */
export function computeSchemaId(
  authority: Address,
  name: string,
  version: number = SCHEMA_VERSION,
): Hex {
  return sha256(encodePacked(["address", "string", "uint8"], [authority, name, version]));
}

/** Normalize a schemaId hex to the `0x`-prefixed field input the V2 circuit expects. */
export function packSchemaIdToField(schemaId: string): string {
  return schemaId.startsWith("0x") ? schemaId : "0x" + schemaId;
}
