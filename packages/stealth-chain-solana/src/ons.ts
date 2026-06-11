/**
 * ONS mirror reads (spec/ONS.md §3): resolve `alice.opq.eth` from Solana with one
 * account fetch and no Ethereum RPC. The `ons-mirror` program holds a read-only PDA
 * per name, written exclusively from Wormhole VAAs emitted by the canonical
 * OpaqueNameRegistry on Ethereum; this module derives the PDA from
 * `keccak256(lowercase full name)` and parses the record.
 *
 * Consistency: a mirror record lags the canonical record by Wormhole end-to-end
 * latency (eventually consistent, canonical-chain-wins). Clients that can also
 * reach an Ethereum RPC MAY prefer canonical resolution.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import type { Hex } from "@opaquecash/adapter";
import { bytesToHex } from "./bytes.js";

/** PDA seed prefix for a mirrored name record: `["ons_mirror", keccak256(name)]`. */
export const ONS_MIRROR_RECORD_SEED = "ons_mirror";

/** Anchor account discriminator: `sha256("account:OnsRecord")[0..8]`. */
export const ONS_RECORD_DISCRIMINATOR = sha256(
  new TextEncoder().encode("account:OnsRecord"),
).subarray(0, 8);

/** Total `OnsRecord` account length: 8 (discriminator) + 167 (fields). */
const ONS_RECORD_LEN = 8 + 32 + 33 + 33 + 20 + 32 + 8 + 8 + 1;

/** A mirrored ONS name record (spec/ONS.md §3). */
export interface OnsMirrorRecord {
  /** `keccak256(utf8(fullName))`. */
  nameHash: Hex;
  /** CSAP §2.1 66-byte meta-address, `V‖S` (viewing half first). */
  metaAddressHex: Hex;
  /** 33-byte compressed spending public key. */
  spendPubKey: Hex;
  /** 33-byte compressed viewing public key. */
  viewPubKey: Hex;
  /** Canonical registrant (20-byte Ethereum address; surrogate for Solana claims). */
  ethOwner: Hex;
  /** Claimer's Solana pubkey, or `null` when the name was claimed from Ethereum. */
  solAuthority: PublicKey | null;
  /** Last applied Wormhole sequence from the canonical registry. */
  wormholeSequence: bigint;
  /** Unix seconds of the last applied update (mirror-side clock). */
  updatedAt: number;
}

/** `keccak256` of the lowercase full name — the mirror PDA key (spec/ONS.md §1.3). */
export function onsNameHash(fullName: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(fullName.toLowerCase()));
}

/** Derive the mirror record PDA for a full name (e.g. `"alice.opq.eth"`). */
export function getOnsMirrorRecordPda(
  mirrorProgramId: PublicKey,
  fullName: string,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ONS_MIRROR_RECORD_SEED), onsNameHash(fullName)],
    mirrorProgramId,
  );
  return pda;
}

/** Parse a raw `OnsRecord` account, or return `null` when it is not one. */
export function decodeOnsMirrorRecord(data: Uint8Array): OnsMirrorRecord | null {
  if (data.length !== ONS_RECORD_LEN) return null;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== ONS_RECORD_DISCRIMINATOR[i]) return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const spend = data.subarray(40, 73);
  const viewKey = data.subarray(73, 106);
  const authority = new PublicKey(data.subarray(126, 158));
  const hex = (b: Uint8Array): Hex => `0x${bytesToHex(b)}` as Hex;
  return {
    nameHash: hex(data.subarray(8, 40)),
    // CSAP §2.1 order: viewing half first.
    metaAddressHex: hex(Uint8Array.from([...viewKey, ...spend])),
    spendPubKey: hex(spend),
    viewPubKey: hex(viewKey),
    ethOwner: hex(data.subarray(106, 126)),
    solAuthority: authority.equals(PublicKey.default) ? null : authority,
    wormholeSequence: view.getBigUint64(158, true),
    updatedAt: Number(view.getBigInt64(166, true)),
  };
}

/**
 * Fetch and decode the mirror record for a full name. Returns `null` when the name
 * has no mirror record (unregistered, revoked, or the mirror has not caught up yet).
 */
export async function fetchOnsMirrorRecord(
  connection: Connection,
  mirrorProgramId: PublicKey,
  fullName: string,
): Promise<OnsMirrorRecord | null> {
  const pda = getOnsMirrorRecordPda(mirrorProgramId, fullName);
  const info = await connection.getAccountInfo(pda);
  if (!info || !info.owner.equals(mirrorProgramId)) return null;
  return decodeOnsMirrorRecord(info.data);
}
