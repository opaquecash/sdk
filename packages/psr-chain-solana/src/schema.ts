/**
 * Schema registry (Solana) — schema id computation, PDA derivation, instruction builders, and
 * account parsing. Ported from `solana/frontend/src/lib/{schema,programs}.ts`.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2";
import {
  accountDiscriminator,
  anchorDiscriminator,
  encodeBool,
  encodeFixedBytes,
  encodeOptionPubkey,
  encodeString,
  encodeU64,
  readPubkey,
  readString,
} from "./codec.js";

const SCHEMA_SEED = "schema";

/** `schema_id = sha256(authority_bytes(32) || utf8(name) || [version])`. */
export function computeSchemaId(
  authority: PublicKey,
  name: string,
  version = 1,
): Uint8Array {
  const authorityBytes = authority.toBytes();
  const nameBytes = new TextEncoder().encode(name);
  const combined = new Uint8Array(authorityBytes.length + nameBytes.length + 1);
  combined.set(authorityBytes, 0);
  combined.set(nameBytes, authorityBytes.length);
  combined[authorityBytes.length + nameBytes.length] = version & 0xff;
  return sha256(combined);
}

/** Derive the SchemaPDA: `["schema", authority, schemaId]`. */
export function deriveSchemaPda(
  schemaRegistryProgramId: PublicKey,
  authority: PublicKey,
  schemaId: Uint8Array,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SCHEMA_SEED), authority.toBuffer(), Buffer.from(schemaId)],
    schemaRegistryProgramId,
  );
  return pda;
}

export function buildRegisterSchemaInstruction(params: {
  schemaRegistryProgramId: PublicKey;
  authority: PublicKey;
  schemaPda: PublicKey;
  schemaId: Uint8Array;
  name: string;
  fieldDefinitions: string;
  revocable: boolean;
  resolver?: PublicKey | null;
  schemaExpirySlot: number | bigint;
}): TransactionInstruction {
  const data = Buffer.concat([
    anchorDiscriminator("register_schema"),
    encodeFixedBytes(params.schemaId),
    encodeString(params.name),
    encodeString(params.fieldDefinitions),
    encodeBool(params.revocable),
    encodeOptionPubkey(params.resolver ?? null),
    encodeU64(params.schemaExpirySlot),
  ]);
  return new TransactionInstruction({
    programId: params.schemaRegistryProgramId,
    keys: [
      { pubkey: params.schemaPda, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function delegateInstruction(
  method: "add_delegate" | "remove_delegate",
  schemaRegistryProgramId: PublicKey,
  authority: PublicKey,
  schemaPda: PublicKey,
  delegate: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: schemaRegistryProgramId,
    keys: [
      { pubkey: schemaPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([anchorDiscriminator(method), delegate.toBuffer()]),
  });
}

export function buildAddDelegateInstruction(params: {
  schemaRegistryProgramId: PublicKey;
  authority: PublicKey;
  schemaPda: PublicKey;
  delegate: PublicKey;
}): TransactionInstruction {
  return delegateInstruction(
    "add_delegate",
    params.schemaRegistryProgramId,
    params.authority,
    params.schemaPda,
    params.delegate,
  );
}

export function buildRemoveDelegateInstruction(params: {
  schemaRegistryProgramId: PublicKey;
  authority: PublicKey;
  schemaPda: PublicKey;
  delegate: PublicKey;
}): TransactionInstruction {
  return delegateInstruction(
    "remove_delegate",
    params.schemaRegistryProgramId,
    params.authority,
    params.schemaPda,
    params.delegate,
  );
}

export function buildDeprecateSchemaInstruction(params: {
  schemaRegistryProgramId: PublicKey;
  authority: PublicKey;
  schemaPda: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.schemaRegistryProgramId,
    keys: [
      { pubkey: params.schemaPda, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
    ],
    data: anchorDiscriminator("deprecate_schema"),
  });
}

const SCHEMA_PDA_DISCRIMINATOR = accountDiscriminator("SchemaPDA");

export interface ParsedSchemaPda {
  bump: number;
  schemaId: Uint8Array;
  authority: PublicKey;
  resolver: PublicKey;
  revocable: boolean;
  name: string;
  fieldDefinitions: string;
  version: number;
  delegates: PublicKey[];
  createdAt: bigint;
  schemaExpirySlot: bigint;
  deprecated: boolean;
}

export function parseSchemaPda(data: Buffer): ParsedSchemaPda | null {
  if (data.length < 8) return null;
  if (!data.slice(0, 8).equals(SCHEMA_PDA_DISCRIMINATOR)) return null;

  let offset = 8;
  const bump = data.readUInt8(offset);
  offset += 1;
  const schemaId = new Uint8Array(data.slice(offset, offset + 32));
  offset += 32;
  let authority: PublicKey;
  [authority, offset] = readPubkey(data, offset);
  let resolver: PublicKey;
  [resolver, offset] = readPubkey(data, offset);
  const revocable = data.readUInt8(offset) === 1;
  offset += 1;
  let name: string;
  [name, offset] = readString(data, offset);
  let fieldDefinitions: string;
  [fieldDefinitions, offset] = readString(data, offset);
  const version = data.readUInt8(offset);
  offset += 1;
  const delegateCount = data.readUInt32LE(offset);
  offset += 4;
  const delegates: PublicKey[] = [];
  for (let i = 0; i < delegateCount; i++) {
    let d: PublicKey;
    [d, offset] = readPubkey(data, offset);
    delegates.push(d);
  }
  const createdAt = data.readBigUInt64LE(offset);
  offset += 8;
  const schemaExpirySlot = data.readBigUInt64LE(offset);
  offset += 8;
  const deprecated = data.readUInt8(offset) === 1;

  return {
    bump,
    schemaId,
    authority,
    resolver,
    revocable,
    name,
    fieldDefinitions,
    version,
    delegates,
    createdAt,
    schemaExpirySlot,
    deprecated,
  };
}

export async function fetchSchemaPda(
  connection: Connection,
  schemaPdaAddress: PublicKey,
): Promise<ParsedSchemaPda | null> {
  const info = await connection.getAccountInfo(schemaPdaAddress);
  if (!info?.data) return null;
  return parseSchemaPda(Buffer.from(info.data));
}

export async function fetchAllSchemas(
  connection: Connection,
  schemaRegistryProgramId: PublicKey,
): Promise<{ address: PublicKey; schema: ParsedSchemaPda }[]> {
  const accounts = await connection.getProgramAccounts(schemaRegistryProgramId, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: SCHEMA_PDA_DISCRIMINATOR.toString("base64"),
          encoding: "base64",
        },
      },
    ],
  });
  const out: { address: PublicKey; schema: ParsedSchemaPda }[] = [];
  for (const { pubkey, account } of accounts) {
    const parsed = parseSchemaPda(Buffer.from(account.data));
    if (parsed) out.push({ address: pubkey, schema: parsed });
  }
  return out;
}
