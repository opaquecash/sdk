/**
 * Phase 2.3 — `resolveRecipient` identity resolution: raw meta-address, ERC-6538
 * registry, Solana registry PDA, `ipfs://` DID document (mocked fetch), and ENS
 * `com.opaque.meta` text record (mocked reader). No network, no WASM.
 */
import { describe, expect, it, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  OpaqueClient,
  extractMetaAddressFromDidDocument,
  ipfsPathFromInput,
  parseMetaAddressValue,
  OPAQUE_META_RECORD_KEY,
} from "@opaquecash/opaque";

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic, point-valid 66-byte meta-address (V‖S). */
function testMetaAddress(seed: number): `0x${string}` {
  const v = new Uint8Array(32).fill(seed);
  const s = new Uint8Array(32).fill(seed + 1);
  const V = secp256k1.getPublicKey(v, true);
  const S = secp256k1.getPublicKey(s, true);
  return `0x${bytesToHex(V)}${bytesToHex(S)}` as `0x${string}`;
}

const META = testMetaAddress(7);
const CID_V0 = "Qm" + "a".repeat(22) + "A".repeat(22);

async function makeClient(extra: Record<string, unknown> = {}): Promise<OpaqueClient> {
  return OpaqueClient.create({
    chainId: 11155111,
    rpcUrl: "http://127.0.0.1:1", // never hit: registry reads are stubbed
    walletSignature: ("0x" + "11".repeat(65)) as `0x${string}`,
    ethereumAddress: "0x1111111111111111111111111111111111111111",
    ...extra,
  });
}

describe("parseMetaAddressValue", () => {
  it("accepts the canonical 0x form and lowercases it", () => {
    expect(parseMetaAddressValue(META.toUpperCase().replace("0X", "0x"))).toBe(META);
  });

  it("accepts the st:opq: self-describing prefix and bare hex", () => {
    expect(parseMetaAddressValue(`st:opq:${META}`)).toBe(META);
    expect(parseMetaAddressValue(META.slice(2))).toBe(META);
  });

  it("rejects values whose halves are not valid curve points", () => {
    const badPrefix = `0x04${META.slice(4)}`; // uncompressed prefix byte
    expect(parseMetaAddressValue(badPrefix)).toBeNull();
    const notAPoint = `0x02${"00".repeat(32)}${META.slice(68)}`;
    expect(parseMetaAddressValue(notAPoint)).toBeNull();
    expect(parseMetaAddressValue("0x1234")).toBeNull();
  });
});

describe("ipfsPathFromInput", () => {
  it("handles ipfs:// URIs, /ipfs/ paths, and bare CIDs (v0 + v1)", () => {
    expect(ipfsPathFromInput(`ipfs://${CID_V0}`)).toBe(CID_V0);
    expect(ipfsPathFromInput(`ipfs://${CID_V0}/did.json`)).toBe(`${CID_V0}/did.json`);
    expect(ipfsPathFromInput(`/ipfs/${CID_V0}`)).toBe(CID_V0);
    expect(ipfsPathFromInput("b" + "a".repeat(58))).toBe("b" + "a".repeat(58));
    expect(ipfsPathFromInput("not-a-cid")).toBeNull();
    expect(ipfsPathFromInput("0x1111111111111111111111111111111111111111")).toBeNull();
  });
});

describe("extractMetaAddressFromDidDocument", () => {
  it("reads a W3C DID service entry", () => {
    const doc = {
      id: "did:ipfs:x",
      service: [
        { id: "#other", type: "Other", serviceEndpoint: "https://x" },
        {
          id: "#opaque",
          type: "OpaqueStealthMetaAddress",
          serviceEndpoint: `st:opq:${META}`,
        },
      ],
    };
    expect(extractMetaAddressFromDidDocument(doc)).toBe(META);
  });

  it("reads top-level com.opaque.meta / opaqueMetaAddress fields", () => {
    expect(extractMetaAddressFromDidDocument({ [OPAQUE_META_RECORD_KEY]: META })).toBe(META);
    expect(extractMetaAddressFromDidDocument({ opaqueMetaAddress: META })).toBe(META);
  });

  it("returns null for documents without a valid meta-address", () => {
    expect(extractMetaAddressFromDidDocument({})).toBeNull();
    expect(extractMetaAddressFromDidDocument({ opaqueMetaAddress: "0xdead" })).toBeNull();
    expect(extractMetaAddressFromDidDocument(null)).toBeNull();
  });
});

describe("OpaqueClient.resolveRecipient", () => {
  it("passes through a raw meta-address (validated)", async () => {
    const client = await makeClient();
    const r = await client.resolveRecipient(`  st:opq:${META} `);
    expect(r).toMatchObject({ metaAddressHex: META, source: "meta-address" });
    await expect(
      client.resolveRecipient(`0x02${"00".repeat(32)}${META.slice(68)}`),
    ).rejects.toThrow(/failed validation/);
  });

  it("resolves a registered EVM address through the ERC-6538 registry", async () => {
    const client = await makeClient();
    (client as unknown as { publicClient: unknown }).publicClient = {
      readContract: async () => META,
    };
    const r = await client.resolveRecipient("0x2222222222222222222222222222222222222222");
    expect(r).toMatchObject({ metaAddressHex: META, source: "evm-registry" });
  });

  it("throws for an unregistered EVM address", async () => {
    const client = await makeClient();
    (client as unknown as { publicClient: unknown }).publicClient = {
      readContract: async () => "0x",
    };
    await expect(
      client.resolveRecipient("0x2222222222222222222222222222222222222222"),
    ).rejects.toThrow(/no registered meta-address on Ethereum/);
  });

  it("resolves a Solana pubkey through the stealth-registry adapter", async () => {
    const client = await makeClient();
    const pubkey = "E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno";
    (client as unknown as { solanaAdapter: unknown }).solanaAdapter = {
      resolveMetaAddress: async (id: string) => (id === pubkey ? META : null),
    };
    const r = await client.resolveRecipient(pubkey);
    expect(r).toMatchObject({ metaAddressHex: META, source: "solana-registry" });
  });

  it("resolves an ipfs:// DID document via the mocked gateway fetch", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(`https://gw.example/ipfs/${CID_V0}`);
      return {
        ok: true,
        json: async () => ({
          service: [
            { type: "OpaqueStealthMetaAddress", serviceEndpoint: META },
          ],
        }),
      };
    });
    const client = await makeClient({
      ipfs: { gateways: ["https://gw.example"], fetch: fetchFn as unknown as typeof fetch },
    });
    const r = await client.resolveRecipient(`ipfs://${CID_V0}`);
    expect(r).toMatchObject({ metaAddressHex: META, source: "ipfs-did" });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("falls back across gateways and surfaces total failure", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://bad.example")) return { ok: false, status: 500 };
      return {
        ok: true,
        json: async () => ({ opaqueMetaAddress: META }),
      };
    });
    const client = await makeClient({
      ipfs: {
        gateways: ["https://bad.example", "https://good.example"],
        fetch: fetchFn as unknown as typeof fetch,
      },
    });
    const r = await client.resolveRecipient(CID_V0);
    expect(r.metaAddressHex).toBe(META);
    expect(calls).toHaveLength(2);

    const allBad = await makeClient({
      ipfs: {
        gateways: ["https://bad.example"],
        fetch: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
      },
    });
    await expect(allBad.resolveRecipient(`ipfs://${CID_V0}`)).rejects.toThrow(
      /failed to fetch DID document/,
    );
  });

  it("resolves *.eth through the com.opaque.meta text record (mocked reader)", async () => {
    const getText = vi.fn(async (name: string, key: string) => {
      expect(name).toBe("alice.opq.eth");
      expect(key).toBe(OPAQUE_META_RECORD_KEY);
      return `st:opq:${META}`;
    });
    const client = await makeClient({ ens: { getText } });
    const r = await client.resolveRecipient("alice.opq.eth");
    expect(r).toMatchObject({ metaAddressHex: META, source: "ens-text" });
  });

  it("throws for unset or invalid ENS records and missing ENS config", async () => {
    const unset = await makeClient({ ens: { getText: async () => null } });
    await expect(unset.resolveRecipient("bob.eth")).rejects.toThrow(/no com\.opaque\.meta/);

    const invalid = await makeClient({ ens: { getText: async () => "0xnope" } });
    await expect(invalid.resolveRecipient("bob.eth")).rejects.toThrow(/not a valid/);

    const noEns = await makeClient();
    await expect(noEns.resolveRecipient("bob.eth")).rejects.toThrow(/ens\.getText/i);
  });

  it("rejects unrecognised inputs", async () => {
    const client = await makeClient();
    await expect(client.resolveRecipient("definitely not an identity!")).rejects.toThrow(
      /unrecognised recipient/,
    );
  });
});
