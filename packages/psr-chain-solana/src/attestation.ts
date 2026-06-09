/**
 * Attestation engine V2 (Solana) — PDA derivation, attest/revoke instruction builders, and
 * account parsing. Ported from `solana/frontend/src/lib/{attestationV2,programs}.ts`.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  accountDiscriminator,
  anchorDiscriminator,
  encodeFixedBytes,
  encodeU64,
  encodeVecU8,
  readPubkey,
} from "./codec.js";

const ATTESTATION_SEED = "attestation_v2";

/** Derive the AttestationPDA: `["attestation_v2", schemaId, issuer, stealthAddressHash]`. */
export function deriveAttestationPda(
  attestationProgramId: PublicKey,
  schemaId: Uint8Array,
  issuer: PublicKey,
  stealthAddressHash: Uint8Array,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(ATTESTATION_SEED),
      Buffer.from(schemaId),
      issuer.toBuffer(),
      Buffer.from(stealthAddressHash),
    ],
    attestationProgramId,
  );
  return pda;
}

export function buildAttestInstruction(params: {
  attestationProgramId: PublicKey;
  issuer: PublicKey;
  schemaPda: PublicKey;
  attestationPda: PublicKey;
  stealthAddressHash: Uint8Array;
  data: Uint8Array;
  expirationSlot: number | bigint;
  refUid: Uint8Array;
  resolverProgram?: PublicKey;
}): TransactionInstruction {
  const ixData = Buffer.concat([
    anchorDiscriminator("attest"),
    encodeFixedBytes(params.stealthAddressHash),
    encodeVecU8(params.data),
    encodeU64(params.expirationSlot),
    encodeFixedBytes(params.refUid),
  ]);
  return new TransactionInstruction({
    programId: params.attestationProgramId,
    keys: [
      { pubkey: params.schemaPda, isSigner: false, isWritable: false },
      { pubkey: params.attestationPda, isSigner: false, isWritable: true },
      { pubkey: params.issuer, isSigner: true, isWritable: true },
      // resolver_program slot (Pubkey::default() placeholder when absent) precedes system_program.
      {
        pubkey: params.resolverProgram ?? PublicKey.default,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });
}

export function buildRevokeInstruction(params: {
  attestationProgramId: PublicKey;
  revoker: PublicKey;
  schemaPda: PublicKey;
  attestationPda: PublicKey;
  attestationUid: Uint8Array;
  resolverProgram?: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.attestationProgramId,
    keys: [
      { pubkey: params.schemaPda, isSigner: false, isWritable: false },
      { pubkey: params.attestationPda, isSigner: false, isWritable: true },
      { pubkey: params.revoker, isSigner: true, isWritable: false },
      {
        pubkey: params.resolverProgram ?? PublicKey.default,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: Buffer.concat([
      anchorDiscriminator("revoke"),
      encodeFixedBytes(params.attestationUid),
    ]),
  });
}

const ATTESTATION_PDA_DISCRIMINATOR = accountDiscriminator("AttestationPDA");

export interface ParsedAttestationPda {
  bump: number;
  uid: Uint8Array;
  schemaPda: PublicKey;
  schemaId: Uint8Array;
  issuer: PublicKey;
  stealthAddressHash: Uint8Array;
  data: Uint8Array;
  createdAt: bigint;
  expirationSlot: bigint;
  revocationSlot: bigint;
  refUid: Uint8Array;
}

export function parseAttestationPda(data: Buffer): ParsedAttestationPda | null {
  if (data.length < 8) return null;
  if (!data.slice(0, 8).equals(ATTESTATION_PDA_DISCRIMINATOR)) return null;

  let offset = 8;
  const bump = data.readUInt8(offset);
  offset += 1;
  const uid = new Uint8Array(data.slice(offset, offset + 32));
  offset += 32;
  let schemaPda: PublicKey;
  [schemaPda, offset] = readPubkey(data, offset);
  const schemaId = new Uint8Array(data.slice(offset, offset + 32));
  offset += 32;
  let issuer: PublicKey;
  [issuer, offset] = readPubkey(data, offset);
  const stealthAddressHash = new Uint8Array(data.slice(offset, offset + 32));
  offset += 32;
  const dataLen = data.readUInt32LE(offset);
  offset += 4;
  const attestData = new Uint8Array(data.slice(offset, offset + dataLen));
  offset += dataLen;
  const createdAt = data.readBigUInt64LE(offset);
  offset += 8;
  const expirationSlot = data.readBigUInt64LE(offset);
  offset += 8;
  const revocationSlot = data.readBigUInt64LE(offset);
  offset += 8;
  const refUid = new Uint8Array(data.slice(offset, offset + 32));

  return {
    bump,
    uid,
    schemaPda,
    schemaId,
    issuer,
    stealthAddressHash,
    data: attestData,
    createdAt,
    expirationSlot,
    revocationSlot,
    refUid,
  };
}

export async function fetchAttestationPda(
  connection: Connection,
  attestationPdaAddress: PublicKey,
): Promise<ParsedAttestationPda | null> {
  const info = await connection.getAccountInfo(attestationPdaAddress);
  if (!info?.data) return null;
  return parseAttestationPda(Buffer.from(info.data));
}

export async function fetchAllAttestations(
  connection: Connection,
  attestationProgramId: PublicKey,
): Promise<{ address: PublicKey; attestation: ParsedAttestationPda }[]> {
  const accounts = await connection.getProgramAccounts(attestationProgramId, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: ATTESTATION_PDA_DISCRIMINATOR.toString("base64"),
          encoding: "base64",
        },
      },
    ],
  });
  const out: { address: PublicKey; attestation: ParsedAttestationPda }[] = [];
  for (const { pubkey, account } of accounts) {
    const parsed = parseAttestationPda(Buffer.from(account.data));
    if (parsed) out.push({ address: pubkey, attestation: parsed });
  }
  return out;
}
