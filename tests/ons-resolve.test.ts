/**
 * Phase 4.3 — ONS resolution (spec/ONS.md §7): mirror-PDA decode + derivation,
 * `resolveRecipient` mirror-first path with canonical-registry fallback, and the
 * `.sol` SNS record path. No network: the Solana connection and the EVM
 * `readContract` are stubbed; PDA derivations are cross-checked against the live
 * devnet records created in the Phase 4 e2e run.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { PublicKey } from "@solana/web3.js";
import {
  OpaqueClient,
  isOnsNameInput,
  isSnsNameInput,
} from "@opaquecash/opaque";
import {
  decodeOnsMirrorRecord,
  fetchOnsClaimStatus,
  getOnsClaimPda,
  getOnsMirrorRecordPda,
  onsNameHash,
} from "@opaquecash/stealth-chain-solana";
import { ONS_DEPLOYMENTS, requireSolanaProgramIds } from "@opaquecash/deployments";

const MIRROR_PROGRAM = new PublicKey(requireSolanaProgramIds("devnet").onsMirror);
const REGISTRATION_PROGRAM = new PublicKey(
  requireSolanaProgramIds("devnet").onsRegistration,
);
const PARENT = ONS_DEPLOYMENTS[11155111]!.parentName; // "opqtest.eth"

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

// Point-valid halves (CSAP: meta-address is V‖S, viewing first).
const VIEW = secp256k1.getPublicKey(new Uint8Array(32).fill(5), true);
const SPEND = secp256k1.getPublicKey(new Uint8Array(32).fill(6), true);
const META = `0x${bytesToHex(VIEW)}${bytesToHex(SPEND)}` as `0x${string}`;

/** Craft an `OnsRecord` account image (layout from programs/ons-mirror). */
function onsRecordData(opts: { name: string; solAuthority?: Uint8Array }): Uint8Array {
  const data = new Uint8Array(8 + 167);
  data.set(createHash("sha256").update("account:OnsRecord").digest().subarray(0, 8), 0);
  data.set(onsNameHash(opts.name), 8);
  data.set(SPEND, 40); // spend_pubkey
  data.set(VIEW, 73); // view_pubkey
  data.set(new Uint8Array(20).fill(0x33), 106); // eth_owner
  if (opts.solAuthority) data.set(opts.solAuthority, 126);
  const dv = new DataView(data.buffer);
  dv.setBigUint64(8 + 150, 7n, true); // wormhole_sequence
  dv.setBigInt64(8 + 158, 1_700_000_000n, true); // updated_at
  return data;
}

function stubConnection(records: Map<string, Uint8Array>) {
  return {
    getAccountInfo: vi.fn(async (pda: PublicKey) => {
      const data = records.get(pda.toBase58());
      if (!data) return null;
      return { data: Buffer.from(data), owner: MIRROR_PROGRAM };
    }),
  };
}

async function makeClient(extra: Record<string, unknown> = {}): Promise<OpaqueClient> {
  return OpaqueClient.create({
    chainId: 11155111,
    rpcUrl: "http://127.0.0.1:1", // never hit unless a test stubs readContract
    walletSignature: ("0x" + "11".repeat(65)) as `0x${string}`,
    ethereumAddress: "0x1111111111111111111111111111111111111111",
    ...extra,
  });
}

describe("isOnsNameInput / isSnsNameInput", () => {
  it("accepts depth-1 subnames of the parent only", () => {
    expect(isOnsNameInput(`alice.${PARENT}`, PARENT)).toBe(true);
    expect(isOnsNameInput(`Alice.${PARENT}`, PARENT)).toBe(true); // case-folded
    expect(isOnsNameInput(PARENT, PARENT)).toBe(false);
    expect(isOnsNameInput(`a.b.${PARENT}`, PARENT)).toBe(false);
    expect(isOnsNameInput(`-bad.${PARENT}`, PARENT)).toBe(false);
    expect(isOnsNameInput("alice.other.eth", PARENT)).toBe(false);
  });

  it("recognises .sol names", () => {
    expect(isSnsNameInput("bob.sol")).toBe(true);
    expect(isSnsNameInput("bob.eth")).toBe(false);
  });
});

describe("ons mirror record decode + PDA derivation", () => {
  it("derives the live devnet PDA for alice.opqtest.eth", () => {
    // Created on devnet by the Phase 4 e2e run (relayed Wormhole VAA).
    expect(getOnsMirrorRecordPda(MIRROR_PROGRAM, "alice.opqtest.eth").toBase58()).toBe(
      "Hy2Nm5HZuqfBsUYaa4d7A5LoDPdZ84kfucvPSumQNwAg",
    );
  });

  it("decodes fields and assembles the meta-address V-first (CSAP §2.1)", () => {
    const rec = decodeOnsMirrorRecord(onsRecordData({ name: `alice.${PARENT}` }))!;
    expect(rec.metaAddressHex).toBe(META);
    expect(rec.spendPubKey).toBe(`0x${bytesToHex(SPEND)}`);
    expect(rec.viewPubKey).toBe(`0x${bytesToHex(VIEW)}`);
    expect(rec.ethOwner).toBe(`0x${"33".repeat(20)}`);
    expect(rec.solAuthority).toBeNull();
    expect(rec.wormholeSequence).toBe(7n);
  });

  it("surfaces a claimer authority and rejects foreign accounts", () => {
    const authority = new Uint8Array(32).fill(9);
    const rec = decodeOnsMirrorRecord(
      onsRecordData({ name: `bob.${PARENT}`, solAuthority: authority }),
    )!;
    expect(rec.solAuthority?.toBytes()).toEqual(authority);

    const bad = onsRecordData({ name: `bob.${PARENT}` });
    bad[0] ^= 0xff; // wrong discriminator
    expect(decodeOnsMirrorRecord(bad)).toBeNull();
    expect(decodeOnsMirrorRecord(bad.subarray(0, 100))).toBeNull();
  });
});

describe("resolveRecipient — ONS names", () => {
  it("resolves from the mirror PDA with no Ethereum RPC", async () => {
    const name = `alice.${PARENT}`;
    const records = new Map([
      [getOnsMirrorRecordPda(MIRROR_PROGRAM, name).toBase58(), onsRecordData({ name })],
    ]);
    const client = await makeClient({ solana: { connection: stubConnection(records) } });

    const res = await client.resolveRecipient(name);
    expect(res.source).toBe("ons-mirror");
    expect(res.metaAddressHex).toBe(META);

    // The plan's named entry point delegates to the same path.
    expect(await client.resolveOpaqueMetaAddress(name)).toBe(META);
  });

  it("falls back to the canonical registry when the mirror has no record", async () => {
    const client = await makeClient({ solana: { connection: stubConnection(new Map()) } });
    const readContract = vi.fn(async () => `st:opq:${META}`);
    (client as any).publicClient.readContract = readContract;

    const res = await client.resolveRecipient(`ghost.${PARENT}`);
    expect(res.source).toBe("ons-registry");
    expect(res.metaAddressHex).toBe(META);
    expect(readContract).toHaveBeenCalledOnce();
  });

  it("throws for names unknown to both mirror and registry", async () => {
    const client = await makeClient({ solana: { connection: stubConnection(new Map()) } });
    (client as any).publicClient.readContract = vi.fn(async () => "");
    await expect(client.resolveRecipient(`nobody.${PARENT}`)).rejects.toThrow(
      /not registered with the Opaque Name Service/,
    );
  });

  it("leaves non-ONS .eth names on the generic ENS text path", async () => {
    const getText = vi.fn(async () => `st:opq:${META}`);
    const client = await makeClient({ ens: { getText } });
    const res = await client.resolveRecipient("vitalik.eth");
    expect(res.source).toBe("ens-text");
    expect(getText).toHaveBeenCalledWith("vitalik.eth", "com.opaque.meta");
  });
});

describe("fetchOnsClaimStatus (spec/ONS.md §6 states)", () => {
  const CLAIMER = new PublicKey(new Uint8Array(32).fill(9));

  function claimData(createdAt: number): Uint8Array {
    const data = new Uint8Array(8 + 73);
    data.set(
      createHash("sha256").update("account:ProvisionalClaim").digest().subarray(0, 8),
      0,
    );
    data.set(CLAIMER.toBytes(), 8);
    data.set(onsNameHash(`bob.${PARENT}`), 40);
    new DataView(data.buffer).setBigInt64(72, BigInt(createdAt), true);
    return data;
  }

  function statusWith(accounts: Map<string, { data: Uint8Array; owner: PublicKey }>) {
    const connection = {
      getAccountInfo: async (pda: PublicKey) => {
        const hit = accounts.get(pda.toBase58());
        return hit ? { data: Buffer.from(hit.data), owner: hit.owner } : null;
      },
    };
    return fetchOnsClaimStatus(
      connection as never,
      REGISTRATION_PROGRAM,
      MIRROR_PROGRAM,
      `bob.${PARENT}`,
    );
  }

  const claimPda = getOnsClaimPda(REGISTRATION_PROGRAM, `bob.${PARENT}`).toBase58();
  const recordPda = getOnsMirrorRecordPda(MIRROR_PROGRAM, `bob.${PARENT}`).toBase58();
  const now = Math.floor(Date.now() / 1000);

  it("none / pending / expired without a mirror record", async () => {
    expect((await statusWith(new Map())).state).toBe("none");

    const pending = await statusWith(
      new Map([[claimPda, { data: claimData(now - 60), owner: REGISTRATION_PROGRAM }]]),
    );
    expect(pending.state).toBe("pending");

    const expired = await statusWith(
      new Map([[claimPda, { data: claimData(now - 25 * 3600), owner: REGISTRATION_PROGRAM }]]),
    );
    expect(expired.state).toBe("expired");
  });

  it("confirmed when the mirror authority is the claimer, lost otherwise", async () => {
    const confirmed = await statusWith(
      new Map([
        [claimPda, { data: claimData(now - 60), owner: REGISTRATION_PROGRAM }],
        [
          recordPda,
          {
            data: onsRecordData({ name: `bob.${PARENT}`, solAuthority: CLAIMER.toBytes() }),
            owner: MIRROR_PROGRAM,
          },
        ],
      ]),
    );
    expect(confirmed.state).toBe("confirmed");

    const lost = await statusWith(
      new Map([
        [claimPda, { data: claimData(now - 60), owner: REGISTRATION_PROGRAM }],
        [
          recordPda,
          {
            data: onsRecordData({
              name: `bob.${PARENT}`,
              solAuthority: new Uint8Array(32).fill(7),
            }),
            owner: MIRROR_PROGRAM,
          },
        ],
      ]),
    );
    expect(lost.state).toBe("lost");
  });
});

describe("resolveRecipient — .sol names", () => {
  it("resolves through the injected SNS record reader", async () => {
    const getRecord = vi.fn(async () => `st:opq:${META}`);
    const client = await makeClient({ sns: { getRecord } });
    const res = await client.resolveRecipient("Bob.sol");
    expect(res.source).toBe("sns-record");
    expect(res.metaAddressHex).toBe(META);
    expect(getRecord).toHaveBeenCalledWith("bob.sol", "com.opaque.meta");
  });

  it("explains how to enable SNS resolution when unconfigured", async () => {
    const client = await makeClient();
    await expect(client.resolveRecipient("bob.sol")).rejects.toThrow(/SNS access/);
  });

  it("rejects malformed record values", async () => {
    const client = await makeClient({ sns: { getRecord: async () => "junk" } });
    await expect(client.resolveRecipient("bob.sol")).rejects.toThrow(
      /not a valid 66-byte meta-address/,
    );
  });
});
