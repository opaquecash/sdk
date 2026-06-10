/**
 * `StealthAddressAnnouncer::announce_with_relay` (Solana) — cross-chain announcements over the
 * Universal Announcement Bus. Emits the local `Announcement` AND publishes the 96-byte cross-chain
 * payload (`spec/payload-format.md`) through the Wormhole Core Bridge via CPI.
 *
 * The Solana counterpart to `@opaquecash/uab`'s EVM `announceWithRelay`. Unlike the EVM path there
 * is no `consistencyLevel` arg; the program takes a Wormhole `batch_id` (nonce) and the current
 * `wormhole_fee` (lamports; 0 on devnet). The `wormhole_message` account is a fresh signer the
 * caller must co-sign with — use {@link buildAnnounceWithRelay} to mint one alongside the
 * instruction.
 *
 * Account order (IDL-authoritative, `solana/target/idl/stealth_announcer.json`):
 * `caller(s,w)`, `wormhole_emitter` (PDA `["emitter"]` of the announcer), `wormhole_config`
 * (PDA `["Bridge"]` of the core), `wormhole_fee_collector` (PDA `["fee_collector"]`),
 * `wormhole_sequence` (PDA `["Sequence", emitter]`), `wormhole_message(s,w)`, `wormhole_program`,
 * clock, rent, system_program.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { concatBytes, u32le, u64le, vecU8 } from "./bytes.js";
import { ANNOUNCE_WITH_RELAY_DISCRIMINATOR, SCHEME_ID_SECP256K1 } from "./programs.js";

const EMITTER_SEED = new TextEncoder().encode("emitter");
const BRIDGE_SEED = new TextEncoder().encode("Bridge");
const FEE_COLLECTOR_SEED = new TextEncoder().encode("fee_collector");
const SEQUENCE_SEED = new TextEncoder().encode("Sequence");

/**
 * Byte offset of the `fee` (u64 LE) field inside the Wormhole Core Bridge config ("Bridge" PDA)
 * account. The core bridge is a native (non-Anchor) program, so there is no 8-byte discriminator:
 * `guardian_set_index: u32 (4) || last_lamports: u64 (8) || guardian_set_expiration_time: u32 (4)`
 * precede `fee: u64`, putting it at offset 16.
 */
const WORMHOLE_FEE_OFFSET = 16;

/** Derive this announcer program's Wormhole emitter PDA (`["emitter"]`). */
export function deriveWormholeEmitterPda(announcerProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([EMITTER_SEED], announcerProgramId)[0];
}

/** Derive the Wormhole Core Bridge config PDA (`["Bridge"]`). */
export function deriveWormholeConfigPda(wormholeCore: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([BRIDGE_SEED], wormholeCore)[0];
}

/** Derive the Wormhole Core Bridge fee-collector PDA (`["fee_collector"]`). */
export function deriveWormholeFeeCollectorPda(wormholeCore: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([FEE_COLLECTOR_SEED], wormholeCore)[0];
}

/** Derive the per-emitter Wormhole sequence PDA (`["Sequence", emitter]`). */
export function deriveWormholeSequencePda(
  wormholeCore: PublicKey,
  emitter: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEQUENCE_SEED, emitter.toBuffer()],
    wormholeCore,
  )[0];
}

/**
 * Read the current Wormhole message fee (lamports) from the core bridge config account. Returns
 * `0n` when the account is missing or too short (devnet charges no fee). Pass the result as
 * {@link AnnounceWithRelayInstructionParams.wormholeFee}.
 */
export async function fetchWormholeMessageFee(
  connection: Connection,
  wormholeCore: PublicKey,
): Promise<bigint> {
  const config = deriveWormholeConfigPda(wormholeCore);
  const info = await connection.getAccountInfo(config);
  const data = info?.data;
  if (!data || data.length < WORMHOLE_FEE_OFFSET + 8) return 0n;
  return new DataView(data.buffer, data.byteOffset + WORMHOLE_FEE_OFFSET, 8).getBigUint64(
    0,
    true,
  );
}

/** Parameters for {@link buildAnnounceWithRelayInstruction}. */
export interface AnnounceWithRelayInstructionParams {
  announcerProgramId: PublicKey;
  /** Wormhole Core Bridge program id (from the {@link import("./programs.js").SolanaDeployment}). */
  wormholeCore: PublicKey;
  /** Signs and pays; on-chain `caller` of the announcement. */
  caller: PublicKey;
  /** Fresh ephemeral message account (signer + writable); use {@link buildAnnounceWithRelay} to mint. */
  wormholeMessage: PublicKey;
  /** Stealth address bytes (1..=32; Opaque uses the 20-byte EVM-style address). */
  stealthAddress: Uint8Array;
  /** 33-byte compressed secp256k1 ephemeral public key. */
  ephemeralPubKey: Uint8Array;
  /** Metadata; `metadata[0]` MUST be the view tag (<= 24 bytes for the cross-chain budget). */
  metadata: Uint8Array;
  schemeId?: bigint;
  /** Wormhole nonce / batch id (default 0). */
  batchId?: number;
  /** Wormhole message fee in lamports (default 0; devnet is 0). See {@link fetchWormholeMessageFee}. */
  wormholeFee?: bigint;
}

/**
 * Build an `announce_with_relay` instruction. The `caller` AND the `wormholeMessage` account must
 * both sign the transaction (the message account is consumed by the core bridge `post_message`
 * CPI). Prefer {@link buildAnnounceWithRelay}, which mints the message keypair for you.
 */
export function buildAnnounceWithRelayInstruction(
  params: AnnounceWithRelayInstructionParams,
): TransactionInstruction {
  const schemeId = params.schemeId ?? SCHEME_ID_SECP256K1;
  const emitter = deriveWormholeEmitterPda(params.announcerProgramId);
  const config = deriveWormholeConfigPda(params.wormholeCore);
  const feeCollector = deriveWormholeFeeCollectorPda(params.wormholeCore);
  const sequence = deriveWormholeSequencePda(params.wormholeCore, emitter);

  const data = concatBytes(
    ANNOUNCE_WITH_RELAY_DISCRIMINATOR,
    u64le(schemeId),
    vecU8(params.stealthAddress),
    vecU8(params.ephemeralPubKey),
    vecU8(params.metadata),
    u32le(params.batchId ?? 0),
    u64le(params.wormholeFee ?? 0n),
  );

  return new TransactionInstruction({
    programId: params.announcerProgramId,
    keys: [
      { pubkey: params.caller, isSigner: true, isWritable: true },
      { pubkey: emitter, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: feeCollector, isSigner: false, isWritable: true },
      { pubkey: sequence, isSigner: false, isWritable: true },
      { pubkey: params.wormholeMessage, isSigner: true, isWritable: true },
      { pubkey: params.wormholeCore, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/** An `announce_with_relay` instruction plus the ephemeral message keypair that must co-sign. */
export interface AnnounceWithRelayBuild {
  instruction: TransactionInstruction;
  /** Fresh Wormhole message account; add to the transaction's signers alongside the caller. */
  messageKeypair: Keypair;
}

/**
 * Mint a fresh Wormhole message keypair and build the `announce_with_relay` instruction against it.
 * The returned `messageKeypair` MUST be included as an additional signer when sending the tx.
 */
export function buildAnnounceWithRelay(
  params: Omit<AnnounceWithRelayInstructionParams, "wormholeMessage">,
): AnnounceWithRelayBuild {
  const messageKeypair = Keypair.generate();
  const instruction = buildAnnounceWithRelayInstruction({
    ...params,
    wormholeMessage: messageKeypair.publicKey,
  });
  return { instruction, messageKeypair };
}
