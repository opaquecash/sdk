// Close the loop: fresh V2 proof from the new psr-prover pipeline →
// register its dev root → submit through the SDK's Solana path → devnet.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateReputationProof } from "./packages/psr-prover/dist/index.js";
import { submitReputationProof } from "./packages/psr-chain-solana/dist/index.js";

const GROTH16 = new PublicKey("6mFaKyp7F4NqNeoiBLEWSqy5wJSk7rWf1EYumVXgHvhQ");
const REP = new PublicKey("BSnkCDoTpgNVN5BbF3aN5L5EJPiaYUkqqj9MHp8kaqWM");

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")))
);
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

// 1. Fresh proof from the new pipeline (unique externalNullifier per run via slot)
const slot = await conn.getSlot();
const externalNullifier = String(1_000_000n + BigInt(slot));
console.log("external_nullifier:", externalNullifier);

const proofData = await generateReputationProof({
  trait: { attestationId: 42, stealthAddress: "0x" + "ab".repeat(20), txHash: "0x0", blockNumber: 1, discoveredAt: 0 },
  stealthPrivKeyBytes: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
  externalNullifier,
  artifacts: {
    wasmPath: "../app/public/circuits/v2/stealth_reputation.wasm",
    zkeyPath: "../app/public/circuits/v2/stealth_reputation_final.zkey",
  },
});
console.log("proof generated; signals:", proofData.publicSignals.length, "| root:", proofData.publicSignals[0].slice(0, 16) + "…");

// 2. Register the dev root (admin)
const be32 = (dec) => { let n = BigInt(dec); const out = Buffer.alloc(32); for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; };
const rootBytes = be32(proofData.publicSignals[0]);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, REP)[0];
const disc = (n) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
  programId: REP,
  keys: [
    { pubkey: pda([Buffer.from("verifier_config")]), isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("merkle_root"), rootBytes]), isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("root_history")]), isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([disc("update_merkle_root"), rootBytes]),
})), [payer]);
console.log("dev root registered");

// 3. Submit through the SDK path (validates discriminator + arg plumbing)
const sig = await submitReputationProof(conn, {
  reputationProgramId: REP,
  groth16ProgramId: GROTH16,
  proof: proofData.proof,
  merkleRoot: proofData.publicSignals[0],
  nullifier: proofData.nullifier,
  externalNullifier,
  attestationId: proofData.attestationId,
  publicKey: payer.publicKey,
  signTransaction: async (tx) => { tx.partialSign(payer); return tx; },
});
console.log("VERIFIED ON DEVNET via SDK:", sig);
