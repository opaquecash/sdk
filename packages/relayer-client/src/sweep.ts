/**
 * Relayer-side submission for gasless token sweeps (spec/relayer-market.md, fee-in-token). The
 * owner (SDK) produces the authorization; the relayer submits it, pays the gas, and is reimbursed
 * the fee in the token. EVM: send the forwarder calldata. Solana: co-sign the partially-signed
 * transaction as fee payer and broadcast.
 */

import {
  Connection,
  Keypair,
  Transaction,
  type Finality,
} from "@solana/web3.js";
import type { EvmTxRequest } from "./escrow.js";

/** Turn an EVM gasless sweep payload into a relayer tx request (the relayer earns the fee). */
export function evmGaslessSweepRequest(sweep: {
  to: `0x${string}`;
  data: `0x${string}`;
}): EvmTxRequest {
  return { to: sweep.to, data: sweep.data, value: 0n };
}

/**
 * Co-sign a Solana gasless sweep as fee payer and broadcast it. The transaction arrives partially
 * signed by the stealth key (the token authority); the relayer adds its fee-payer signature, pays
 * the network fee, and is reimbursed in-token by the sweep's fee transfer.
 */
export async function submitSolanaGaslessSweep(
  connection: Connection,
  transactionBase64: string,
  feePayer: Keypair,
  options?: { commitment?: Finality },
): Promise<string> {
  const tx = Transaction.from(Buffer.from(transactionBase64, "base64"));
  tx.partialSign(feePayer);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, options?.commitment ?? "confirmed");
  return signature;
}
