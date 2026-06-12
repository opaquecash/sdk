/**
 * HTTP gateway client (spec/relayer-market.md §3.4). Any relayer node exposes this
 * intake; a censoring gateway is bypassed by pointing at another node. The gateway
 * re-gossips adverts/payloads and serves the bids it has seen.
 */

import type { Advert, Bid, PayloadEnvelope } from "./job.js";

export interface GatewayOptions {
  /** Base URL of a relayer node's gateway, e.g. `http://localhost:8787`. */
  baseUrl: string;
  /** Fetch implementation (default `globalThis.fetch`). */
  fetchFn?: typeof fetch;
}

function fetchOf(o: GatewayOptions): typeof fetch {
  const f = o.fetchFn ?? globalThis.fetch;
  if (!f) throw new Error("Opaque relayer: no fetch available; pass fetchFn.");
  return f;
}

/** Advertise a funded job to the mesh. */
export async function postAdvert(o: GatewayOptions, advert: Advert): Promise<void> {
  const res = await fetchOf(o)(`${o.baseUrl.replace(/\/$/, "")}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(advert),
  });
  if (!res.ok) throw new Error(`gateway POST /v1/jobs -> ${res.status}`);
}

/** Fetch the bids the gateway has seen for a job. */
export async function getBids(o: GatewayOptions, jobId: string): Promise<Bid[]> {
  const res = await fetchOf(o)(
    `${o.baseUrl.replace(/\/$/, "")}/v1/jobs/${jobId}/bids`,
  );
  if (!res.ok) throw new Error(`gateway GET bids -> ${res.status}`);
  return (await res.json()) as Bid[];
}

/** Deliver the encrypted payload envelope to the winner via the gateway. */
export async function postPayload(o: GatewayOptions, env: PayloadEnvelope): Promise<void> {
  const res = await fetchOf(o)(
    `${o.baseUrl.replace(/\/$/, "")}/v1/jobs/${env.jobId}/payload`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(env),
    },
  );
  if (!res.ok) throw new Error(`gateway POST payload -> ${res.status}`);
}

/** Poll for bids until `minBids` arrive or `timeoutMs` elapses. */
export async function collectBids(
  o: GatewayOptions,
  jobId: string,
  opts: { minBids?: number; timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Bid[]> {
  const minBids = opts.minBids ?? 1;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  let bids: Bid[] = [];
  for (;;) {
    bids = await getBids(o, jobId);
    if (bids.length >= minBids || Date.now() > deadline) return bids;
    await sleep(intervalMs);
  }
}
