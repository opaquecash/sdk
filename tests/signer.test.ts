/**
 * Phase 2.5 — unified signer: requestSetupSignature over EIP-1193 / viem
 * WalletClient / Solana wallet-adapter shapes, and OpaqueClient.fromWallet wiring.
 * Offline: local viem account, mocked provider, mocked Solana wallet.
 */
import { describe, expect, it, vi } from "vitest";
import { createWalletClient, http, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  OpaqueClient,
  SETUP_MESSAGE,
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  requestSetupSignature,
  selectSigner,
  type UnifiedSigner,
} from "@opaquecash/opaque";

const PK = ("0x" + "42".repeat(32)) as Hex;
const account = privateKeyToAccount(PK);

function localWalletClient() {
  return createWalletClient({
    account,
    chain: sepolia,
    transport: http("http://127.0.0.1:1"), // local account: signMessage never hits it
  });
}

describe("requestSetupSignature", () => {
  it("signs SETUP_MESSAGE through a viem WalletClient (personal_sign semantics)", async () => {
    const sig = await requestSetupSignature({
      chain: "ethereum",
      address: account.address,
      walletClient: localWalletClient(),
    });
    expect(sig).toBe(await account.signMessage({ message: SETUP_MESSAGE }));
  });

  it("signs through a raw EIP-1193 provider via personal_sign", async () => {
    const request = vi.fn(async ({ method, params }: { method: string; params: unknown[] }) => {
      expect(method).toBe("personal_sign");
      expect(params).toEqual([stringToHex(SETUP_MESSAGE), account.address]);
      return "0x" + "ab".repeat(65);
    });
    const sig = await requestSetupSignature({
      chain: "ethereum",
      address: account.address,
      provider: { request } as never,
    });
    expect(sig).toBe("0x" + "ab".repeat(65));
    expect(request).toHaveBeenCalledOnce();
  });

  it("signs through Solana wallet-adapter signMessage and hex-encodes the bytes", async () => {
    const signMessage = vi.fn(async (msg: Uint8Array) => {
      expect(new TextDecoder().decode(msg)).toBe(SETUP_MESSAGE);
      return new Uint8Array(64).fill(0xcd);
    });
    const sig = await requestSetupSignature({
      chain: "solana",
      publicKey: "E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno",
      signMessage,
    });
    expect(sig).toBe(("0x" + "cd".repeat(64)) as Hex);
  });

  it("throws clear errors when the signer is incomplete", async () => {
    await expect(
      requestSetupSignature({ chain: "ethereum", address: account.address }),
    ).rejects.toThrow(/provider.*or.*walletClient/i);
    await expect(
      requestSetupSignature({
        chain: "solana",
        publicKey: "E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno",
      }),
    ).rejects.toThrow(/signMessage/);
  });
});

describe("OpaqueClient.fromWallet", () => {
  it("derives the same keys as create() with the prompted signature", async () => {
    const client = await OpaqueClient.fromWallet({
      wallets: {
        chain: "ethereum",
        address: account.address,
        walletClient: localWalletClient(),
      },
      chainId: 11155111,
      rpcUrl: "http://127.0.0.1:1",
    });
    const sig = await account.signMessage({ message: SETUP_MESSAGE });
    const { viewingKey, spendingKey } = deriveKeysFromSignature(sig);
    const { metaAddress } = keysToStealthMetaAddress(viewingKey, spendingKey);
    expect(client.getMetaAddressHex()).toBe(stealthMetaAddressToHex(metaAddress));
    expect(client.getEthereumAddress()).toBe(account.address);
  });

  it("uses a cached walletSignature without prompting and wires the Solana wallet", async () => {
    const signMessage = vi.fn();
    const signTransaction = vi.fn();
    const cached = ("0x" + "11".repeat(65)) as Hex;
    const client = await OpaqueClient.fromWallet({
      wallets: [
        {
          chain: "solana",
          publicKey: "E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno",
          signMessage,
          signTransaction: signTransaction as never,
        },
      ],
      walletSignature: cached,
      chainId: 11155111,
      rpcUrl: "http://127.0.0.1:1",
    });
    expect(signMessage).not.toHaveBeenCalled();
    // Solana-only session: placeholder EVM address, reads still work.
    expect(client.getEthereumAddress()).toBe(
      "0x0000000000000000000000000000000000000000",
    );
    const direct = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "http://127.0.0.1:1",
      walletSignature: cached,
      ethereumAddress: "0x0000000000000000000000000000000000000000",
    });
    expect(client.getMetaAddressHex()).toBe(direct.getMetaAddressHex());
  });

  it("rejects an empty wallet list and selects per-chain signers", async () => {
    await expect(
      OpaqueClient.fromWallet({
        wallets: [],
        chainId: 11155111,
        rpcUrl: "http://127.0.0.1:1",
      }),
    ).rejects.toThrow(/at least one wallet/);

    const wallets: UnifiedSigner[] = [
      { chain: "ethereum", address: account.address, walletClient: localWalletClient() },
      {
        chain: "solana",
        publicKey: "E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno",
      },
    ];
    expect(selectSigner(wallets, "ethereum")?.chain).toBe("ethereum");
    expect(selectSigner(wallets, "solana")?.chain).toBe("solana");
    expect(selectSigner(wallets[0], "solana")).toBeUndefined();
  });
});
