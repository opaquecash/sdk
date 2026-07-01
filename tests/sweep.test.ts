import { describe, it, expect } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { Address, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  buildStealthSweepTransaction,
  buildStealthTokenSweepTransaction,
  deriveStealthSolanaKeypairFromStealthPrivKey,
} from "@opaquecash/stealth-chain-solana";
import { planStealthSweep } from "@opaquecash/stealth-chain";
import { OpaqueClient } from "@opaquecash/opaque";

const BLOCKHASH = PublicKey.default.toBase58();

function solConn(over: Record<string, unknown> = {}): Connection {
  return {
    getBalance: async () => 1_000_000,
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }),
    getFeeForMessage: async () => ({ value: 5000 }),
    ...over,
  } as unknown as Connection;
}

describe("Solana sweep", () => {
  const dest = Keypair.generate().publicKey;

  it("plans a full-balance sweep (balance minus fee)", async () => {
    const kp = Keypair.generate();
    const plan = await buildStealthSweepTransaction(solConn(), {
      stealthKeypair: kp,
      destination: dest,
    });
    expect(plan.balanceLamports).toBe(1_000_000n);
    expect(plan.feeLamports).toBe(5000n);
    expect(plan.sweepLamports).toBe(995_000n);
    expect(plan.fromPubkey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(plan.transaction.instructions).toHaveLength(1);
  });

  it("derives the keypair from a stealth private key", async () => {
    const priv = Uint8Array.from(Array(32).fill(7));
    const plan = await buildStealthSweepTransaction(solConn(), {
      stealthPrivKey: priv,
      destination: dest,
    });
    expect(plan.fromPubkey.toBase58()).toBe(
      deriveStealthSolanaKeypairFromStealthPrivKey(priv).publicKey.toBase58(),
    );
  });

  it("rejects zero balance and fee-exceeding balance", async () => {
    const kp = Keypair.generate();
    await expect(
      buildStealthSweepTransaction(solConn({ getBalance: async () => 0 }), {
        stealthKeypair: kp,
        destination: dest,
      }),
    ).rejects.toThrow(/zero balance/i);
    await expect(
      buildStealthSweepTransaction(solConn({ getBalance: async () => 4000 }), {
        stealthKeypair: kp,
        destination: dest,
      }),
    ).rejects.toThrow(/cover network fee/i);
  });

  it("requires a keypair or private key", async () => {
    await expect(
      buildStealthSweepTransaction(solConn(), { destination: dest } as never),
    ).rejects.toThrow(/stealthKeypair or stealthPrivKey/);
  });
});

describe("Solana token sweep (fee-in-token)", () => {
  const mint = Keypair.generate().publicKey;
  const dest = Keypair.generate().publicKey;
  const relayer = Keypair.generate().publicKey;
  const stealthPrivKey = Uint8Array.from(Array(32).fill(3));

  // A minimal 165-byte SPL token account holding `amount`, owned by the token program.
  function tokenConn(amount: bigint): Connection {
    const data = Buffer.alloc(165);
    data.writeBigUInt64LE(amount, 64); // amount field
    data[108] = 1; // AccountState.Initialized
    return {
      getAccountInfo: async () => ({
        owner: TOKEN_PROGRAM_ID,
        data,
        lamports: 1,
        executable: false,
        rentEpoch: 0,
      }),
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }),
    } as unknown as Connection;
  }

  it("splits the fee to the relayer and the remainder to the destination", async () => {
    const plan = await buildStealthTokenSweepTransaction(tokenConn(1_000_000n), {
      stealthPrivKey,
      mint,
      destinationOwner: dest,
      feePayer: relayer,
      fee: 10_000n,
      decimals: 6,
    });
    expect(plan.amount).toBe(1_000_000n);
    expect(plan.fee).toBe(10_000n);
    expect(plan.destinationAmount).toBe(990_000n);
    expect(plan.feeRecipientOwner.toBase58()).toBe(relayer.toBase58());
    expect(plan.feePayer.toBase58()).toBe(relayer.toBase58());
    // create dest ATA + transfer to dest + create relayer ATA + transfer fee.
    expect(plan.transaction.instructions).toHaveLength(4);
  });

  it("omits the fee transfer when fee is zero", async () => {
    const plan = await buildStealthTokenSweepTransaction(tokenConn(1_000_000n), {
      stealthPrivKey,
      mint,
      destinationOwner: dest,
      feePayer: relayer,
      decimals: 6,
    });
    expect(plan.fee).toBe(0n);
    expect(plan.destinationAmount).toBe(1_000_000n);
    expect(plan.transaction.instructions).toHaveLength(2);
  });

  it("rejects a fee that meets or exceeds the balance", async () => {
    await expect(
      buildStealthTokenSweepTransaction(tokenConn(1_000_000n), {
        stealthPrivKey,
        mint,
        destinationOwner: dest,
        feePayer: relayer,
        fee: 1_000_000n,
        decimals: 6,
      }),
    ).rejects.toThrow(/less than the swept/i);
  });
});

describe("EVM sweep plan", () => {
  const PRIV = ("0x" + "11".repeat(32)) as `0x${string}`;
  const DEST = ("0x" + "22".repeat(20)) as Address;

  function pc(over: Record<string, unknown> = {}): PublicClient {
    return {
      chain: undefined,
      getBalance: async () => 1_000_000_000_000_000n,
      estimateGas: async () => 21000n,
      estimateFeesPerGas: async () => ({
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      }),
      getGasPrice: async () => 2_000_000_000n,
      ...over,
    } as unknown as PublicClient;
  }

  it("plans an EIP-1559 sweep and deducts gas", async () => {
    const plan = await planStealthSweep(pc(), { stealthPrivKey: PRIV, destination: DEST });
    expect(plan.gas).toBe(21000n);
    expect("maxFeePerGas" in plan.fees).toBe(true);
    expect(plan.gasCost).toBe(21000n * 2_000_000_000n);
    expect(plan.value).toBe(plan.balance - plan.gasCost);
    expect(plan.from).toBe(privateKeyToAccount(PRIV).address);
  });

  it("falls back to legacy gasPrice when EIP-1559 is unavailable", async () => {
    const plan = await planStealthSweep(pc({ estimateFeesPerGas: async () => null }), {
      stealthPrivKey: PRIV,
      destination: DEST,
    });
    expect("gasPrice" in plan.fees).toBe(true);
  });

  it("rejects zero balance and gas exceeding balance", async () => {
    await expect(
      planStealthSweep(pc({ getBalance: async () => 0n }), {
        stealthPrivKey: PRIV,
        destination: DEST,
      }),
    ).rejects.toThrow(/zero balance/i);
    await expect(
      planStealthSweep(pc({ getBalance: async () => 1n }), {
        stealthPrivKey: PRIV,
        destination: DEST,
      }),
    ).rejects.toThrow(/cover gas/i);
  });
});

describe("OpaqueClient.sweep surface", () => {
  it("exposes sweep() on the facade", () => {
    expect(typeof (OpaqueClient.prototype as unknown as { sweep: unknown }).sweep).toBe(
      "function",
    );
  });
});
