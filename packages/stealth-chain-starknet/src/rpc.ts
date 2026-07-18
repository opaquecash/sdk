import { selectorHex } from "./bytearray.js";

/** Minimal Starknet JSON-RPC client (spec 0.10.x), dependency-free. */
export class StarknetRpc {
  constructor(
    private readonly nodeUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, params: unknown): Promise<T> {
    const response = await this.fetchFn(this.nodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    const body = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (body.error) {
      throw new Error(`${method}: ${body.error.message} (${body.error.code})`);
    }
    return body.result as T;
  }

  /** `starknet_call` against `latest`; returns raw result felts as hex. */
  call(
    contractAddress: string,
    entrypoint: string,
    calldata: string[] = [],
  ): Promise<string[]> {
    return this.request("starknet_call", [
      {
        contract_address: contractAddress,
        entry_point_selector: selectorHex(entrypoint),
        calldata,
      },
      "latest",
    ]);
  }

  blockNumber(): Promise<number> {
    return this.request("starknet_blockNumber", []);
  }

  getEvents(filter: {
    address: string;
    keys?: string[][];
    from_block?: { block_number: number };
    to_block?: { block_number: number } | "latest";
    chunk_size: number;
    continuation_token?: string;
  }): Promise<{
    events: StarknetEmittedEvent[];
    continuation_token?: string;
  }> {
    return this.request("starknet_getEvents", [filter]);
  }
}

export interface StarknetEmittedEvent {
  from_address: string;
  keys: string[];
  data: string[];
  block_number?: number;
  transaction_hash: string;
}
