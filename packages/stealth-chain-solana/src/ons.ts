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

import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import type { Hex } from "@opaquecash/adapter";
import { bytesToHex, concatBytes, u32le, u64le, vecU8 } from "./bytes.js";
import {
  deriveWormholeConfigPda,
  deriveWormholeEmitterPda,
  deriveWormholeFeeCollectorPda,
  deriveWormholeSequencePda,
} from "./relay.js";

/** PDA seed prefix for a mirrored name record: `["ons_mirror", keccak256(name)]`. */
export const ONS_MIRROR_RECORD_SEED = "ons_mirror";

/** PDA seed prefix for a provisional claim: `["ons_claim", keccak256(name)]`. */
export const ONS_CLAIM_SEED = "ons_claim";

/** Pending window after which an unconfirmed claim reconciles as expired (spec/ONS.md §6). */
export const ONS_PENDING_WINDOW_SECS = 24 * 60 * 60;

/** Anchor account discriminator: `sha256("account:OnsRecord")[0..8]`. */
export const ONS_RECORD_DISCRIMINATOR = sha256(
  new TextEncoder().encode("account:OnsRecord"),
).subarray(0, 8);

/** Anchor account discriminator: `sha256("account:ProvisionalClaim")[0..8]`. */
export const ONS_CLAIM_DISCRIMINATOR = sha256(
  new TextEncoder().encode("account:ProvisionalClaim"),
).subarray(0, 8);

const ixDiscriminator = (name: string): Uint8Array =>
  sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8);

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

// ---------------------------------------------------------------------------
// Solana-originated claims (spec/ONS.md §4.2 / §6)
// ---------------------------------------------------------------------------

/** A provisional claim account (`ons-registration` program). */
export interface OnsProvisionalClaim {
  claimer: PublicKey;
  nameHash: Hex;
  /** Unix seconds the claim was created (starts the pending window). */
  createdAt: number;
}

/** Derive the provisional claim PDA for a full name. */
export function getOnsClaimPda(
  registrationProgramId: PublicKey,
  fullName: string,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ONS_CLAIM_SEED), onsNameHash(fullName)],
    registrationProgramId,
  );
  return pda;
}

/** Parse a raw `ProvisionalClaim` account, or return `null` when it is not one. */
export function decodeOnsProvisionalClaim(data: Uint8Array): OnsProvisionalClaim | null {
  if (data.length !== 8 + 32 + 32 + 8 + 1) return null;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== ONS_CLAIM_DISCRIMINATOR[i]) return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    claimer: new PublicKey(data.subarray(8, 40)),
    nameHash: `0x${bytesToHex(data.subarray(40, 72))}` as Hex,
    createdAt: Number(view.getBigInt64(72, true)),
  };
}

/** Parameters for {@link buildOnsClaimInstruction}. */
export interface OnsClaimInstructionParams {
  registrationProgramId: PublicKey;
  wormholeCore: PublicKey;
  /** The claiming wallet: signer, fee payer, and the claim's Solana authority. */
  claimer: PublicKey;
  /** The label being claimed (`alice`), lowercase LDH. */
  label: string;
  /** The parent name in force (`opq.eth` / `opqtest.eth`). */
  parentName: string;
  /** 33-byte compressed spending public key. */
  spendPubKey: Uint8Array;
  /** 33-byte compressed viewing public key. */
  viewPubKey: Uint8Array;
  /** Fresh keypair pubkey for the Wormhole message account (must also sign). */
  wormholeMessage: PublicKey;
  /** Wormhole batch id / nonce (default 0). */
  batchId?: number;
  /** Wormhole message fee in lamports (10 on devnet; see `fetchWormholeMessageFee`). */
  wormholeFee?: bigint;
}

/**
 * Build the `ons-registration::claim` instruction: creates the provisional PDA and
 * publishes the ONS claim payload through the Wormhole Core Contract. The claim is
 * PROVISIONAL (canonical-chain-wins): track it with {@link fetchOnsClaimStatus}.
 */
export function buildOnsClaimInstruction(
  params: OnsClaimInstructionParams,
): TransactionInstruction {
  const fullName = `${params.label}.${params.parentName}`.toLowerCase();
  const nameHash = onsNameHash(fullName);
  const config = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("config")],
    params.registrationProgramId,
  )[0];
  const emitter = deriveWormholeEmitterPda(params.registrationProgramId);

  const data = concatBytes(
    ixDiscriminator("claim"),
    nameHash,
    vecU8(new TextEncoder().encode(params.label.toLowerCase())), // borsh String
    params.spendPubKey,
    params.viewPubKey,
    u32le(params.batchId ?? 0),
    u64le(params.wormholeFee ?? 0n),
  );

  return new TransactionInstruction({
    programId: params.registrationProgramId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: getOnsClaimPda(params.registrationProgramId, fullName), isSigner: false, isWritable: true },
      { pubkey: params.claimer, isSigner: true, isWritable: true },
      { pubkey: emitter, isSigner: false, isWritable: false },
      { pubkey: deriveWormholeConfigPda(params.wormholeCore), isSigner: false, isWritable: true },
      { pubkey: deriveWormholeFeeCollectorPda(params.wormholeCore), isSigner: false, isWritable: true },
      { pubkey: deriveWormholeSequencePda(params.wormholeCore, emitter), isSigner: false, isWritable: true },
      { pubkey: params.wormholeMessage, isSigner: true, isWritable: true },
      { pubkey: params.wormholeCore, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/**
 * Build the `ons-registration::reconcile` instruction: closes a provisional claim
 * against the mirror state (confirmed / lost / expired); rent refunds to the claimer.
 * Permissionless — any `payer` may submit.
 */
export function buildOnsReconcileInstruction(params: {
  registrationProgramId: PublicKey;
  mirrorProgramId: PublicKey;
  fullName: string;
  /** The recorded claimer (rent destination). */
  claimer: PublicKey;
  /** The submitting signer. */
  payer: PublicKey;
}): TransactionInstruction {
  const config = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("config")],
    params.registrationProgramId,
  )[0];
  return new TransactionInstruction({
    programId: params.registrationProgramId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: getOnsClaimPda(params.registrationProgramId, params.fullName), isSigner: false, isWritable: true },
      { pubkey: params.claimer, isSigner: false, isWritable: true },
      { pubkey: getOnsMirrorRecordPda(params.mirrorProgramId, params.fullName), isSigner: false, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(concatBytes(ixDiscriminator("reconcile"), onsNameHash(params.fullName))),
  });
}

/** Reconciliation state of a Solana-originated claim (spec/ONS.md §6). */
export type OnsClaimState = "none" | "pending" | "confirmed" | "lost" | "expired";

/** Result of {@link fetchOnsClaimStatus}. */
export interface OnsClaimStatus {
  state: OnsClaimState;
  /** The open provisional claim, when one exists. */
  claim: OnsProvisionalClaim | null;
  /** The mirror record, when one exists (also set for `state: "none"` on taken names). */
  record: OnsMirrorRecord | null;
}

/**
 * Determine a name's claim state by reading the provisional-claim PDA and the mirror
 * record PDA (two account fetches). `pending`/`expired` split on the 24 h window
 * against the local clock. Clients MUST NOT present `pending` names as owned.
 */
export async function fetchOnsClaimStatus(
  connection: Connection,
  registrationProgramId: PublicKey,
  mirrorProgramId: PublicKey,
  fullName: string,
): Promise<OnsClaimStatus> {
  const [claimInfo, record] = await Promise.all([
    connection.getAccountInfo(getOnsClaimPda(registrationProgramId, fullName)),
    fetchOnsMirrorRecord(connection, mirrorProgramId, fullName),
  ]);
  const claim =
    claimInfo && claimInfo.owner.equals(registrationProgramId)
      ? decodeOnsProvisionalClaim(claimInfo.data)
      : null;

  if (!claim) return { state: "none", claim: null, record };
  if (record) {
    const confirmed =
      record.solAuthority != null && record.solAuthority.equals(claim.claimer);
    return { state: confirmed ? "confirmed" : "lost", claim, record };
  }
  const expired = Date.now() / 1000 >= claim.createdAt + ONS_PENDING_WINDOW_SECS;
  return { state: expired ? "expired" : "pending", claim, record: null };
}
