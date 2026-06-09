/**
 * `StealthMetaAddressRegistry` (Solana) — PDA derivation, `register_keys` instruction
 * building, and meta-address resolution. Mirrors the read/write surface of
 * `@opaquecash/stealth-chain` (EVM) so both adapters expose the same shape.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { Hex } from "@opaquecash/adapter";
import { bytesToHex, concatBytes, u64le, vecU8 } from "./bytes.js";
import {
  REGISTER_KEYS_DISCRIMINATOR,
  REGISTRY_ENTRY_SEED,
  SCHEME_ID_SECP256K1,
} from "./programs.js";

/** Byte layout of a `RegistryEntry` account before the 66-byte meta-address. */
const REGISTRY_ENTRY_META_OFFSET =
  8 /* discriminator */ + 32 /* registrant pubkey */ + 8 /* scheme_id u64 */ + 4 /* vec len */;

/** Length of a stealth meta-address (compressed V || compressed S). */
const META_ADDRESS_LEN = 66;

/**
 * Derive the registry entry PDA for `(registrant, schemeId)`:
 * `["stealth_meta", registrant, schemeId_le]`.
 */
export function getRegistryEntryPda(
  registryProgramId: PublicKey,
  registrant: PublicKey,
  schemeId: bigint = SCHEME_ID_SECP256K1,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode(REGISTRY_ENTRY_SEED),
      registrant.toBuffer(),
      u64le(schemeId),
    ],
    registryProgramId,
  );
  return pda;
}

/**
 * Build a `register_keys` instruction. The caller (`registrant`) signs and pays; the app's
 * wallet layer submits the resulting transaction.
 */
export function buildRegisterKeysInstruction(params: {
  registryProgramId: PublicKey;
  registrant: PublicKey;
  /** 66-byte stealth meta-address (compressed V || S). */
  stealthMetaAddress: Uint8Array;
  schemeId?: bigint;
}): TransactionInstruction {
  const schemeId = params.schemeId ?? SCHEME_ID_SECP256K1;
  const data = concatBytes(
    REGISTER_KEYS_DISCRIMINATOR,
    u64le(schemeId),
    vecU8(params.stealthMetaAddress),
  );
  const registryEntryPda = getRegistryEntryPda(
    params.registryProgramId,
    params.registrant,
    schemeId,
  );
  return new TransactionInstruction({
    programId: params.registryProgramId,
    keys: [
      { pubkey: registryEntryPda, isSigner: false, isWritable: true },
      { pubkey: params.registrant, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/** Decode the 66-byte meta-address out of raw `RegistryEntry` account data. */
export function decodeRegistryEntryMetaAddress(data: Uint8Array): Hex | null {
  if (data.length < REGISTRY_ENTRY_META_OFFSET + META_ADDRESS_LEN) return null;
  const meta = data.slice(
    REGISTRY_ENTRY_META_OFFSET,
    REGISTRY_ENTRY_META_OFFSET + META_ADDRESS_LEN,
  );
  return ("0x" + bytesToHex(meta)) as Hex;
}

/**
 * Resolve a registrant's 66-byte stealth meta-address via the registry PDA, or `null` when
 * unregistered.
 */
export async function resolveMetaAddress(
  connection: Connection,
  params: { registryProgramId: PublicKey; registrant: PublicKey | string },
): Promise<Hex | null> {
  const registrant =
    typeof params.registrant === "string"
      ? new PublicKey(params.registrant)
      : params.registrant;
  const pda = getRegistryEntryPda(params.registryProgramId, registrant);
  const info = await connection.getAccountInfo(pda);
  if (!info?.data) return null;
  return decodeRegistryEntryMetaAddress(new Uint8Array(info.data));
}

/** Whether `registrant` has a stealth meta-address registered. */
export async function isRegistered(
  connection: Connection,
  params: { registryProgramId: PublicKey; registrant: PublicKey | string },
): Promise<boolean> {
  const meta = await resolveMetaAddress(connection, params);
  return meta != null && meta.length === 2 + META_ADDRESS_LEN * 2;
}
