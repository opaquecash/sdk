/**
 * Submit transactions signed by a one-time stealth account. Stealth accounts are controlled by a
 * raw ed25519 scalar (see {@link ./stealth.js}), which a Solana `Keypair` cannot represent, so we
 * sign the compiled message with {@link StealthSolanaSigner} and attach it via
 * `Transaction.addSignature` instead of going through `Transaction.sign`.
 */

import { Connection, Transaction, type Finality } from "@solana/web3.js";
import type { StealthSolanaSigner } from "./stealth.js";

/** Attach the stealth signer's signature to a fully-built transaction (feePayer + blockhash set). */
export function applyStealthSignature(
  transaction: Transaction,
  signer: StealthSolanaSigner,
): void {
  const message = transaction.serializeMessage();
  transaction.addSignature(signer.publicKey, Buffer.from(signer.sign(message)));
}

/**
 * Sign `transaction` with the stealth signer (its sole required signer) and submit it, confirming
 * against the transaction's own blockhash when `lastValidBlockHeight` is supplied.
 */
export async function signAndSendStealth(
  connection: Connection,
  transaction: Transaction,
  signer: StealthSolanaSigner,
  opts: { commitment?: Finality; lastValidBlockHeight?: number } = {},
): Promise<string> {
  const commitment = opts.commitment ?? "confirmed";
  applyStealthSignature(transaction, signer);
  const raw = transaction.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    preflightCommitment: commitment,
  });
  const blockhash = transaction.recentBlockhash;
  if (blockhash && opts.lastValidBlockHeight != null) {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight: opts.lastValidBlockHeight },
      commitment,
    );
  } else {
    await connection.confirmTransaction(signature, commitment);
  }
  return signature;
}
