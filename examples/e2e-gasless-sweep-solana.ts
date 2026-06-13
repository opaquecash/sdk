/**
 * Live end-to-end test of the gasless SPL sweep on Solana devnet (spec/relayer-market.md §9.2).
 *
 * A one-time stealth account holds an SPL token but NO SOL. The relayer signs as fee payer while
 * the reconstructed stealth keypair signs the transfer as token authority, so the funds move
 * without the stealth account ever holding SOL.
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   SOLANA_KEYPAIR=~/.config/solana/id.json \
 *     npx tsx examples/e2e-gasless-sweep-solana.ts
 *
 * The keypair funds rent + acts as the relayer/fee payer. Run `npm run build` first.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  deriveStealthSolanaAddressFromStealthPrivKey,
  stealthTokenAccount,
  getStealthTokenBalance,
  buildStealthTokenSweepTransaction,
} from "@opaquecash/stealth-chain-solana";
import { submitSolanaGaslessSweep } from "@opaquecash/relayer-client";

const DECIMALS = 6;

function loadKeypair(path: string): Keypair {
  const p = path.startsWith("~") ? path.replace("~", homedir()) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const keypairPath = process.env.SOLANA_KEYPAIR || `${homedir()}/.config/solana/id.json`;
  const connection = new Connection(rpc, "confirmed");
  const relayer = loadKeypair(keypairPath); // fee payer + funder + sweep destination

  // One-time stealth key: a secp256k1 key whose Solana account holds the token but no SOL.
  const stealthPrivKey = secp256k1.utils.randomPrivateKey();
  const stealthOwner = new PublicKey(deriveStealthSolanaAddressFromStealthPrivKey(stealthPrivKey));
  const value = 1n * 10n ** BigInt(DECIMALS);

  console.log("relayer/payer:", relayer.publicKey.toBase58());
  console.log("stealth owner:", stealthOwner.toBase58(), "(will hold token, no SOL)");

  // 1. Create an SPL mint and fund the stealth account's ATA (relayer pays rent + mints).
  const mint = await createMint(connection, relayer, relayer.publicKey, null, DECIMALS);
  console.log("mint         :", mint.toBase58());
  const stealthAta = await getOrCreateAssociatedTokenAccount(connection, relayer, mint, stealthOwner, true);
  await mintTo(connection, relayer, mint, stealthAta.address, relayer, value);

  const ownerSol = await connection.getBalance(stealthOwner);
  const ataBal = await getStealthTokenBalance(connection, { owner: stealthOwner, mint });
  console.log(`stealth token balance: ${ataBal} (raw); stealth SOL balance: ${ownerSol} lamports`);
  if (ownerSol !== 0) throw new Error("stealth account unexpectedly holds SOL");

  // 2. Build the sweep with the relayer as fee payer; stealth keypair signs as authority.
  const plan = await buildStealthTokenSweepTransaction(connection, {
    stealthPrivKey,
    mint,
    destinationOwner: relayer.publicKey,
    feePayer: relayer.publicKey,
    decimals: DECIMALS,
    closeAccount: true, // reclaim the stealth ATA rent to the fee payer
  });
  plan.transaction.partialSign(plan.stealthKeypair);
  const base64 = plan.transaction.serialize({ requireAllSignatures: false }).toString("base64");

  // 3. Relayer co-signs as fee payer and submits.
  const sig = await submitSolanaGaslessSweep(connection, base64, relayer);
  console.log("sweep sig    :", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  // 4. Assert: stealth ATA emptied; destination received the tokens.
  const stealthAfter = await getStealthTokenBalance(connection, { owner: stealthOwner, mint });
  const destAta = stealthTokenAccount({ owner: relayer.publicKey, mint });
  const destBal = (await getAccount(connection, destAta)).amount;
  console.log(`stealth token after: ${stealthAfter} (expect 0)`);
  console.log(`destination balance: ${destBal} (expect ${value})`);
  if (stealthAfter !== 0n) throw new Error("FAIL: stealth account still holds tokens");
  if (destBal < value) throw new Error(`FAIL: destination expected >= ${value}, got ${destBal}`);
  console.log("\nPASS: gasless SPL sweep settled on devnet (stealth account held no SOL).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
