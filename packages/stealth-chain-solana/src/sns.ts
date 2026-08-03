/**
 * SNS (Solana Name Service) reads for ONS resolution path 3 (spec/ONS.md §7): an
 * existing `.sol` domain publishes its CSAP meta-address in an SNS **Records V2**
 * TXT record (CSAP §2.9 — the value is the `st:opq:`-prefixed / raw-hex 66-byte
 * serialisation, self-describing so it coexists with other TXT uses).
 */

import { Connection } from "@solana/web3.js";

// @bonfida/spl-name-service is an OPTIONAL peer, loaded lazily and untyped:
//  - the package was removed from the npm registry (2026-08), so a hard
//    dependency made every fresh install of this SDK fail — consumers who
//    need `.sol` resolution install a copy themselves (registry mirror,
//    vendored tarball, or Bonfida's repo) and everything else works without;
//  - its ESM declaration files use extensionless relative imports, which NodeNext
//    resolution rejects (TypeScript would see an empty module);
//  - its ESM runtime build assumes a bundler-provided `buffer` shim and crashes at
//    evaluation under plain Node — bundlers (vite etc.) load it fine, Node falls
//    back to the working CJS build via `createRequire`.
// The specifier is a variable with bundler-ignore hints so vite/rollup/webpack
// never try to resolve a module that may legitimately be absent.
interface BonfidaRecordsV2 {
  Record: { TXT: string };
  getRecordV2: (
    connection: Connection,
    domain: string,
    record: string,
  ) => Promise<{ retrievedRecord: { getContent(): Uint8Array } }>;
  deserializeRecordV2Content: (content: Uint8Array, record: string) => string;
}

const BONFIDA_PACKAGE = "@bonfida/spl-name-service";

let bonfidaPromise: Promise<BonfidaRecordsV2> | undefined;

function loadBonfida(): Promise<BonfidaRecordsV2> {
  bonfidaPromise ??= import(/* @vite-ignore */ /* webpackIgnore: true */ BONFIDA_PACKAGE)
    .then((m) => m as unknown as BonfidaRecordsV2)
    .catch(async () => {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      return require(BONFIDA_PACKAGE) as BonfidaRecordsV2;
    })
    .catch((cause: unknown) => {
      bonfidaPromise = undefined; // a later install/retry should be able to succeed
      throw new Error(
        `SNS .sol resolution needs the optional peer ${BONFIDA_PACKAGE}, which is not installed ` +
          "(it was removed from the npm registry; install it from a mirror or vendored tarball). " +
          "Every other SDK feature works without it.",
        { cause },
      );
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
