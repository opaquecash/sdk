import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  getAddress,
  hexToBytes,
} from "viem";
import { EIP5564_SCHEME_SECP256K1 } from "@opaquecash/stealth-core";
import {
  stealthMetaAddressRegistryAbi,
  stealthAddressAnnouncerAbi,
  getStealthMetaAddress as readRegistryMetaAddress,
} from "@opaquecash/stealth-chain";
import {
  checkAnnouncement,
  checkAnnouncementViewTag,
  encodeAttestationMetadata,
  initStealthWasm,
  reconstructSigningKey,
  scanAttestationsJson,
  type StealthWasmModule,
} from "@opaquecash/stealth-wasm";
import {
  attestationsToDiscoveredTraits,
  buildActionScope,
  externalNullifierFromScope,
  type ProofData,
} from "@opaquecash/psr-core";
import type { DiscoveredTrait } from "@opaquecash/psr-core";
import {
  fetchLatestValidRoot,
  fetchRootHistory,
  isRootValid,
  simulateVerifyReputation,
  submitVerifyReputation,
  verifyReputationView,
  type VerifyReputationArgs,
} from "@opaquecash/psr-chain";
import {
  ensureBufferPolyfill,
  generateReputationProof as runGenerateReputationProof,
  type ArtifactPaths,
  type ProofProgressCallback,
} from "@opaquecash/psr-prover";
import {
  aggregateBalancesByToken,
  type TrackedToken,
} from "@opaquecash/stealth-balance";
import type { StealthOutputBalance } from "@opaquecash/stealth-balance";
import {
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  computeStealthAddressAndViewTag,
  recomputeStealthSendFromEphemeralPrivateKey,
  ephemeralPrivateKeyToCompressedPublicKey,
} from "./crypto/dksap.js";
import {
  getChainDeployment as getChainDeploymentInfo,
  getSupportedChainIds,
  requireChainDeployment,
  NATIVE_TOKEN_ADDRESS,
  type OpaqueChainDeployment,
} from "./chains.js";
import {
  indexerAnnouncementsToScannerJson,
  indexerAnnouncementToScannerRecord,
} from "./indexer/normalize.js";
import type {
  IndexerAnnouncement,
  OwnedStealthOutput,
  TokenBalanceSummary,
} from "./types/indexer.js";

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Configuration for {@link OpaqueClient.create}.
 */
export interface OpaqueClientConfig {
  /** EVM chain id (must be in {@link getSupportedChainIds} unless you override all contracts). */
  chainId: number;
  /** HTTP(S) RPC URL for reads (balances, optional registry view). */
  rpcUrl: string;
  /**
   * Wallet signature used as HKDF entropy (`opaque-cash-v1`) for viewing + spending keys.
   * Never sent on-chain by the SDK.
   */
  walletSignature: Hex;
  /**
   * The externally owned account that signs / registers (used as registrant context in docs;
   * you still pass the same address to your wallet when sending txs).
   */
  ethereumAddress: Address;
  /** Dynamic import URL for wasm-pack `cryptography.js`. */
  wasmModuleSpecifier: string;
  /**
   * Extra ERC-20s (and native) to aggregate. Merged with chain defaults; native uses
   * {@link NATIVE_TOKEN_ADDRESS}.
   */
  trackedTokens?: TrackedToken[];
  /** Override registry / announcer / verifier for custom deployments. */
  contracts?: Partial<{
    stealthMetaAddressRegistry: Address;
    stealthAddressAnnouncer: Address;
    opaqueReputationVerifier: Address;
  }>;
}

/**
 * Result of preparing a stealth send (ephemeral material + announce fields).
 */
export interface PrepareStealthSendResult {
  schemeId: bigint;
  stealthAddress: Address;
  viewTag: number;
  /** 33-byte compressed ephemeral public key. */
  ephemeralPublicKey: Uint8Array;
  /** 32-byte ephemeral private key — store securely if you need ghost / later announce. */
  ephemeralPrivateKey: Uint8Array;
  /** Metadata bytes for `announce` (view tag byte; extend with WASM for PSR). */
  metadata: Uint8Array;
}

/**
 * Result of {@link OpaqueClient.prepareGhostReceive} — same shape as {@link PrepareStealthSendResult},
 * keyed to your own meta-address for receive-without-prior-announcement flows.
 */
export type PrepareGhostReceiveResult = PrepareStealthSendResult;

/**
 * Calldata-ready request for `StealthAddressAnnouncer.announce` (developer submits via wallet).
 */
export interface AnnounceTransactionRequest {
  to: Address;
  data: Hex;
  chainId: number;
  summary: {
    schemeId: bigint;
    stealthAddress: Address;
    ephemeralPublicKey: Hex;
    metadata: Hex;
  };
}

/**
 * Calldata-ready request for `StealthMetaAddressRegistry.registerKeys`.
 */
export interface RegisterMetaAddressTransactionRequest {
  to: Address;
  data: Hex;
  chainId: number;
  metaAddressHex: Hex;
}

/**
 * Result of {@link OpaqueClient.resolveRecipientMetaAddress}: registry lookup for a normal EOA.
 */
export interface ResolveRecipientMetaResult {
  /**
   * Checksummed address you looked up (the would-be recipient).
   * When `registered` is false, use this as the plain receiver identity — there is no meta-address yet.
   */
  recipientAddress: Address;
  /** True when `stealthMetaAddressOf` returned a 66-byte meta-address for EIP-5564 scheme 1. */
  registered: boolean;
  /**
   * 66-byte stealth meta-address (`0x` + 132 hex) for {@link prepareStealthSend}.
   * Omitted when `registered` is false.
   */
  metaAddressHex?: Hex;
}

interface ScanAttestationRow {
  stealth_address: string;
  attestation_id: number;
  tx_hash: string;
  block_number: number;
  ephemeral_pubkey: number[];
}

export class OpaqueClient {
  private readonly config: OpaqueClientConfig;
  private readonly deployment: OpaqueChainDeployment;
  private readonly registry: Address;
  private readonly announcer: Address;
  private readonly reputationVerifier?: Address;
  private readonly tokens: TrackedToken[];
  private readonly viewingKey: Uint8Array;
  private readonly spendingKey: Uint8Array;
  private readonly spendPubKey: Uint8Array;
  private readonly metaAddressHex: Hex;
  private readonly publicClient: PublicClient;
  private readonly wasm: StealthWasmModule;

  private constructor(
    config: OpaqueClientConfig,
    deployment: OpaqueChainDeployment,
    wasm: StealthWasmModule,
    keys: {
      viewingKey: Uint8Array;
      spendingKey: Uint8Array;
      spendPubKey: Uint8Array;
      metaAddressHex: Hex;
    },
  ) {
    this.config = config;
    this.deployment = deployment;
    this.registry =
      config.contracts?.stealthMetaAddressRegistry ??
      deployment.stealthMetaAddressRegistry;
    this.announcer =
      config.contracts?.stealthAddressAnnouncer ??
      deployment.stealthAddressAnnouncer;
    this.reputationVerifier =
      config.contracts?.opaqueReputationVerifier ??
      deployment.opaqueReputationVerifier;
    const baseTokens = deployment.defaultTrackedTokens;
    const extra = config.trackedTokens ?? [];
    this.tokens = mergeTrackedTokens(baseTokens, extra);
    this.viewingKey = keys.viewingKey;
    this.spendingKey = keys.spendingKey;
    this.spendPubKey = keys.spendPubKey;
    this.metaAddressHex = keys.metaAddressHex;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient;
    this.wasm = wasm;
  }

  /**
   * Construct a client: loads WASM, derives keys from `walletSignature`, wires RPC + addresses.
   */
  static async create(config: OpaqueClientConfig): Promise<OpaqueClient> {
    const deployment = requireChainDeployment(config.chainId);
    const wasm = await initStealthWasm({
      moduleSpecifier: config.wasmModuleSpecifier,
    });
    const { viewingKey, spendingKey } = deriveKeysFromSignature(
      config.walletSignature,
    );
    const { S, metaAddress } = keysToStealthMetaAddress(
      viewingKey,
      spendingKey,
    );
    const metaAddressHex = stealthMetaAddressToHex(metaAddress);
    return new OpaqueClient(
      config,
      deployment,
      wasm,
      {
        viewingKey,
        spendingKey,
        spendPubKey: S,
        metaAddressHex,
      },
    );
  }

  /** Chain id from configuration. */
  getChainId(): number {
    return this.config.chainId;
  }

  /** Connected Ethereum address (from config). */
  getEthereumAddress(): Address {
    return this.config.ethereumAddress;
  }

  /** 66-byte meta-address hex for registry / sharing. */
  getMetaAddressHex(): Hex {
    return this.metaAddressHex;
  }

  /** Resolved contract addresses for the active chain. */
  getContracts(): {
    stealthMetaAddressRegistry: Address;
    stealthAddressAnnouncer: Address;
    opaqueReputationVerifier?: Address;
  } {
    return {
      stealthMetaAddressRegistry: this.registry,
      stealthAddressAnnouncer: this.announcer,
      opaqueReputationVerifier: this.reputationVerifier,
    };
  }

  /**
   * Look up a recipient’s stealth meta-address on `StealthMetaAddressRegistry` using this client’s
   * `rpcUrl` and configured registry (scheme id {@link EIP5564_SCHEME_SECP256K1}).
   *
   * When the account has not registered, `registered` is false and `metaAddressHex` is omitted —
   * `recipientAddress` is still the checksummed address you passed in so you can show “not on Opaque yet”.
   *
   * @param recipientAddress - Normal Ethereum address of the intended recipient.
   */
  async resolveRecipientMetaAddress(
    recipientAddress: Address,
  ): Promise<ResolveRecipientMetaResult> {
    const recipient = getAddress(recipientAddress);
    const schemeId = BigInt(EIP5564_SCHEME_SECP256K1);
    const bytes = await readRegistryMetaAddress(this.publicClient, {
      registryAddress: this.registry,
      registrant: recipient,
      schemeId,
    });
    const byteLen = hexPayloadByteLength(bytes);
    if (byteLen < 66) {
      return {
        recipientAddress: recipient,
        registered: false,
      };
    }
    return {
      recipientAddress: recipient,
      registered: true,
      metaAddressHex: bytes,
    };
  }

  /**
   * Encode `registerKeys` for the user's meta-address (they submit with `ethereumAddress`).
   */
  buildRegisterMetaAddressTransaction(): RegisterMetaAddressTransactionRequest {
    const schemeId = BigInt(EIP5564_SCHEME_SECP256K1);
    const data = encodeFunctionData({
      abi: stealthMetaAddressRegistryAbi,
      functionName: "registerKeys",
      args: [schemeId, this.metaAddressHex],
    }) as Hex;
    return {
      to: this.registry,
      data,
      chainId: this.config.chainId,
      metaAddressHex: this.metaAddressHex,
    };
  }

  /**
   * Derive a one-time stealth address for sending to a recipient meta-address.
   */
  prepareStealthSend(recipientMetaAddressHex: Hex): PrepareStealthSendResult {
    const r = computeStealthAddressAndViewTag(recipientMetaAddressHex);
    return {
      schemeId: BigInt(EIP5564_SCHEME_SECP256K1),
      stealthAddress: r.stealthAddress,
      viewTag: r.viewTag,
      ephemeralPublicKey: r.ephemeralPubKey,
      ephemeralPrivateKey: r.ephemeralPriv,
      metadata: r.metadata,
    };
  }

  /**
   * Manual “ghost” receive: derive a one-time stealth address for **this** wallet’s meta-address
   * without any on-chain announcement yet. Cryptographically this is {@link prepareStealthSend}
   * with {@link getMetaAddressHex}; you must persist `ephemeralPrivateKey` (and optionally the
   * full prep) securely to sweep funds or to announce later.
   */
  prepareGhostReceive(): PrepareGhostReceiveResult {
    return this.prepareStealthSend(this.metaAddressHex);
  }

  /**
   * Build `announce` calldata after you only have the stored 32-byte ephemeral secret from
   * {@link prepareGhostReceive} (or any prior {@link prepareStealthSend} to your meta-address).
   * Recomputes stealth address and pubkey material deterministically. If you still have the full
   * {@link PrepareStealthSendResult} object, {@link buildAnnounceTransactionRequest} is enough.
   */
  buildAnnounceTransactionRequestForGhost(
    ephemeralPrivateKey: Uint8Array,
  ): AnnounceTransactionRequest {
    const r = recomputeStealthSendFromEphemeralPrivateKey(
      this.metaAddressHex,
      ephemeralPrivateKey,
    );
    return this.buildAnnounceTransactionRequest({
      schemeId: BigInt(EIP5564_SCHEME_SECP256K1),
      stealthAddress: r.stealthAddress,
      viewTag: r.viewTag,
      ephemeralPublicKey: r.ephemeralPubKey,
      ephemeralPrivateKey: r.ephemeralPriv,
      metadata: r.metadata,
    });
  }

  /**
   * Build calldata for `announce` so the developer can prompt the user to broadcast.
   */
  buildAnnounceTransactionRequest(
    send: PrepareStealthSendResult,
  ): AnnounceTransactionRequest {
    const ephemeralHex = (`0x${bytesToHex(send.ephemeralPublicKey)}`) as Hex;
    const metadataHex = (`0x${bytesToHex(send.metadata)}`) as Hex;
    const data = encodeFunctionData({
      abi: stealthAddressAnnouncerAbi,
      functionName: "announce",
      args: [send.schemeId, send.stealthAddress, ephemeralHex, metadataHex],
    }) as Hex;
    return {
      to: this.announcer,
      data,
      chainId: this.config.chainId,
      summary: {
        schemeId: send.schemeId,
        stealthAddress: send.stealthAddress,
        ephemeralPublicKey: ephemeralHex,
        metadata: metadataHex,
      },
    };
  }

  /**
   * Filter indexer announcements down to outputs owned by this user (WASM scan).
   */
  async filterOwnedAnnouncements(
    rows: IndexerAnnouncement[],
  ): Promise<OwnedStealthOutput[]> {
    if (rows.length === 0) return [];
    const owned: OwnedStealthOutput[] = [];
    for (const row of rows) {
      const eph = hexToBytes(row.etherealPublicKey);
      if (eph.length !== 33) continue;

      const vtRaw = (row as any)?.viewTag as unknown;
      const vt =
        typeof vtRaw === "number"
          ? vtRaw
          : typeof vtRaw === "string"
            ? Number.parseInt(vtRaw, 10)
            : Number(vtRaw);
      if (!Number.isFinite(vt) || !Number.isInteger(vt) || vt < 0 || vt > 255) continue;

      const tagResult = checkAnnouncementViewTag(this.wasm, vt, this.viewingKey, eph);
      if (tagResult === "NoMatch") continue;

      const ok = checkAnnouncement(
        this.wasm,
        row.stealthAddress,
        vt,
        this.viewingKey,
        this.spendPubKey,
        eph,
      );
      if (!ok) continue;

      owned.push({
        stealthAddress: getAddress(row.stealthAddress),
        transactionHash: row.transactionHash,
        blockNumber: Number(row.blockNumber),
        logIndex: row.logIndex,
        viewTag: vt,
        ephemeralPublicKey: row.etherealPublicKey,
      });
    }
    return owned;
  }

  /**
   * Reconstruct the 32-byte secp256k1 private key that controls `output`’s one-time stealth address.
   * Uses the same WASM path as the on-chain scanner (`reconstruct_signing_key_wasm`).
   *
   * You supply gas, nonce, and broadcast: build a viem `PrivateKeyAccount` (or ethers wallet) from
   * the returned bytes and sign a transfer **from** `output.stealthAddress`. Never log or persist
   * the result beyond what your threat model allows.
   */
  getStealthSignerPrivateKey(
    output: Pick<OwnedStealthOutput, "ephemeralPublicKey">,
  ): Uint8Array {
    const ephemeralPubkeyBytes = hexToBytes(output.ephemeralPublicKey);
    if (ephemeralPubkeyBytes.length !== 33) {
      throw new Error(
        "Opaque: ephemeralPublicKey must be 33-byte compressed secp256k1 hex",
      );
    }
    return reconstructSigningKey(
      this.wasm,
      this.spendingKey,
      this.viewingKey,
      ephemeralPubkeyBytes,
    );
  }

  /**
   * Same as {@link getStealthSignerPrivateKey} when you only have the 32-byte ephemeral **private**
   * key from {@link prepareGhostReceive} / {@link prepareStealthSend} (e.g. ghost storage) instead
   * of an indexer row with `ephemeralPublicKey`.
   */
  getStealthSignerPrivateKeyFromEphemeralPrivateKey(
    ephemeralPrivateKey: Uint8Array,
  ): Uint8Array {
    const ephemeralPubkeyBytes =
      ephemeralPrivateKeyToCompressedPublicKey(ephemeralPrivateKey);
    return reconstructSigningKey(
      this.wasm,
      this.spendingKey,
      this.viewingKey,
      ephemeralPubkeyBytes,
    );
  }

  /**
   * Owned outputs + balances summed per tracked token (uses `rpcUrl` from config).
   */
  async getBalancesFromAnnouncements(
    rows: IndexerAnnouncement[],
  ): Promise<TokenBalanceSummary[]> {
    const owned = await this.filterOwnedAnnouncements(rows);
    const unique = [...new Map(owned.map((o) => [o.stealthAddress, o])).values()];
    const outputs: StealthOutputBalance[] = [];

    for (const o of unique) {
      const balances: Record<Hex, bigint> = {};
      for (const t of this.tokens) {
        if (t.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
          const wei = await this.publicClient.getBalance({
            address: o.stealthAddress,
          });
          balances[NATIVE_TOKEN_ADDRESS] = wei;
        } else {
          const bal = await this.publicClient.readContract({
            address: t.address,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [o.stealthAddress],
          });
          balances[t.address] = bal;
        }
      }
      outputs.push({ stealthAddress: o.stealthAddress, balances });
    }

    const totals = aggregateBalancesByToken(outputs);
    return this.tokens.map((t) => ({
      tokenAddress: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      totalRaw: totals.get(t.address.toLowerCase()) ?? 0n,
    }));
  }

  /**
   * PSR: map owned attestation markers to {@link DiscoveredTrait} list.
   */
  async discoverTraits(
    rows: IndexerAnnouncement[],
  ): Promise<DiscoveredTrait[]> {
    if (rows.length === 0) return [];
    const json = indexerAnnouncementsToScannerJson(rows);
    const out = scanAttestationsJson(
      this.wasm,
      json,
      this.viewingKey,
      this.spendPubKey,
    );
    const list = JSON.parse(out) as ScanAttestationRow[];
    return attestationsToDiscoveredTraits(list);
  }

  /**
   * PSR: same as {@link discoverTraits} — alias for reputation-focused call sites.
   */
  async getReputationTraitsFromAnnouncements(
    rows: IndexerAnnouncement[],
  ): Promise<DiscoveredTrait[]> {
    return this.discoverTraits(rows);
  }

  /**
   * Encode `announce` metadata for a PSR attestation (view tag byte + `0xA7` + u64 `attestationId`).
   * Canonical encoding matches WASM/Rust; use with {@link prepareReputationAssignment}.
   */
  encodeReputationMetadata(viewTag: number, attestationId: bigint): Uint8Array {
    const hex = encodeAttestationMetadata(
      this.wasm,
      viewTag,
      attestationId,
    ) as Hex;
    return hexToBytes(hex);
  }

  /**
   * Issuer flow: derive one-time stealth material for the recipient and embed `attestationId` in metadata.
   */
  prepareReputationAssignment(
    recipientMetaAddressHex: Hex,
    attestationId: bigint,
  ): PrepareStealthSendResult {
    const prep = this.prepareStealthSend(recipientMetaAddressHex);
    const metadata = this.encodeReputationMetadata(prep.viewTag, attestationId);
    return { ...prep, metadata };
  }

  /**
   * Issuer flow: calldata for `StealthAddressAnnouncer.announce` with PSR metadata (no asset transfer).
   */
  buildAssignReputationTransaction(
    recipientMetaAddressHex: Hex,
    attestationId: bigint,
  ): AnnounceTransactionRequest {
    return this.buildAnnounceTransactionRequest(
      this.prepareReputationAssignment(recipientMetaAddressHex, attestationId),
    );
  }

  /**
   * JSON array string for {@link generateReputationProof} when passing `attestationsJson` (WASM Merkle witness).
   */
  announcementsJsonForReputationWitness(rows: IndexerAnnouncement[]): string {
    return indexerAnnouncementsToScannerJson(rows);
  }

  /**
   * One-time stealth signing key for a {@link DiscoveredTrait} (requires `ephemeralPubkey` from the scan).
   */
  getStealthSignerPrivateKeyForReputationTrait(trait: DiscoveredTrait): Uint8Array {
    if (!trait.ephemeralPubkey?.length) {
      throw new Error(
        "Opaque: DiscoveredTrait.ephemeralPubkey is required (use discoverTraits / getReputationTraitsFromAnnouncements)",
      );
    }
    const ephemeralPublicKey = (`0x${trait.ephemeralPubkey
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`) as Hex;
    return this.getStealthSignerPrivateKey({ ephemeralPublicKey });
  }

  /**
   * Groth16 proof bundle for `OpaqueReputationVerifier` (requires `snarkjs`).
   * When `artifacts` is omitted, wasm/zkey are loaded from the default hosted paths on opaque.cash
   * (same as the Opaque frontend `/circuits/...` assets).
   */
  async generateReputationProof(params: {
    trait: DiscoveredTrait;
    stealthPrivKeyBytes: Uint8Array;
    externalNullifier: string;
    attestationsJson?: string;
    artifacts?: ArtifactPaths;
    onProgress?: ProofProgressCallback;
  }): Promise<ProofData> {
    await ensureBufferPolyfill();
    return runGenerateReputationProof({
      wasm: this.wasm,
      trait: params.trait,
      stealthPrivKeyBytes: params.stealthPrivKeyBytes,
      externalNullifier: params.externalNullifier,
      attestationsJson: params.attestationsJson,
      artifacts: params.artifacts,
      onProgress: params.onProgress,
    });
  }

  /** Latest non-expired Merkle root from `OpaqueReputationVerifier.rootHistory`. */
  async fetchLatestValidReputationRoot(): Promise<Hex> {
    return fetchLatestValidRoot(
      this.publicClient,
      this.getReputationVerifierAddress(),
    );
  }

  /** Whether the verifier currently accepts this root (exists and not past expiry). */
  async isReputationRootValid(root: Hex): Promise<boolean> {
    return isRootValid(
      this.publicClient,
      this.getReputationVerifierAddress(),
      root,
    );
  }

  /** Full root history with per-entry validity (newest index last). */
  async fetchReputationRootHistory(): Promise<
    Array<{ index: number; root: Hex; valid: boolean }>
  > {
    return fetchRootHistory(
      this.publicClient,
      this.getReputationVerifierAddress(),
    );
  }

  /** On-chain view helper: verify proof without spending nullifier. */
  async verifyReputationProofView(args: VerifyReputationArgs): Promise<boolean> {
    return verifyReputationView(
      this.publicClient,
      this.getReputationVerifierAddress(),
      args,
    );
  }

  /** Simulate `verifyReputation` for gas / revert checks. */
  async simulateReputationVerification<
    TTransport extends Transport,
    TChain extends Chain,
    TAccount extends Account | undefined,
  >(
    wallet: WalletClient<TTransport, TChain, TAccount>,
    args: VerifyReputationArgs,
  ): Promise<void> {
    return simulateVerifyReputation(
      this.publicClient,
      wallet,
      this.getReputationVerifierAddress(),
      args,
    );
  }

  /** Broadcast `verifyReputation` (consumes nullifier when successful). */
  async submitReputationVerification<
    TTransport extends Transport,
    TChain extends Chain,
    TAccount extends Account | undefined,
  >(
    wallet: WalletClient<TTransport, TChain, TAccount>,
    args: VerifyReputationArgs,
  ): Promise<Hex> {
    return submitVerifyReputation(
      this.publicClient,
      wallet,
      this.getReputationVerifierAddress(),
      args,
    );
  }

  private getReputationVerifierAddress(): Address {
    if (!this.reputationVerifier) {
      throw new Error(
        "Opaque: opaqueReputationVerifier is not configured for this chain. Set contracts.opaqueReputationVerifier in OpaqueClient.create or use a bundled deployment.",
      );
    }
    return this.reputationVerifier;
  }

  /**
   * Deterministic scope string for reputation actions (`chainId:module:actionId`).
   * Same as {@link buildActionScope} in `@opaquecash/psr-core`.
   */
  static buildReputationActionScope = buildActionScope;

  /**
   * Map a scope string to the circuit `externalNullifier` scalar (keccak, uint256).
   * Same as {@link externalNullifierFromScope} in `@opaquecash/psr-core`.
   */
  static reputationExternalNullifierFromScope = externalNullifierFromScope;

  /**
   * Chain IDs that ship with bundled contract addresses in this SDK version.
   */
  static supportedChainIds(): number[] {
    return getSupportedChainIds();
  }

  /**
   * Read bundled deployment metadata (contracts, default tokens) for a chain.
   */
  static chainDeployment(
    chainId: number,
  ): OpaqueChainDeployment | undefined {
    return getChainDeploymentInfo(chainId);
  }
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function hexPayloadByteLength(h: Hex): number {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return s.length / 2;
}

function mergeTrackedTokens(
  base: TrackedToken[],
  extra: TrackedToken[],
): TrackedToken[] {
  const map = new Map<string, TrackedToken>();
  for (const t of base) {
    map.set(t.address.toLowerCase(), t);
  }
  for (const t of extra) {
    map.set(t.address.toLowerCase(), t);
  }
  return [...map.values()];
}
