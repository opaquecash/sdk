import { describe, it, expect, beforeAll } from "vitest";
import {
  buildPoolCrypto,
  PoolMerkleTree,
  type PoolCrypto,
  orderDeposits,
  aspRootOf,
  verifyAspRoot,
  aspIndexOf,
  reconstructAspSetFromDeposits,
  ipfsPathFromInput,
  fetchAspManifestFromIpfs,
  resolveAspSetViaEns,
  aspSetFromManifest,
  ASP_SET_RECORD_KEY,
  type AspDeposit,
  type AspManifest,
} from "@opaquecash/privacy-pool";

let crypto: PoolCrypto;
beforeAll(async () => {
  crypto = await buildPoolCrypto();
});

const deposits: AspDeposit[] = [
  { label: 111n, leafIndex: 0 },
  { label: 222n, leafIndex: 1 },
  { label: 333n, leafIndex: 2 },
];

describe("orderDeposits", () => {
  it("sorts by leafIndex and dedups, regardless of input order", () => {
    const ordered = orderDeposits([
      { label: 333n, leafIndex: 2 },
      { label: 111n, leafIndex: 0 },
      { label: 222n, leafIndex: 1 },
      { label: 999n, leafIndex: 1 }, // duplicate leafIndex -> first wins
    ]);
    expect(ordered.map((d) => d.leafIndex)).toEqual([0, 1, 2]);
    expect(ordered.map((d) => d.label)).toEqual([111n, 222n, 333n]);
  });
});

describe("reconstructAspSetFromDeposits", () => {
  it("recovers the full set when the on-chain root covers all deposits", () => {
    const root = new PoolMerkleTree(crypto, [111n, 222n, 333n]).root();
    const set = reconstructAspSetFromDeposits(crypto, deposits, root);
    expect(set).not.toBeNull();
    expect(set!.aspLeaves).toEqual([111n, 222n, 333n]);
    expect(set!.root).toBe(root);
  });

  it("recovers the matching prefix when the root excludes the most-recent deposits", () => {
    // ASP posted a root covering only the first two deposits (finality buffer).
    const root = new PoolMerkleTree(crypto, [111n, 222n]).root();
    const set = reconstructAspSetFromDeposits(crypto, deposits, root);
    expect(set!.aspLeaves).toEqual([111n, 222n]);
    // A withdrawer at leafIndex 2 is not yet in the set -> must wait for the next post.
    expect(aspIndexOf(set!.aspLeaves, 333n)).toBe(-1);
    expect(aspIndexOf(set!.aspLeaves, 222n)).toBe(1);
  });

  it("returns null when no prefix matches (root unknown / selective policy)", () => {
    expect(reconstructAspSetFromDeposits(crypto, deposits, 123456789n)).toBeNull();
  });

  it("handles the empty set (root === all-zero-leaf tree root)", () => {
    const empty = new PoolMerkleTree(crypto, []).root();
    const set = reconstructAspSetFromDeposits(crypto, deposits, empty);
    expect(set!.aspLeaves).toEqual([]);
  });
});

describe("verifyAspRoot / aspRootOf", () => {
  it("verifies labels against an on-chain root and rejects mismatches", () => {
    const root = aspRootOf(crypto, [111n, 222n, 333n]);
    expect(verifyAspRoot(crypto, [111n, 222n, 333n], root)).toBe(true);
    expect(verifyAspRoot(crypto, [111n, 222n], root)).toBe(false);
    expect(verifyAspRoot(crypto, [333n, 222n, 111n], root)).toBe(false); // order matters
  });
});

describe("ipfsPathFromInput", () => {
  it("parses ipfs:// URIs, /ipfs/ paths, and bare CIDs; rejects junk", () => {
    const cidV0 = "Qm".padEnd(46, "a");
    expect(ipfsPathFromInput(`ipfs://${cidV0}`)).toBe(cidV0);
    expect(ipfsPathFromInput(`/ipfs/${cidV0}`)).toBe(cidV0);
    expect(ipfsPathFromInput(cidV0)).toBe(cidV0);
    expect(ipfsPathFromInput("https://example.com/x")).toBeNull();
    expect(ipfsPathFromInput("not-a-cid")).toBeNull();
  });
});

describe("manifest resolution (ENS text record -> IPFS), self-authenticating", () => {
  const cid = "QmManifest".padEnd(46, "a");
  const manifest: AspManifest = {
    poolId: "evm:11155111",
    root: "0", // set to the real root inside the test, once `crypto` is built
    version: 1,
    algo: "poseidon-bn254",
    levels: 20,
    labels: ["111", "222"],
    generatedAt: "2026-06-14T00:00:00.000Z",
  };

  function transports(record: string | null) {
    return {
      ensGetText: async (_name: string, key: string) => (key === ASP_SET_RECORD_KEY ? record : null),
      fetchFn: (async (url: string) => {
        if (url.includes(cid)) return { ok: true, json: async () => manifest } as Response;
        return { ok: false, status: 404 } as Response;
      }) as unknown as typeof fetch,
      ipfsGateways: ["https://gw.test"],
    };
  }

  it("resolves a manifest via ENS -> IPFS and verifies it against the on-chain root", async () => {
    const onchain = aspRootOf(crypto, [111n, 222n]);
    manifest.root = onchain.toString();

    const fetched = await resolveAspSetViaEns("asp.opqtest.eth", transports(`ipfs://${cid}`));
    const set = aspSetFromManifest(crypto, fetched, onchain);
    expect(set.aspLeaves).toEqual([111n, 222n]);
    expect(aspIndexOf(set.aspLeaves, 222n)).toBe(1);
  });

  it("rejects a manifest whose labels do not match the on-chain root", async () => {
    const wrongRoot = aspRootOf(crypto, [111n, 222n, 333n]); // chain has 3, manifest lists 2
    const fetched = await resolveAspSetViaEns("asp.opqtest.eth", transports(`ipfs://${cid}`));
    expect(() => aspSetFromManifest(crypto, fetched, wrongRoot)).toThrow(/does not match/);
  });

  it("throws when the ENS record is unset", async () => {
    await expect(resolveAspSetViaEns("asp.opqtest.eth", transports(null))).rejects.toThrow(/no com\.opaque\.aspset/);
  });

  it("fetchAspManifestFromIpfs surfaces gateway failures", async () => {
    await expect(
      fetchAspManifestFromIpfs("QmMissing".padEnd(46, "b"), transports(null)),
    ).rejects.toThrow(/failed to fetch/);
  });
});
