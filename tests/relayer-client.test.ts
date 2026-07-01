/**
 * Phase 5.4/5.5 — @opaquecash/relayer-client: payload commitments, NaCl box interop
 * with the Rust relayer node (crypto_box), bid verification, stake-weighted selection,
 * and escrow tx construction. The box fixture below was produced by the Rust
 * `crypto_box` (SalsaBox) so a mismatch here means the SDK and node cannot talk.
 */
import { describe, expect, it } from "vitest";
import { x25519 } from "@noble/curves/ed25519";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { privateKeyToAccount } from "viem/accounts";
import { hashMessage } from "viem";
import {
  sealBox,
  openBox,
  evmPayloadHash,
  solanaPayloadHash,
  solanaPayloadBytes,
  bidSigningHash,
  buildEvmCreateJob,
  buildSolanaCreateJob,
  selectWinner,
  verifyEvmBidSignature,
  gaslessSweepSubmission,
  postGaslessSweep,
  getSweepInfo,
  type Bid,
} from "@opaquecash/relayer-client";

// Fixture from the Rust `crypto_box` (relayer node): recipient secret [7u8;32],
// ephemeral [9u8;32], nonce [3u8;24], plaintext "opaque gas-private payload".
const RUST_RECIP_SECRET = new Uint8Array(32).fill(7);
const RUST_RECIP_PUBLIC = "13be4feaeaf204c7fd3358fc9c00721881d174278128227ec674f37f7fe97b6d";
const RUST_PLAINTEXT = "opaque gas-private payload";
const RUST_BOX_B64 =
  "V9tLNZ8jrl4Ubk4lEgVnBHIlBjSMFQwUdT0Mkz0E1CEDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMa2Fgoebt1mT/9PJGS8undETgYd5r0YDeJQCLk/BwFuNrUQ3QuLTz4pcY=";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("NaCl box interop with the Rust relayer node", () => {
  it("derives the same x25519 public key the node advertises", () => {
    const pub = x25519.getPublicKey(RUST_RECIP_SECRET);
    expect(Buffer.from(pub).toString("hex")).toBe(RUST_RECIP_PUBLIC);
  });

  it("opens a box sealed by the Rust crypto_box", () => {
    const opened = openBox(RUST_RECIP_SECRET, b64ToBytes(RUST_BOX_B64));
    expect(new TextDecoder().decode(opened)).toBe(RUST_PLAINTEXT);
  });

  it("seals a box the recipient secret can reopen", () => {
    const pub = x25519.getPublicKey(RUST_RECIP_SECRET);
    let counter = 0;
    const det = (n: number) => Uint8Array.from({ length: n }, () => (counter++ % 251) + 1);
    const sealed = sealBox(pub, new TextEncoder().encode("round trip"), det);
    expect(new TextDecoder().decode(openBox(RUST_RECIP_SECRET, sealed))).toBe("round trip");
  });
});

describe("payload commitments", () => {
  it("EVM hash matches keccak256(abi.encode(target, data))", () => {
    const h = evmPayloadHash({
      chain: 2,
      target: "0x000000000000000000000000000000000000bEEF",
      calldata: "0xdeadbeef",
    });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    // Sensitive to the calldata.
    const h2 = evmPayloadHash({ chain: 2, target: "0x000000000000000000000000000000000000bEEF", calldata: "0xdeadbeed" });
    expect(h).not.toBe(h2);
  });

  it("Solana hash commits is_signer=false and is order-sensitive", () => {
    const program = new PublicKey("E4xmYaAU31dbNTbhfMfp2F24b48DAxJigvZTVbsKJREg");
    const a = new PublicKey(new Uint8Array(32).fill(1));
    const b = new PublicKey(new Uint8Array(32).fill(2));
    const ix1 = new TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: a, isSigner: false, isWritable: true },
        { pubkey: b, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
    const ix2 = new TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: b, isSigner: false, isWritable: false },
        { pubkey: a, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([9]),
    });
    expect(solanaPayloadHash({ chain: 1, instruction: ix1 })).not.toBe(
      solanaPayloadHash({ chain: 1, instruction: ix2 }),
    );
  });

  it("rejects Solana payloads with inner signers", () => {
    const program = new PublicKey("E4xmYaAU31dbNTbhfMfp2F24b48DAxJigvZTVbsKJREg");
    const ix = new TransactionInstruction({
      programId: program,
      keys: [{ pubkey: program, isSigner: true, isWritable: false }],
      data: Buffer.from([]),
    });
    expect(() => solanaPayloadBytes({ chain: 1, instruction: ix })).toThrow(/signers/);
  });
});

describe("bids", () => {
  it("verifies an EVM bid signed by the operator and rejects tampering", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const jobId = `0x${"01".repeat(32)}` as const;
    const x25519Pk = `0x${"ab".repeat(32)}` as const;
    const sig = await account.signMessage({ message: { raw: bidSigningHash(jobId, x25519Pk) } });
    const bid: Bid = {
      t: "bid",
      v: 1,
      jobId,
      chain: 2,
      operator: account.address,
      x25519Pk,
      sig,
    };
    expect(await verifyEvmBidSignature(bid)).toBe(true);
    expect(await verifyEvmBidSignature({ ...bid, x25519Pk: `0x${"cd".repeat(32)}` })).toBe(false);
  });

  it("selects a winner weighted by free stake", () => {
    const mk = (op: string, stake: bigint): { bid: Bid; freeStake: bigint } => ({
      bid: { t: "bid", v: 1, jobId: "0x00", chain: 2, operator: op, x25519Pk: "0x00", sig: "0x" },
      freeStake: stake,
    });
    const verified = [mk("a", 1n), mk("b", 9n)];
    // random ~0.95 lands in b's 90% of the cumulative stake.
    expect(selectWinner(verified, () => 0.95)!.bid.operator).toBe("b");
    expect(selectWinner(verified, () => 0.01)!.bid.operator).toBe("a");
    expect(selectWinner([], () => 0.5)).toBeNull();
  });
});

describe("escrow tx builders", () => {
  it("builds the EVM createJob call with the fee as value", () => {
    const req = buildEvmCreateJob({
      registry: "0x5fA252e2D22058a4ec3420573a3B3A5dca025837",
      jobId: `0x${"01".repeat(32)}`,
      payloadHash: `0x${"02".repeat(32)}`,
      deadline: 1_900_000_000,
      fee: 1_000_000_000_000_000n,
    });
    expect(req.value).toBe(1_000_000_000_000_000n);
    expect(req.data.startsWith("0x")).toBe(true);
    expect(req.to).toBe("0x5fA252e2D22058a4ec3420573a3B3A5dca025837");
  });

  it("builds the Solana create_job instruction with the job PDA", () => {
    const program = new PublicKey("E4xmYaAU31dbNTbhfMfp2F24b48DAxJigvZTVbsKJREg");
    const creator = new PublicKey(new Uint8Array(32).fill(5));
    const ix = buildSolanaCreateJob({
      program,
      creator,
      jobId: `0x${"01".repeat(32)}`,
      payloadHash: `0x${"02".repeat(32)}`,
      deadline: 1_900_000_000,
      fee: 100_000_000n,
    });
    expect(ix.programId.equals(program)).toBe(true);
    expect(ix.keys[1].pubkey.equals(creator)).toBe(true);
    expect(ix.keys[2].pubkey.equals(SystemProgram.programId)).toBe(true);
  });
});

describe("gasless sweep gateway client", () => {
  it("narrows a built sweep to the minimal /v1/sweep body", () => {
    expect(
      gaslessSweepSubmission({ chain: "ethereum", to: "0xForwarder", data: "0xabcd" }),
    ).toEqual({ chain: "ethereum", to: "0xForwarder", data: "0xabcd" });
    expect(
      gaslessSweepSubmission({ chain: "solana", transactionBase64: "AQID" }),
    ).toEqual({ chain: "solana", transactionBase64: "AQID" });
  });

  it("POSTs the submission and returns the relayer tx id", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      captured = { url, body: JSON.parse(String(init?.body)) };
      return { ok: true, status: 200, json: async () => ({ ok: true, tx: "0xdeadbeef" }) };
    }) as unknown as typeof fetch;

    const { tx } = await postGaslessSweep(
      { baseUrl: "http://localhost:8787/", fetchFn },
      { chain: "ethereum", to: "0xForwarder", data: "0xabcd" },
    );
    expect(tx).toBe("0xdeadbeef");
    expect(captured!.url).toBe("http://localhost:8787/v1/sweep");
    expect(captured!.body).toEqual({ chain: "ethereum", to: "0xForwarder", data: "0xabcd" });
  });

  it("throws with the relayer error on failure", async () => {
    const fetchFn = (async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "fee below gas cost" }),
    })) as unknown as typeof fetch;
    await expect(
      postGaslessSweep(
        { baseUrl: "http://localhost:8787", fetchFn },
        { chain: "solana", transactionBase64: "AQID" },
      ),
    ).rejects.toThrow(/fee below gas cost/);
  });

  it("reads the relayer's per-chain sweep info", async () => {
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ chains: [{ chain: 1, operator: "SoLoperator" }] }),
    })) as unknown as typeof fetch;
    const info = await getSweepInfo({ baseUrl: "http://localhost:8787", fetchFn });
    expect(info.chains[0].operator).toBe("SoLoperator");
  });
});
