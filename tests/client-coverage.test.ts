/**
 * Phase 2.7 — offline coverage for the OpaqueClient orchestration surface: PSR admin
 * on both chains, Solana sends, registration, balances, sweeps, UAB reads, and the
 * reputation-proof helpers. Chain transports are mocked at the package boundary
 * (vi.mock) or stubbed on the client; the client's own dispatch/encoding logic runs
 * for real. WASM-dependent paths use the app-checkout module and skip without it.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Hex } from "viem";

const state = vi.hoisted(() => ({
  schemas: [] as unknown[],
  attestations: [] as unknown[],
  attestationPda: null as unknown,
  evmAuthorized: true,
  evmSchema: null as unknown,
}));

vi.mock("@opaquecash/psr-chain", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerSchema: vi.fn(async () => ({
    txHash: "0xreg",
    schemaId: ("0x" + "01".repeat(32)) as Hex,
  })),
  addDelegate: vi.fn(async () => "0xadd"),
  removeDelegate: vi.fn(async () => "0xrem"),
  deprecateSchema: vi.fn(async () => "0xdep"),
  attest: vi.fn(async () => ({ txHash: "0xatt", uid: ("0x" + "aa".repeat(32)) as Hex })),
  announceV2Attestation: vi.fn(async () => "0xannounced"),
  fetchSchema: vi.fn(async () => state.evmSchema),
  fetchSchemasForWallet: vi.fn(async () => [{ name: "mine" }]),
  fetchAttestationsIssuedBy: vi.fn(async () => [{ uid: "0x01" }]),
  isAuthorizedIssuer: vi.fn(async () => state.evmAuthorized),
  fetchLatestValidRoot: vi.fn(async () => ("0x" + "11".repeat(32)) as Hex),
  isRootValid: vi.fn(async () => true),
  fetchRootHistory: vi.fn(async () => [
    { index: 0, root: ("0x" + "11".repeat(32)) as Hex, valid: true },
  ]),
  verifyReputationView: vi.fn(async () => true),
  submitVerifyReputation: vi.fn(async () => "0xverify"),
  simulateVerifyReputation: vi.fn(async () => undefined),
}));

vi.mock("@opaquecash/psr-chain-solana", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAllSchemas: vi.fn(async () => state.schemas),
  fetchAllAttestations: vi.fn(async () => state.attestations),
  fetchAttestationPda: vi.fn(async () => state.attestationPda),
  submitReputationProof: vi.fn(async () => "solana-sig"),
}));

vi.mock("@opaquecash/stealth-chain", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sweepStealthNative: vi.fn(async () => "0xsweep"),
}));

vi.mock("@opaquecash/psr-prover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureBufferPolyfill: vi.fn(async () => undefined),
  generateReputationProof: vi.fn(async () => ({
    proof: { pi_a: ["1"], pi_b: [["1"]], pi_c: ["1"] },
    publicSignals: ["1", "42", "7", "9"],
    attestationId: 42,
    nullifier: "9",
  })),
}));

import {
  OpaqueClient,
  generateRandomMetaAddress,
  computeStealthAddressAndViewTag,
  type IndexerAnnouncement,
  type UnifiedOwnedOutput,
  type VerifyReputationArgs,
} from "@opaquecash/opaque";
import { initStealthWasm } from "@opaquecash/stealth-wasm";

const ROOT = new URL("../..", import.meta.url).pathname;
const WASM_JS = `${ROOT}app/public/pkg/cryptography.js`;
const WASM_BIN = `${ROOT}app/public/pkg/cryptography_bg.wasm`;
const wasmPresent = existsSync(WASM_JS) && existsSync(WASM_BIN);

const WALLET = Keypair.generate();
const SIGNATURE = ("0x" + "33".repeat(65)) as Hex;
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function stubConnection(extra: Record<string, unknown> = {}) {
  return {
    getLatestBlockhash: async () => ({
      blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
      lastValidBlockHeight: 1,
    }),
    sendRawTransaction: async () => "stub-signature",
    confirmTransaction: async () => ({ value: { err: null } }),
    getSlot: async () => 1000,
    getBalance: async () => 5_000_000,
    ...extra,
  };
}

const signTransaction = vi.fn(async () => ({ serialize: () => Buffer.from([1]) }));

async function makeClient(extra: Record<string, unknown> = {}): Promise<OpaqueClient> {
  const client = await OpaqueClient.create({
    chainId: 11155111,
    rpcUrl: "http://127.0.0.1:1",
    walletSignature: SIGNATURE,
    ethereumAddress: "0x1111111111111111111111111111111111111111",
    solana: { cluster: "devnet", connection: stubConnection() as never },
    solanaWallet: {
      publicKey: WALLET.publicKey,
      signTransaction: signTransaction as never,
    },
    ...(wasmPresent && extra.wasm !== false
      ? { wasmModuleSpecifier: pathToFileURL(WASM_JS).href }
      : {}),
    ...extra,
  });
  (client as unknown as { publicClient: unknown }).publicClient = {
    readContract: async () => true,
    getBalance: async () => 7n,
    getBlockNumber: async () => 100n,
    getLogs: async () => [],
  };
  (client as unknown as { evmWalletClientCache: unknown }).evmWalletClientCache = {
    chain: undefined,
    account: undefined,
    writeContract: async () => "0xwrite",
    sendTransaction: async () => "0xsent",
  };
  return client;
}

/** A parsed Solana schema PDA owned by the test wallet ("bool passed" field). */
function solanaSchema(schemaIdByte = 0x5a) {
  return {
    address: Keypair.generate().publicKey,
    schema: {
      bump: 1,
      schemaId: new Uint8Array(32).fill(schemaIdByte),
      authority: WALLET.publicKey,
      resolver: PublicKey.default,
      revocable: true,
      name: "test-schema",
      fieldDefinitions: "bool passed",
      version: 2,
      delegates: [] as PublicKey[],
      createdAt: 1n,
      schemaExpirySlot: 0n,
      deprecated: false,
    },
  };
}

beforeAll(async () => {
  if (wasmPresent) {
    await initStealthWasm({
      moduleSpecifier: pathToFileURL(WASM_JS).href,
      wasmBinaryUrl: readFileSync(WASM_BIN) as unknown as string,
    });
  }
  state.evmSchema = { name: "evm-schema", fieldDefinitions: "bool passed" };
});

describe("PSR admin (ethereum, mocked psr-chain)", () => {
  it("covers the schema lifecycle and attestation issuance", async () => {
    const client = await makeClient({ wasm: false });
    const created = await client.createSchema("ethereum", {
      name: "s",
      fieldDefinitions: [{ name: "passed", type: "bool" }],
      revocable: true,
      resolver: "0x2222222222222222222222222222222222222222",
      schemaExpiry: { dateTime: FUTURE },
    });
    expect(created.schemaId).toBe("0x" + "01".repeat(32));
    expect((await client.getMySchemas("ethereum"))).toHaveLength(1);
    expect((await client.deprecateSchema("ethereum", created.schemaId)).txHash).toBe("0xdep");
    expect(
      (await client.addSchemaDelegate("ethereum", created.schemaId, "0x3333333333333333333333333333333333333333")).txHash,
    ).toBe("0xadd");
    expect(
      (await client.removeSchemaDelegate("ethereum", created.schemaId, "0x3333333333333333333333333333333333333333")).txHash,
    ).toBe("0xrem");
    expect(await client.getMyIssuedAttestations("ethereum")).toHaveLength(1);

    // Meta-address recipient: DKSAP material is derived and the announce fires.
    const issued = await client.issueAttestation("ethereum", {
      schemaId: created.schemaId,
      recipient: generateRandomMetaAddress(),
      fieldValues: { passed: "true" },
      expiration: { slotOrBlock: 123 },
    });
    expect(issued.uid).toBe("0x" + "aa".repeat(32));
    expect(issued.stealthAddressHash).toMatch(/^0x[0-9a-f]{64}$/);

    // 20-byte and 32-byte recipients resolve without announce material.
    await client.issueAttestation("ethereum", {
      schemaId: created.schemaId,
      recipient: "0x4444444444444444444444444444444444444444",
      fieldValues: { passed: "true" },
    });
    await client.issueAttestation("ethereum", {
      schemaId: created.schemaId,
      recipient: "0x" + "55".repeat(32),
      fieldValues: { passed: "true" },
    });
    await expect(
      client.issueAttestation("ethereum", {
        schemaId: created.schemaId,
        recipient: "0x1234",
        fieldValues: { passed: "true" },
      }),
    ).rejects.toThrow(/66-byte meta-address/);
  });

  it("rejects unknown schemas, unauthorized issuers, and bad expiries", async () => {
    const client = await makeClient({ wasm: false });
    state.evmSchema = null;
    await expect(
      client.issueAttestation("ethereum", {
        schemaId: "0x" + "01".repeat(32),
        recipient: generateRandomMetaAddress(),
        fieldValues: { passed: "true" },
      }),
    ).rejects.toThrow(/not found on Ethereum/);
    state.evmSchema = { name: "evm-schema", fieldDefinitions: "bool passed" };

    state.evmAuthorized = false;
    await expect(
      client.issueAttestation("ethereum", {
        schemaId: "0x" + "01".repeat(32),
        recipient: generateRandomMetaAddress(),
        fieldValues: { passed: "true" },
      }),
    ).rejects.toThrow(/not an authorized issuer/);
    state.evmAuthorized = true;

    await expect(
      client.createSchema("ethereum", {
        name: "s",
        fieldDefinitions: "bool passed",
        revocable: false,
        schemaExpiry: { dateTime: "not-a-date" },
      }),
    ).rejects.toThrow(/invalid expiry/);
    await expect(
      client.createSchema("ethereum", {
        name: "s",
        fieldDefinitions: "bool passed",
        revocable: false,
        schemaExpiry: { dateTime: new Date(Date.now() - 1000).toISOString() },
      }),
    ).rejects.toThrow(/must be in the future/);
    await expect(client.createSchema("nope" as never, { name: "s", fieldDefinitions: "bool passed", revocable: false })).rejects.toThrow(/unsupported chain/);
  });
});

describe("PSR admin (solana, mocked fetchers)", () => {
  it("covers the schema lifecycle and attestation issuance", async () => {
    const client = await makeClient({ wasm: false });
    const created = await client.createSchema("solana", {
      name: "test-schema",
      fieldDefinitions: "bool passed",
      revocable: true,
      resolver: Keypair.generate().publicKey.toBase58(),
      schemaExpiry: { dateTime: FUTURE },
    });
    expect(created.txHash).toBe("stub-signature");
    expect(created.schemaId).toMatch(/^0x[0-9a-f]{64}$/);

    const entry = solanaSchema();
    state.schemas = [entry];
    const mine = await client.getMySchemas("solana");
    expect(mine).toHaveLength(1);
    expect(mine[0].authority).toBe(WALLET.publicKey.toBase58());

    const schemaIdHex = ("0x" + bytesToHex(entry.schema.schemaId)) as Hex;
    expect((await client.deprecateSchema("solana", schemaIdHex)).txHash).toBe("stub-signature");
    const delegate = Keypair.generate().publicKey.toBase58();
    expect((await client.addSchemaDelegate("solana", schemaIdHex, delegate)).txHash).toBe("stub-signature");
    expect((await client.removeSchemaDelegate("solana", schemaIdHex, delegate)).txHash).toBe("stub-signature");

    state.attestationPda = {
      bump: 1,
      uid: new Uint8Array(32).fill(0xbb),
      schemaPda: entry.address,
      schemaId: entry.schema.schemaId,
      issuer: WALLET.publicKey,
      stealthAddressHash: new Uint8Array(32).fill(0xcc),
      data: new Uint8Array([1]),
      createdAt: 2n,
      expirationSlot: 0n,
      revocationSlot: 0n,
      refUid: new Uint8Array(32),
    };
    state.attestations = [{ address: entry.address, attestation: state.attestationPda }];

    const issued = await client.issueAttestation("solana", {
      schemaId: schemaIdHex,
      recipient: generateRandomMetaAddress(),
      fieldValues: { passed: "true" },
      refUid: ("0x" + "dd".repeat(32)) as Hex,
    });
    expect(issued.txHash).toBe("stub-signature");
    expect(issued.uid).toBe("0x" + "bb".repeat(32));
    expect(await client.getMyIssuedAttestations("solana")).toHaveLength(1);

    await expect(
      client.issueAttestation("solana", {
        schemaId: ("0x" + "ee".repeat(32)) as Hex,
        recipient: generateRandomMetaAddress(),
        fieldValues: { passed: "true" },
      }),
    ).rejects.toThrow(/not found on Solana/);

    // Unauthorized issuer for someone else's schema.
    const foreign = solanaSchema(0x6b);
    foreign.schema.authority = Keypair.generate().publicKey;
    state.schemas = [foreign];
    await expect(
      client.issueAttestation("solana", {
        schemaId: ("0x" + bytesToHex(foreign.schema.schemaId)) as Hex,
        recipient: generateRandomMetaAddress(),
        fieldValues: { passed: "true" },
      }),
    ).rejects.toThrow(/not an authorized issuer/);
    state.schemas = [entry];
  });

  it("requires a Solana wallet for writes", async () => {
    const client = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "http://127.0.0.1:1",
      walletSignature: SIGNATURE,
      ethereumAddress: "0x1111111111111111111111111111111111111111",
    });
    await expect(
      client.createSchema("solana", { name: "s", fieldDefinitions: "bool passed", revocable: false }),
    ).rejects.toThrow(/solanaWallet/);
  });
});

describe("sends, registration, and UAB on Solana (stubbed adapter)", () => {
  function dummyIx() {
    return new TransactionInstruction({
      keys: [],
      programId: PublicKey.default,
      data: Buffer.alloc(0),
    });
  }

  function stubAdapter(extra: Record<string, unknown> = {}) {
    return {
      chainId: 1,
      name: "solana",
      connection: stubConnection(),
      buildAnnounceInstruction: vi.fn(() => dummyIx()),
      buildAnnounceWithRelay: vi.fn(() => {
        // The message keypair must be a signer ON the instruction, or
        // Transaction.partialSign rejects it as an unknown signer.
        const messageKeypair = Keypair.generate();
        const instruction = new TransactionInstruction({
          keys: [{ pubkey: messageKeypair.publicKey, isSigner: true, isWritable: true }],
          programId: PublicKey.default,
          data: Buffer.alloc(0),
        });
        return { instruction, messageKeypair };
      }),
      buildRegisterKeysInstruction: vi.fn(() => dummyIx()),
      fetchWormholeMessageFee: vi.fn(async () => 0n),
      resolveMetaAddress: vi.fn(async () => null),
      isRegistered: vi.fn(async () => true),
      sweepStealthSol: vi.fn(async () => ({ signature: "sweep-sig" })),
      fetchAnnouncements: vi.fn(async () => []),
      ...extra,
    };
  }

  it("sendStealthPayment: native, relayed, and delayed announce", async () => {
    const client = await makeClient({ wasm: false });
    const adapter = stubAdapter();
    (client as unknown as { solanaAdapter: unknown }).solanaAdapter = adapter;
    const recipient = generateRandomMetaAddress();

    const native = await client.sendStealthPayment({ chain: "solana", recipient, amount: 10n });
    expect(native.txHash).toBe("stub-signature");
    expect(native.destination).toBeDefined();
    expect(adapter.buildAnnounceInstruction).toHaveBeenCalled();

    const relayed = await client.sendStealthPayment({
      chain: "solana",
      recipient,
      amount: 10n,
      relay: true,
      batchId: 7,
    });
    expect(relayed.txHash).toBe("stub-signature");
    expect(adapter.buildAnnounceWithRelay).toHaveBeenCalled();

    const delayed = await client.sendStealthPayment({
      chain: "solana",
      recipient,
      amount: 10n,
      delayAnnouncement: 20,
    });
    expect(delayed.announcePromise).toBeDefined();
    expect(await delayed.announcePromise).toBe("stub-signature");

    const silent = await client.sendStealthPayment({
      chain: "solana",
      recipient,
      amount: 10n,
      announce: false,
    });
    expect(silent.txHash).toBe("stub-signature");

    await expect(
      client.sendStealthPayment({ chain: "solana", recipient, amount: 1n, token: "x" }),
    ).rejects.toThrow(/not yet supported/);
    await expect(
      client.sendStealthPayment({ chain: "nope" as never, recipient, amount: 1n }),
    ).rejects.toThrow(/unrecognised recipient|unsupported/);
  });

  it("registerMetaAddress + isMetaAddressRegistered on both chains", async () => {
    const client = await makeClient({ wasm: false });
    const adapter = stubAdapter();
    (client as unknown as { solanaAdapter: unknown }).solanaAdapter = adapter;

    const eth = await client.registerMetaAddress("ethereum");
    expect(eth.txHash).toBe("0xwrite");
    const sol = await client.registerMetaAddress("solana");
    expect(sol.txHash).toBe("stub-signature");
    expect(sol.metaAddressHex).toBe(client.getMetaAddressHex());
    await expect(client.registerMetaAddress("nope" as never)).rejects.toThrow(/unsupported/);

    // Ethereum read goes through the registry stub (empty bytes => unregistered).
    (client as unknown as { publicClient: unknown }).publicClient = {
      readContract: async () => "0x",
    };
    expect(await client.isMetaAddressRegistered("ethereum")).toBe(false);
    expect(await client.isMetaAddressRegistered("solana")).toBe(true);
    await expect(client.isMetaAddressRegistered("nope" as never)).rejects.toThrow(/unsupported/);
  });

  it("buildAnnounceWithRelay dispatches per chain", async () => {
    const client = await makeClient({ wasm: false });
    const adapter = stubAdapter();
    (client as unknown as { solanaAdapter: unknown }).solanaAdapter = adapter;
    const send = client.prepareStealthSend(generateRandomMetaAddress());

    const sol = await client.buildAnnounceWithRelay("solana", send, { batchId: 3 });
    expect(sol.chain).toBe("solana");
    if (sol.chain === "solana") {
      expect(sol.instructions).toHaveLength(1);
      expect(sol.signers).toHaveLength(1);
    }
    await expect(client.buildAnnounceWithRelay("nope" as never, send)).rejects.toThrow(/unsupported/);
  });

  it("reads cross-chain announcements through the UAB receiver logs", async () => {
    const client = await makeClient({ wasm: false });
    expect(await client.fetchCrossChainAnnouncements()).toEqual([]);
    expect(await client.scanCrossChain()).toEqual([]);
  });
});

describe("reputation proof helpers (mocked prover + verifiers)", () => {
  const args: VerifyReputationArgs = {
    proofData: {
      proof: { pi_a: ["1"], pi_b: [["1"]], pi_c: ["1"] },
      publicSignals: ["1", "42", "7", "9"],
      attestationId: 42,
      nullifier: "9",
    } as never,
    merkleRoot: ("0x" + "11".repeat(32)) as Hex,
    externalNullifier: "7",
  };

  it("covers root reads, view/simulate, submit on both chains, and proving", async () => {
    const client = await makeClient({ wasm: false });
    expect(await client.fetchLatestValidReputationRoot()).toBe("0x" + "11".repeat(32));
    expect(await client.isReputationRootValid(args.merkleRoot)).toBe(true);
    expect(await client.fetchReputationRootHistory()).toHaveLength(1);
    expect(await client.verifyReputationProofView(args)).toBe(true);
    await client.simulateReputationVerification({} as never, args);

    expect((await client.submitReputationVerification("ethereum", args)).txHash).toBe("0xverify");
    expect((await client.submitReputationVerification("solana", args)).txHash).toBe("solana-sig");
    await expect(client.submitReputationVerification("nope" as never, args)).rejects.toThrow(/unsupported/);

    const proof = await client.generateReputationProof({
      trait: { attestationId: 42, stealthAddress: "0x" + "ab".repeat(20), txHash: "0x", blockNumber: 1, discoveredAt: 0 },
      stealthPrivKeyBytes: new Uint8Array(32).fill(1),
      externalNullifier: "7",
    });
    expect(proof.nullifier).toBe("9");

    expect(OpaqueClient.supportedChainIds()).toContain(11155111);
    expect(OpaqueClient.chainDeployment(11155111)?.name).toBe("Sepolia");
    const scope = OpaqueClient.buildReputationActionScope({
      chainId: 1,
      module: "m",
      actionId: "a",
    });
    expect(scope).toContain("m");
    expect(OpaqueClient.reputationExternalNullifierFromScope(scope)).toBeGreaterThan(0n);
  });

  it("throws without a configured verifier and without WASM", async () => {
    const client = await makeClient({
      wasm: false,
      contracts: { opaqueReputationVerifier: undefined },
    });
    // Bundled Sepolia config still provides the verifier; drop it via internals.
    (client as unknown as { reputationVerifier?: string }).reputationVerifier = undefined;
    await expect(client.fetchLatestValidReputationRoot()).rejects.toThrow(/not configured/);

    const noWasm = await OpaqueClient.create({
      chainId: 11155111,
      rpcUrl: "http://127.0.0.1:1",
      walletSignature: SIGNATURE,
      ethereumAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(() => noWasm.encodeReputationMetadata(1, 42n)).toThrow(/WASM/);
  });
});

describe.skipIf(!wasmPresent)("WASM-backed paths (app checkout)", () => {
  it("balances from announcements and per-output balances", async () => {
    const client = await makeClient();
    const send = computeStealthAddressAndViewTag(client.getMetaAddressHex());
    const row: IndexerAnnouncement = {
      blockNumber: "1",
      etherealPublicKey: ("0x" + bytesToHex(send.ephemeralPubKey)) as Hex,
      logIndex: 0,
      metadata: ("0x" + bytesToHex(send.metadata)) as Hex,
      stealthAddress: send.stealthAddress,
      transactionHash: "0xabc" as Hex,
      viewTag: send.viewTag,
    };
    (client as unknown as { publicClient: unknown }).publicClient = {
      getBalance: async () => 9n,
      readContract: async () => 4n, // ERC-20 balanceOf
      getBlockNumber: async () => 100n,
      getLogs: async () => [],
    };
    const summary = await client.getBalancesFromAnnouncements([row]);
    const native = summary.find((t) => t.symbol === "ETH");
    expect(native?.totalRaw).toBe(9n);
    expect(summary.find((t) => t.symbol === "USDC")?.totalRaw).toBe(4n);
    expect(await client.getBalancesFromAnnouncements([])).toHaveLength(3);

    const outputs: UnifiedOwnedOutput[] = [
      {
        chain: "ethereum",
        chainId: 2,
        source: "native",
        stealthAddress: send.stealthAddress,
        transactionHash: "0xabc",
        blockNumber: 1,
        logIndex: 0,
        viewTag: send.viewTag,
        ephemeralPublicKey: row.etherealPublicKey,
      },
      {
        chain: "solana",
        chainId: 1,
        source: "native",
        stealthAddress: send.stealthAddress,
        transactionHash: "sig",
        blockNumber: 1,
        logIndex: 0,
        viewTag: send.viewTag,
        ephemeralPublicKey: row.etherealPublicKey,
      },
    ];
    const balances = await client.getBalancesForOutputs(outputs);
    expect(balances).toHaveLength(2);
    expect(balances[0]).toMatchObject({ chain: "ethereum", nativeRaw: 9n });
    expect(balances[1].chain).toBe("solana");
    expect(balances[1].nativeRaw).toBe(5_000_000n);
  });

  it("discovers PSR traits and reconstructs their signing keys", async () => {
    const client = await makeClient();
    const prep = client.prepareReputationAssignment(client.getMetaAddressHex(), 42n);
    const tx = client.buildAssignReputationTransaction(client.getMetaAddressHex(), 43n);
    expect(tx.to).toBe(client.getContracts().stealthAddressAnnouncer);

    const row: IndexerAnnouncement = {
      blockNumber: "2",
      etherealPublicKey: ("0x" + bytesToHex(prep.ephemeralPublicKey)) as Hex,
      logIndex: 0,
      metadata: ("0x" + bytesToHex(prep.metadata)) as Hex,
      stealthAddress: prep.stealthAddress,
      transactionHash: ("0x" + "ab".repeat(32)) as Hex,
      viewTag: prep.viewTag,
    };
    const traits = await client.discoverTraits([row]);
    expect(traits).toHaveLength(1);
    expect(traits[0].attestationId).toBe(42);
    expect(await client.getReputationTraitsFromAnnouncements([row])).toHaveLength(1);
    expect(await client.discoverTraits([])).toEqual([]);
    expect(client.announcementsJsonForReputationWitness([row])).toContain("stealthAddress");

    const key = client.getStealthSignerPrivateKeyForReputationTrait(traits[0]);
    expect(key).toHaveLength(32);
    expect(() =>
      client.getStealthSignerPrivateKeyForReputationTrait({ ...traits[0], ephemeralPubkey: [] }),
    ).toThrow(/ephemeralPubkey/);

    const fromPriv = client.getStealthSignerPrivateKeyFromEphemeralPrivateKey(
      prep.ephemeralPrivateKey,
    );
    expect(fromPriv).toHaveLength(32);
    expect(() => client.getStealthSignerPrivateKey({ ephemeralPublicKey: "0x1234" })).toThrow(/33-byte/);

    const ghost = client.prepareGhostReceive();
    const ghostTx = client.buildAnnounceTransactionRequestForGhost(ghost.ephemeralPrivateKey);
    expect(ghostTx.summary.stealthAddress).toBe(ghost.stealthAddress);
  });

  it("sweeps owned outputs on both chains", async () => {
    const client = await makeClient();
    const adapter = {
      connection: stubConnection(),
      sweepStealthSol: vi.fn(async () => ({ signature: "sweep-sig" })),
    };
    (client as unknown as { solanaAdapter: unknown }).solanaAdapter = adapter;
    const send = computeStealthAddressAndViewTag(client.getMetaAddressHex());
    const output = { ephemeralPublicKey: ("0x" + bytesToHex(send.ephemeralPubKey)) as Hex };

    const eth = await client.sweep({
      output,
      chain: "ethereum",
      destination: "0x9999999999999999999999999999999999999999",
    });
    expect(eth.tx).toBe("0xsweep");
    const sol = await client.sweep({
      output,
      chain: "solana",
      destination: WALLET.publicKey.toBase58(),
    });
    expect(sol.tx).toBe("sweep-sig");
    await expect(
      client.sweep({ output, chain: "nope" as never, destination: "x" }),
    ).rejects.toThrow(/unsupported/);
  });
});
