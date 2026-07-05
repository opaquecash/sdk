/**
 * Sweep native SOL out of a one-time stealth account. The stealth account signs and pays its own
 * fee, so the on-chain `from` is the stealth address itself (preserving unlinkability). The account
 * is controlled by a raw ed25519 scalar, so it signs via {@link StealthSolanaSigner} rather than a
 * `Keypair`. Ported from `solana/frontend/src/lib/stealthLifecycle.ts`.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type Finality,
} from "@solana/web3.js";
import type { StealthSolanaSigner } from "./stealth.js";
import { signAndSendStealth } from "./sign.js";

/** Fallback per-signature fee (lamports) if `getFeeForMessage` returns null. */
const DEFAULT_FEE_LAMPORTS = 5000;

/** A prepared full-balance sweep (transaction not yet signed/sent). */
export interface StealthSweepPlan {
  transaction: Transaction;
  fromPubkey: PublicKey;
  destination: PublicKey;
  balanceLamports: bigint;
  feeLamports: bigint;
  sweepLamports: bigint;
  /** Block height after which `transaction.recentBlockhash` expires (for confirmation). */
  lastValidBlockHeight: number;
}

function toPubkey(v: PublicKey | string): PublicKey {
  return typeof v === "string" ? new PublicKey(v.trim()) : v;
}

/**
 * Build a full-balance sweep transaction: balance minus the network fee, transferred to
 * `destination`. Reads balance, blockhash, and the exact fee from the RPC.
 */
export async function buildStealthSweepTransaction(
  connection: Connection,
  params: {
    /** Signer for the one-time stealth account (from {@link stealthSolanaSigner}). */
    signer: StealthSolanaSigner;
    destination: PublicKey | string;
    commitment?: Finality;
  },
): Promise<StealthSweepPlan> {
  const commitment: Finality = params.commitment ?? "confirmed";
  const fromPubkey = params.signer.publicKey;
  const destination = toPubkey(params.destination);

  const balanceLamports = BigInt(await connection.getBalance(fromPubkey, commitment));
  if (balanceLamports <= 0n) {
    throw new Error("Stealth address has zero balance.");
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);
  const probe = new Transaction({ feePayer: fromPubkey, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey, toPubkey: destination, lamports: 1 }),
  );
  const feeResult = await connection.getFeeForMessage(probe.compileMessage(), commitment);
  const feeLamports = BigInt(feeResult.value ?? DEFAULT_FEE_LAMPORTS);

  if (balanceLamports <= feeLamports) {
    throw new Error(
      `Insufficient balance to cover network fee (balance ${balanceLamports}, fee ${feeLamports} lamports).`,
    );
  }
  const sweepLamports = balanceLamports - feeLamports;
  if (sweepLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Sweep amount too large to encode as JS-number lamports.");
  }

  const transaction = new Transaction({
    feePayer: fromPubkey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: destination,
      lamports: Number(sweepLamports),
    }),
  );

  return {
    transaction,
    fromPubkey,
    destination,
    balanceLamports,
    feeLamports,
    sweepLamports,
    lastValidBlockHeight,
  };
}

/**
 * Sweep the full SOL balance of a stealth account to `destination`, signed by the stealth account.
 * Returns the confirmed signature plus the swept/fee amounts.
 */
export async function sweepStealthSol(
  connection: Connection,
  params: {
    signer: StealthSolanaSigner;
    destination: PublicKey | string;
    commitment?: Finality;
  },
): Promise<{ signature: string; sweepLamports: bigint; feeLamports: bigint }> {
  const plan = await buildStealthSweepTransaction(connection, params);
  const signature = await signAndSendStealth(connection, plan.transaction, params.signer, {
    commitment: params.commitment ?? "confirmed",
    lastValidBlockHeight: plan.lastValidBlockHeight,
  });
  return {
    signature,
    sweepLamports: plan.sweepLamports,
    feeLamports: plan.feeLamports,
  };
}
