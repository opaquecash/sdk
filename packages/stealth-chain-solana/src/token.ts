/**
 * SPL token support for one-time stealth accounts: associated-token-account (ATA) derivation,
 * transfer-instruction builders for sends, and a full-balance token sweep.
 *
 * Stealth funds on Solana live at a deterministic ed25519 account (see {@link ./stealth.js}); its
 * token balance is held in the ATA owned by that account. The recipient reconstructs the stealth
 * keypair and signs the transfer as the token-account authority. A sweep may name a separate
 * `feePayer` so a relayer can pay the network fee while the stealth key only authorizes the move
 * (gasless sweep); when `feePayer` is omitted the stealth account pays its own fee.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Finality,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { deriveStealthSolanaKeypairFromStealthPrivKey } from "./stealth.js";

function toPubkey(v: PublicKey | string): PublicKey {
  return typeof v === "string" ? new PublicKey(v.trim()) : v;
}

/** The associated token account holding `owner`'s balance of `mint`. */
export function stealthTokenAccount(params: {
  owner: PublicKey | string;
  mint: PublicKey | string;
  tokenProgramId?: PublicKey;
}): PublicKey {
  return getAssociatedTokenAddressSync(
    toPubkey(params.mint),
    toPubkey(params.owner),
    true,
    params.tokenProgramId ?? TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/**
 * Read the SPL token balance (raw units) held by `owner` for `mint`. Returns `0n` when the
 * associated token account does not exist yet.
 */
export async function getStealthTokenBalance(
  connection: Connection,
  params: {
    owner: PublicKey | string;
    mint: PublicKey | string;
    tokenProgramId?: PublicKey;
    commitment?: Finality;
  },
): Promise<bigint> {
  const ata = stealthTokenAccount(params);
  try {
    const account = await getAccount(
      connection,
      ata,
      params.commitment,
      params.tokenProgramId ?? TOKEN_PROGRAM_ID,
    );
    return account.amount;
  } catch {
    return 0n;
  }
}

/**
 * Build the instructions to transfer `amount` (raw units) of `mint` to `destinationOwner`,
 * creating the destination ATA idempotently (paid by `payer`). Used by both stealth sends and
 * the sweep path. `decimals` must match the mint (use {@link resolveMintDecimals} if unknown).
 */
export function buildSplTransferInstructions(params: {
  payer: PublicKey;
  sourceOwner: PublicKey;
  destinationOwner: PublicKey | string;
  mint: PublicKey | string;
  amount: bigint;
  decimals: number;
  tokenProgramId?: PublicKey;
}): TransactionInstruction[] {
  const tokenProgramId = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const mint = toPubkey(params.mint);
  const destinationOwner = toPubkey(params.destinationOwner);
  const source = getAssociatedTokenAddressSync(
    mint,
    params.sourceOwner,
    true,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const destination = getAssociatedTokenAddressSync(
    mint,
    destinationOwner,
    true,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      params.payer,
      destination,
      destinationOwner,
      mint,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      source,
      mint,
      destination,
      params.sourceOwner,
      params.amount,
      params.decimals,
      [],
      tokenProgramId,
    ),
  ];
}

/** Read a mint's `decimals`. */
export async function resolveMintDecimals(
  connection: Connection,
  mint: PublicKey | string,
  tokenProgramId?: PublicKey,
): Promise<number> {
  const info = await getMint(
    connection,
    toPubkey(mint),
    undefined,
    tokenProgramId ?? TOKEN_PROGRAM_ID,
  );
  return info.decimals;
}

/** A prepared full-balance token sweep (transaction not yet signed/sent). */
export interface StealthTokenSweepPlan {
  transaction: Transaction;
  stealthKeypair: Keypair;
  feePayer: PublicKey;
  mint: PublicKey;
  destinationOwner: PublicKey;
  amount: bigint;
}

/**
 * Build a full-balance SPL sweep transaction from the stealth account's ATA to
 * `destinationOwner`'s ATA, signed (as authority) by the reconstructed stealth keypair.
 *
 * When `feePayer` is supplied and differs from the stealth account, that account pays the network
 * fee (gasless sweep: the relayer co-signs as fee payer); otherwise the stealth account pays. With
 * `closeAccount`, the now-empty source ATA is closed and its rent returned to the fee payer.
 */
export async function buildStealthTokenSweepTransaction(
  connection: Connection,
  params: {
    stealthPrivKey: Uint8Array;
    mint: PublicKey | string;
    destinationOwner: PublicKey | string;
    feePayer?: PublicKey | string;
    decimals?: number;
    closeAccount?: boolean;
    tokenProgramId?: PublicKey;
    commitment?: Finality;
  },
): Promise<StealthTokenSweepPlan> {
  const commitment: Finality = params.commitment ?? "confirmed";
  const tokenProgramId = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const stealthKeypair = deriveStealthSolanaKeypairFromStealthPrivKey(params.stealthPrivKey);
  const owner = stealthKeypair.publicKey;
  const feePayer = params.feePayer ? toPubkey(params.feePayer) : owner;
  const mint = toPubkey(params.mint);
  const destinationOwner = toPubkey(params.destinationOwner);

  const amount = await getStealthTokenBalance(connection, {
    owner,
    mint,
    tokenProgramId,
    commitment,
  });
  if (amount <= 0n) {
    throw new Error("Stealth account holds none of this token.");
  }
  const decimals =
    params.decimals ?? (await resolveMintDecimals(connection, mint, tokenProgramId));

  const instructions = buildSplTransferInstructions({
    payer: feePayer,
    sourceOwner: owner,
    destinationOwner,
    mint,
    amount,
    decimals,
    tokenProgramId,
  });

  if (params.closeAccount) {
    const source = getAssociatedTokenAddressSync(
      mint,
      owner,
      true,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    instructions.push(
      createCloseAccountInstruction(source, feePayer, owner, [], tokenProgramId),
    );
  }

  const { blockhash } = await connection.getLatestBlockhash(commitment);
  const transaction = new Transaction({ feePayer, recentBlockhash: blockhash }).add(
    ...instructions,
  );

  return { transaction, stealthKeypair, feePayer, mint, destinationOwner, amount };
}

/**
 * Sweep the full SPL balance of a stealth account to `destinationOwner`, with the stealth account
 * also paying the network fee. For a relayer-sponsored (gasless) sweep, use
 * {@link buildStealthTokenSweepTransaction} with a separate `feePayer`, have the relayer add its
 * signature as fee payer, and submit.
 */
export async function sweepStealthToken(
  connection: Connection,
  params: {
    stealthPrivKey: Uint8Array;
    mint: PublicKey | string;
    destinationOwner: PublicKey | string;
    decimals?: number;
    closeAccount?: boolean;
    tokenProgramId?: PublicKey;
    commitment?: Finality;
  },
): Promise<{ signature: string; amount: bigint }> {
  const plan = await buildStealthTokenSweepTransaction(connection, params);
  const signature = await sendAndConfirmTransaction(
    connection,
    plan.transaction,
    [plan.stealthKeypair],
    { commitment: params.commitment ?? "confirmed" },
  );
  return { signature, amount: plan.amount };
}
