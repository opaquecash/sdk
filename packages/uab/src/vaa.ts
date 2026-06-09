import { WORMHOLESCAN_TESTNET } from "./config.js";

export interface FetchVaaOptions {
  /** Wormholescan base (defaults to Testnet). */
  baseUrl?: string;
  /** Max time to poll for the guardian VAA. Default 20 min. */
  timeoutMs?: number;
  /** Poll interval. Default 5s. */
  intervalMs?: number;
}

/**
 * Poll Wormholescan for the signed VAA of a published message.
 * `emitterHex` is the 32-byte Wormhole emitter address (with or without `0x`).
 */
export async function fetchVaa(
  whChain: number,
  emitterHex: string,
  sequence: bigint,
  opts: FetchVaaOptions = {},
): Promise<Uint8Array> {
  const base = opts.baseUrl ?? WORMHOLESCAN_TESTNET;
  const emitter = emitterHex.replace(/^0x/, "").toLowerCase();
  const url = `${base}/api/v1/vaas/${whChain}/${emitter}/${sequence.toString()}`;
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { data?: { vaa?: string } };
        if (body?.data?.vaa) return base64ToBytes(body.data.vaa);
      }
    } catch {
      /* transient; retry */
    }
    if (Date.now() > deadline) throw new Error(`VAA not available within timeout: ${url}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function base64ToBytes(b64: string): Uint8Array {
  // `atob` is a global in browsers and Node >= 18, keeping this package free of Node typings.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
