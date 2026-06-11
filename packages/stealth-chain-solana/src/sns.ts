/**
 * SNS (Solana Name Service) reads for ONS resolution path 3 (spec/ONS.md §7): an
 * existing `.sol` domain publishes its CSAP meta-address in an SNS **Records V2**
 * TXT record (CSAP §2.9 — the value is the `st:opq:`-prefixed / raw-hex 66-byte
 * serialisation, self-describing so it coexists with other TXT uses).
 */

import { Connection } from "@solana/web3.js";

// @bonfida/spl-name-service is loaded lazily and untyped:
//  - its ESM declaration files use extensionless relative imports, which NodeNext
//    resolution rejects (TypeScript would see an empty module);
//  - its ESM runtime build assumes a bundler-provided `buffer` shim and crashes at
//    evaluation under plain Node — bundlers (vite etc.) load it fine, Node falls
//    back to the working CJS build via `createRequire`.
// Only `.sol` resolution pays this cost; nothing is imported until then.
interface BonfidaRecordsV2 {
  Record: { TXT: string };
  getRecordV2: (
    connection: Connection,
    domain: string,
    record: string,
  ) => Promise<{ retrievedRecord: { getContent(): Uint8Array } }>;
  deserializeRecordV2Content: (content: Uint8Array, record: string) => string;
}

let bonfidaPromise: Promise<BonfidaRecordsV2> | undefined;

function loadBonfida(): Promise<BonfidaRecordsV2> {
  bonfidaPromise ??= import("@bonfida/spl-name-service")
    .then((m) => m as unknown as BonfidaRecordsV2)
    .catch(async () => {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      return require("@bonfida/spl-name-service") as BonfidaRecordsV2;
    });
  return bonfidaPromise;
}

/** Strip a trailing `.sol` and lowercase: `"Bob.sol"` → `"bob"`. */
export function snsDomainName(input: string): string {
  return input.toLowerCase().replace(/\.sol$/, "");
}

/**
 * Read the TXT Records V2 content of a `.sol` domain (`"bob.sol"` or `"bob"`),
 * or `null` when the domain or record does not exist. The caller validates the
 * value as a meta-address (CSAP §2.9 point validation).
 */
export async function fetchSnsTxtRecord(
  connection: Connection,
  domain: string,
): Promise<string | null> {
  const bonfida = await loadBonfida();
  try {
    const res = await bonfida.getRecordV2(connection, snsDomainName(domain), bonfida.Record.TXT);
    const content = res.retrievedRecord.getContent();
    return bonfida.deserializeRecordV2Content(content, bonfida.Record.TXT);
  } catch {
    return null;
  }
}
