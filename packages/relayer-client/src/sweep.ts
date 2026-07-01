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
import type { GatewayOptions } from "./gateway.js";

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

/**
 * Wire shape a client POSTs to a relayer node's `/v1/sweep` endpoint. Structurally matches
 * the result of `OpaqueClient.buildGaslessTokenSweep` (extra fields are ignored), so a client
 * can pass the built sweep straight through.
 */
export type GaslessSweepSubmission =
  | { chain: "ethereum"; to: string; data: string }
  | { chain: "solana"; transactionBase64: string };

/** What one chain of a relayer's `/v1/sweep/info` reports (Wormhole chain id + operator). */
export interface SweepInfoChain {
  chain: number;
  operator: string;
  /** EVM only: the `StealthTokenSweep` forwarder the relayer will call. */
  forwarder?: string | null;
}

/** Narrow a `buildGaslessTokenSweep` result to the minimal `/v1/sweep` request body. */
export function gaslessSweepSubmission(
  sweep:
    | { chain: "ethereum"; to: string; data: string }
    | { chain: "solana"; transactionBase64: string },
): GaslessSweepSubmission {
  return sweep.chain === "ethereum"
    ? { chain: "ethereum", to: sweep.to, data: sweep.data }
    : { chain: "solana", transactionBase64: sweep.transactionBase64 };
}

/**
 * Submit an owner-authorized gasless sweep to a relayer node (spec §9). The relayer fronts
 * the gas and is reimbursed the in-token fee; this returns the on-chain transaction id.
 * Escrow-free — no job, bid, or payload delivery, so it is a single synchronous call.
 */
export async function postGaslessSweep(
  o: GatewayOptions,
  submission: GaslessSweepSubmission,
): Promise<{ tx: string }> {
  const fetchFn = o.fetchFn ?? globalThis.fetch;
  if (!fetchFn) throw new Error("Opaque relayer: no fetch available; pass fetchFn.");
  const res = await fetchFn(`${o.baseUrl.replace(/\/$/, "")}/v1/sweep`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    tx?: string;
    error?: string;
  };
  if (!res.ok || !body.ok || !body.tx) {
    throw new Error(`gateway POST /v1/sweep -> ${res.status}: ${body.error ?? "unknown error"}`);
  }
  return { tx: body.tx };
}

/** Read a relayer's sweep capabilities (per-chain operator + EVM forwarder). */
export async function getSweepInfo(o: GatewayOptions): Promise<{ chains: SweepInfoChain[] }> {
  const fetchFn = o.fetchFn ?? globalThis.fetch;
  if (!fetchFn) throw new Error("Opaque relayer: no fetch available; pass fetchFn.");
  const res = await fetchFn(`${o.baseUrl.replace(/\/$/, "")}/v1/sweep/info`);
  if (!res.ok) throw new Error(`gateway GET /v1/sweep/info -> ${res.status}`);
  return (await res.json()) as { chains: SweepInfoChain[] };
}
