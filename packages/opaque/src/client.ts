import {
  type Account,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { EIP5564_SCHEME_SECP256K1 } from "@opaquecash/stealth-core";
import {
  stealthMetaAddressRegistryAbi,
  stealthAddressAnnouncerAbi,
  getStealthMetaAddress as readRegistryMetaAddress,
  EvmAdapter,
  erc20SweepAbi,
  sweepStealthNative,
  sweepStealthToken as sweepEvmStealthToken,
  stealthTokenSweepAbi,
  signStealthSweepAuthorization,
  signStealthTokenPermit,
  encodeSweepWithPermit,
  type StealthSweepAuthorization,
  type StealthPermitSignature,
} from "@opaquecash/stealth-chain";
import {
  SolanaAdapter,
  type SolanaAdapterConfig,
  deriveStealthSolanaAddress,
  deriveStealthSolanaAddressFromStealthPrivKey,
  fetchOnsMirrorRecord,
  fetchSnsTxtRecord,
  fetchOnsClaimStatus,
  fetchWormholeMessageFee,
  buildOnsClaimInstruction,
  buildOnsReconcileInstruction,
  buildSplTransferInstructions,
  resolveMintDecimals,
  getStealthTokenBalance,
  sweepStealthToken as sweepSolanaStealthToken,
  buildStealthTokenSweepTransaction,
  type OnsClaimStatus,
} from "@opaquecash/stealth-chain-solana";
import { getEvmDeployment, getOnsDeployment } from "@opaquecash/deployments";

/** Minimal write/read surface of the canonical OpaqueNameRegistry (spec/ONS.md §2). */
const onsNameRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      { name: "label", type: "string" },
      { name: "spendPubKey", type: "bytes" },
      { name: "viewPubKey", type: "bytes" },
    ],
    outputs: [{ name: "node", type: "bytes32" }],
  },
] as const;
import type { Announcement, ChainAdapter } from "@opaquecash/adapter";
import {
  checkAnnouncement,
  checkAnnouncementViewTag,
  encodeAttestationMetadata,
  initStealthWasm,
  reconstructSigningKey,
  scanAttestationsJson,
  scanAttestationsV2Json,
  type StealthWasmModule,
} from "@opaquecash/stealth-wasm";
import {
  attestationsToDiscoveredTraits,
  buildActionScope,
  encodeAttestationData,
  encodeV2AttestationMetadata,
  externalNullifierFromScope,
  fieldDefsToString,
  parseFieldDefs,
  randomNonce,
  v2AttestationsToDiscoveredTraits,
  type AttestationV2,
  type FieldDef,
  type ProofData,
  type SchemaV2,
  type V2Attestation,
} from "@opaquecash/psr-core";
import type { DiscoveredTrait } from "@opaquecash/psr-core";
import {
  fetchLatestValidRoot,
  fetchRootHistory,
  isRootValid,
  simulateVerifyReputation,
  submitVerifyReputation,
  verifyReputationView,
  requirePsrV2Config,
  fetchAllSchemas as evmFetchAllSchemas,
  fetchSchema as evmFetchSchema,
  fetchSchemasForWallet as evmFetchSchemasForWallet,
  fetchAttestationsIssuedBy as evmFetchAttestationsIssuedBy,
  isAuthorizedIssuer as evmIsAuthorizedIssuer,
  getCurrentBlock as evmGetCurrentBlock,
  registerSchema as evmRegisterSchema,
  addDelegate as evmAddDelegate,
  removeDelegate as evmRemoveDelegate,
  deprecateSchema as evmDeprecateSchema,
  attest as evmAttest,
  announceV2Attestation as evmAnnounceV2Attestation,
  type EvmPsrWriteClients,
  type VerifyReputationArgs,
} from "@opaquecash/psr-chain";
import {
  computeSchemaId as solanaComputeSchemaId,
  deriveSchemaPda,
  deriveAttestationPda,
  buildRegisterSchemaInstruction,
  buildAddDelegateInstruction,
  buildRemoveDelegateInstruction,
  buildDeprecateSchemaInstruction,
  buildAttestInstruction,
  fetchAllSchemas as solanaFetchAllSchemas,
  fetchAllAttestations as solanaFetchAllAttestations,
  fetchAttestationPda as solanaFetchAttestationPda,
  submitReputationProof as solanaSubmitReputationProof,
  type ParsedAttestationPda,
  type ParsedSchemaPda,
} from "@opaquecash/psr-chain-solana";
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
  buildAnnounceWithRelayRequest as uabBuildAnnounceWithRelayRequest,
  fetchCrossChainAnnouncements as uabFetchCrossChainAnnouncements,
  toIndexerAnnouncement as uabToIndexerAnnouncement,
  getUabDeployment,
} from "@opaquecash/uab";
import type { AnnounceWithRelayRequest, UabIndexerAnnouncement } from "@opaquecash/uab";
import {
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  viewOnlyMetaAddress,
  computeStealthAddressAndViewTag,
  recomputeStealthSendFromEphemeralPrivateKey,
  ephemeralPrivateKeyToCompressedPublicKey,
  generateRandomMetaAddress,
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
import { namehash, normalize as normalizeEnsName } from "viem/ens";
import {
  ipfsPathFromInput,
  isEnsNameInput,
  isEvmAddressInput,
  isOnsNameInput,
  isSnsNameInput,
  isSolanaPubkeyInput,
  META_ADDRESS_VALUE_PREFIX,
  OPAQUE_META_RECORD_KEY,
  parseMetaAddressValue,
  resolveEnsMetaAddress,
  resolveIpfsDidMetaAddress,
  resolveSnsMetaAddress,
  type ResolvedRecipient,
  type ResolveTransports,
} from "./resolve.js";
import {
  requestSetupSignature,
  selectSigner,
  type UnifiedSigner,
} from "./signer.js";
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

/** ERC-20 reads needed to build an EIP-2612 permit (token name + per-owner permit nonce). */
const ERC20_PERMIT_READ_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
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
  /**
   * Dynamic import URL for wasm-pack `cryptography.js`. Required for scanning, sweeping, trait
   * discovery, key reconstruction, and proof generation. **Optional** when you only use the PSR
   * admin API (schema/attestation management uses pure-JS DKSAP, no WASM); omitting it and then
   * calling a WASM-backed method throws a clear error.
   */
  wasmModuleSpecifier?: string;
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
    uabSender: Address;
    uabReceiver: Address;
    wormholeCore: Address;
    /** Gasless ERC-20 sweep forwarder (spec/relayer-market.md). */
    stealthTokenSweep: Address;
  }>;
  /**
   * Solana access for the unified {@link OpaqueClient.scan} inbox. Optional: only needed when
   * `scan({ chains })` includes `"solana"`. Pass a `connection`, `rpcUrl`, or `cluster`
   * (defaults to devnet). The viewing/spending keys are chain-neutral — no Solana identity required.
   */
  solana?: SolanaAdapterConfig;
  /**
   * EIP-1193 provider (e.g. `window.ethereum` or a wallet bridge) used to SIGN Ethereum PSR
   * writes (`createSchema`, `issueAttestation`, …). Reads never need it. Transactions are signed
   * by {@link ethereumAddress}; omit it for read-only / Solana-only usage.
   */
  ethereumProvider?: EIP1193Provider;
  /**
   * Pre-built viem `WalletClient` for Ethereum PSR writes (e.g. a backend issuer signing with a
   * `privateKeyToAccount`). Takes precedence over {@link ethereumProvider}; the account it carries
   * signs, so it should match {@link ethereumAddress}.
   */
  ethereumWalletClient?: WalletClient;
  /**
   * Solana wallet used to SIGN Solana PSR writes. `publicKey` is the issuer/authority; pass a
   * `@solana/web3.js` `PublicKey` or a base58 string. `signTransaction` matches the wallet-adapter
   * signature. Required only for Solana PSR writes.
   */
  solanaWallet?: {
    publicKey: PublicKey | string;
    signTransaction: (transaction: Transaction) => Promise<Transaction>;
  };
  /**
   * ENS read access for {@link OpaqueClient.resolveRecipient} of `*.eth` names
   * (CSAP §2.9 `com.opaque.meta` text record). Pass an ENS-capable viem `PublicClient`
   * (mainnet or Sepolia — the scan RPC usually is not), or inject a custom `getText`
   * reader (tests, alternative resolvers). Optional: only `*.eth` resolution needs it.
   */
  ens?: {
    client?: PublicClient;
    getText?: (name: string, key: string) => Promise<string | null>;
  };
  /**
   * IPFS access for {@link OpaqueClient.resolveRecipient} of `ipfs://` DID documents.
   * Defaults to public gateways over `globalThis.fetch`; inject `fetch` to mock or to
   * route through a local node / Helia gateway.
   */
  ipfs?: {
    gateways?: readonly string[];
    fetch?: typeof fetch;
  };
  /**
   * ONS (Opaque Name Service, spec/ONS.md) overrides for `*.opq.eth`-style names.
   * Defaults come from `@opaquecash/deployments` for {@link chainId} (testnet parent:
   * `opqtest.eth`). Resolution tries the Solana mirror PDA first (needs {@link solana}),
   * then falls back to the canonical OpaqueNameRegistry over {@link rpcUrl}.
   */
  ons?: {
    /** Parent name in force (lowercase, e.g. `"opq.eth"`). */
    parentName?: string;
    /** Canonical OpaqueNameRegistry address (ENSIP-10 wildcard resolver). */
    registry?: Address;
    /** `ons-mirror` program id (base58) on the configured Solana cluster. */
    mirrorProgram?: string;
  };
  /**
   * SNS read access for `.sol` recipients (CSAP §2.9 TXT record). Defaults to the
   * bundled Records V2 TXT reader over the {@link solana} connection; inject
   * `getRecord` to mock or to use a custom record key/source.
   */
  sns?: {
    getRecord?: (domain: string, key: string) => Promise<string | null>;
  };
}

/** Chains the PSR admin API ({@link OpaqueClient.createSchema} etc.) targets. */
export type PsrChain = OpaqueScanChain;

/** Options for V2 schema-bound trait discovery. */
export interface DiscoverTraitsV2Options {
  /** Chain whose native PSR schema registry should authorize announcements. */
  chain: PsrChain;
  /** Optional pre-fetched registry snapshot. If omitted, the client fetches all schemas. */
  schemas?: SchemaV2[];
  /** Current block/slot for schema expiry checks. If omitted, it is read from the chain. */
  currentSlot?: number | bigint;
  /** Optional allowlist of trusted issuer identities (hex or address/base58). */
  trustedIssuers?: string[];
}

/** Future block (Ethereum) / slot (Solana) for a schema or attestation expiry. */
export interface PsrExpiryInput {
  /** Absolute Ethereum block number or Solana slot. Takes precedence over {@link dateTime}. */
  slotOrBlock?: number;
  /** ISO datetime; converted to a block (~12s/block) or slot (~400ms/slot) at call time. */
  dateTime?: string;
}

/** Parameters for {@link OpaqueClient.createSchema}. */
export interface CreateSchemaParams {
  /** Human-readable schema name (part of the `schemaId` preimage). */
  name: string;
  /** ABI-style string (`"bool passed, u64 score"`) or {@link FieldDef}s — normalized internally. */
  fieldDefinitions: string | FieldDef[];
  /** Whether issued attestations can be revoked (immutable after creation). */
  revocable: boolean;
  /** Optional resolver: EVM address or Solana program pubkey. Omit for none. */
  resolver?: string;
  /** Optional schema expiry. */
  schemaExpiry?: PsrExpiryInput;
}

/** Parameters for {@link OpaqueClient.issueAttestation}. */
export interface IssueAttestationParams {
  /** Target schema id (`0x`-hex bytes32). */
  schemaId: string;
  /** 66-byte meta-address, 20-byte stealth address, or 32-byte `stealth_address_hash` (hex). */
  recipient: string;
  /** Field values keyed by field name — must match the schema's `fieldDefinitions`. */
  fieldValues: Record<string, string>;
  /** Optional attestation expiry. */
  expiration?: PsrExpiryInput;
  /** Optional reference uid (chained credential). */
  refUid?: string;
  /**
   * Publish a discovery announcement after issuance. Defaults to `true` when `recipient` is a
   * meta-address (only then is an ephemeral key available). No-op for raw-hash recipients.
   */
  announce?: boolean;
}

/** Result of a PSR write that only returns a transaction id. */
export interface PsrTxResult {
  /** EVM `0x` tx hash or Solana base58 signature. */
  txHash: string;
}

/** Result of {@link OpaqueClient.createSchema}. */
export interface CreateSchemaResult extends PsrTxResult {
  /** Derived `schemaId` (`0x`-hex bytes32). */
  schemaId: string;
}

/** Result of {@link OpaqueClient.issueAttestation}. */
export interface IssueAttestationResult extends PsrTxResult {
  /** Attestation uid (`0x`-hex bytes32). */
  uid: string;
  /** The 32-byte `stealth_address_hash` the attestation is bound to (`0x`-hex). */
  stealthAddressHash: string;
}

/** Chains the unified {@link OpaqueClient.scan} can read. */
export type OpaqueScanChain = "ethereum" | "solana";

/** One owned stealth output from the unified inbox, tagged with its source chain. */
export interface UnifiedOwnedOutput extends OwnedStealthOutput {
  /** Source chain of this output. */
  chain: OpaqueScanChain;
  /** Wormhole chain id of the source (Ethereum = 2, Solana = 1). */
  chainId: number;
  /**
   * How the announcement was discovered: `"native"` (the chain's own announcer) or `"uab"`
   * (relayed cross-chain over Wormhole and re-emitted by the UABReceiver).
   */
  source: "native" | "uab";
}

/** Parameters for {@link OpaqueClient.sendStealthPayment}. */
export interface SendStealthPaymentParams {
  /** Chain to send on. */
  chain: OpaqueScanChain;
  /**
   * Recipient: a 66-byte meta-address hex (used directly), a Solana base58 pubkey, or an
   * Ethereum `0x` address — the latter two are resolved through the chain's registry.
   */
  recipient: string;
  /**
   * Amount in base units: lamports / wei for the native asset, or the token's smallest unit
   * (raw, decimals-aware) when `token` is set.
   */
  amount: bigint;
  /**
   * SPL mint (base58) or ERC-20 address (`0x`) to send; omit for the native asset. The recipient
   * receives the token at the stealth address (EVM) or that account's associated token account
   * (Solana); the announcement is identical to a native send.
   */
  token?: string;
  /**
   * Optional native top-up sent to the stealth address alongside a token send, so the recipient
   * has gas to move the token later without a relayer. Wei (Ethereum) or lamports (Solana).
   * Ignored for native sends.
   */
  gasDrop?: bigint;
  /** Publish the discovery announcement (default `true`). */
  announce?: boolean;
  /** Also relay the announcement cross-chain over Wormhole (default `false`). */
  relay?: boolean;
  /** Solana Wormhole nonce (`batch_id`) when `relay` is set. */
  batchId?: number;
  /**
   * Anonymity-set utility (guide §17): decouple send time from announce time. When set,
   * the value transfer is submitted immediately but the announcement is submitted only
   * after this many milliseconds, breaking the timing correlation between the two.
   * The result's `announcePromise` resolves to the announce tx id — await (or attach a
   * handler to) it, or the delayed announce dies with your process.
   */
  delayAnnouncement?: number;
}

/** Result of {@link OpaqueClient.sendStealthPayment}. */
export interface SendStealthPaymentResult {
  chain: OpaqueScanChain;
  /** Transfer tx id (Solana bundles the announce in the same tx unless delayed). */
  txHash: string;
  /** Separate announce tx id (Ethereum submits transfer + announce as two txs). */
  announceTxHash?: string;
  /**
   * Pending announce tx id when `delayAnnouncement` was set: resolves after the delay
   * elapses and the announcement confirms. Undefined for immediate announcements.
   */
  announcePromise?: Promise<string>;
  /** EVM-style 20-byte scanner address the recipient will detect. */
  stealthAddress: Address;
  /** Solana destination account (base58) the funds were sent to. */
  destination?: string;
  /** 33-byte compressed ephemeral public key (hex). */
  ephemeralPublicKey: Hex;
  /** Resolved 66-byte recipient meta-address. */
  metaAddressHex: Hex;
}

/** Native balance of one owned stealth output, resolved per chain. */
export interface OutputBalance {
  chain: OpaqueScanChain;
  /** EVM-style 20-byte scanner address the announcement was matched on. */
  stealthAddress: string;
  /**
   * Account actually holding the funds: the same address on Ethereum, or the derived Solana
   * stealth account (base58) on Solana.
   */
  address: string;
  /** Native balance in base units (wei on Ethereum, lamports on Solana). */
  nativeRaw: bigint;
}

/** Balance of one token at one owned stealth output. */
export interface OutputTokenBalance {
  chain: OpaqueScanChain;
  /** EVM-style 20-byte scanner address the announcement was matched on. */
  stealthAddress: string;
  /** Account holding the token: the stealth address (Ethereum) or its derived account (Solana). */
  address: string;
  /** ERC-20 contract address (Ethereum) or SPL mint (Solana base58). */
  token: string;
  /** Balance in the token's smallest unit. */
  raw: bigint;
}

/** A relayer-submittable EVM gasless sweep: any relayer sends `data` to `to` and earns the fee. */
export interface EvmGaslessSweep {
  chain: "ethereum";
  /** Forwarder address to call. */
  to: Address;
  /** `sweepWithPermit` calldata (owner-signed authorization + EIP-2612 permit). */
  data: Hex;
  authorization: StealthSweepAuthorization;
  ownerSig: Hex;
  permit: StealthPermitSignature;
}

/** A relayer-submittable Solana gasless sweep: the relayer co-signs as fee payer and submits. */
export interface SolanaGaslessSweep {
  chain: "solana";
  /** Base64 transaction, partially signed by the stealth key; the relayer signs as fee payer. */
  transactionBase64: string;
  /** Relayer fee payer the transaction was built for. */
  feePayer: string;
  /** Token amount being swept (full balance, raw units). */
  amount: bigint;
}

/** Discriminated result of {@link OpaqueClient.buildGaslessTokenSweep}. */
export type GaslessSweep = EvmGaslessSweep | SolanaGaslessSweep;

/** A cross-chain `announceWithRelay` built for Ethereum (submit `{to,data,value}` via wallet). */
export interface EvmAnnounceWithRelayResult {
  chain: "ethereum";
  to: Address;
  data: Hex;
  /** Wormhole message fee (wei) to send as `value`. */
  value: bigint;
  chainId: number;
}

/** A cross-chain `announce_with_relay` built for Solana (sign with the wallet + extra signers). */
export interface SolanaAnnounceWithRelayResult {
  chain: "solana";
  instructions: TransactionInstruction[];
  /** Extra signers (the fresh Wormhole message keypair) that must co-sign with the wallet. */
  signers: Keypair[];
}

/** Discriminated result of {@link OpaqueClient.buildAnnounceWithRelay}. */
export type AnnounceWithRelayResult =
  | EvmAnnounceWithRelayResult
  | SolanaAnnounceWithRelayResult;

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
  /**
   * Uncompressed (65-byte) stealth public-key point. Needed to derive the Solana destination
   * account (`deriveStealthSolanaAddress`); not required for the EVM `announce`.
   */
  stealthPubKey: Uint8Array;
}

/**
 * Result of {@link OpaqueClient.prepareGhostReceive} — same shape as {@link PrepareStealthSendResult},
 * keyed to your own meta-address for receive-without-prior-announcement flows.
 */
export type PrepareGhostReceiveResult = PrepareStealthSendResult;

/**
 * One decoy announcement from {@link OpaqueClient.generateDummyAnnouncements}: a valid
 * DKSAP derivation against a throwaway meta-address (included for inspection; its
 * private keys are already gone).
 */
export type DummyAnnouncement = PrepareStealthSendResult & { metaAddressHex: Hex };

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

/** Result of {@link OpaqueClient.registerMetaAddress}. */
export interface RegisterMetaAddressResult {
  /** Chain the meta-address was registered on. */
  chain: OpaqueScanChain;
  /** EVM `0x` tx hash or Solana base58 signature. */
  txHash: string;
  /** The 66-byte meta-address that was registered. */
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
  /** Spending private key. Undefined for a view-only client (scan-only, cannot spend). */
  private readonly spendingKey?: Uint8Array;
  private readonly spendPubKey: Uint8Array;
  private readonly metaAddressHex: Hex;
  private readonly publicClient: PublicClient;
  private readonly wasm: StealthWasmModule;
  private evmAdapter?: ChainAdapter;
  private solanaAdapter?: SolanaAdapter;
  private evmWalletClientCache?: WalletClient;
  private solanaWalletCache?: {
    publicKey: PublicKey;
    signTransaction: (transaction: Transaction) => Promise<Transaction>;
  };

  private constructor(
    config: OpaqueClientConfig,
    deployment: OpaqueChainDeployment,
    wasm: StealthWasmModule,
    keys: {
      viewingKey: Uint8Array;
      spendingKey?: Uint8Array;
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
    const wasm = config.wasmModuleSpecifier
      ? await initStealthWasm({ moduleSpecifier: config.wasmModuleSpecifier })
      : wasmUnavailable();
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

  /**
   * Construct a view-only client (CSAP §2.8 watch-only delegation) from the viewing PRIVATE key and
   * the spending PUBLIC key. It can {@link scan}, {@link filterOwnedAnnouncements}, and read
   * balances, but cannot spend: {@link sweep}, {@link getStealthSignerPrivateKey}, and reputation
   * key reconstruction throw. This is the safe shape for a server-side scanner — a compromised
   * server can read the inbox but can never move funds. Never give a server the spending key.
   *
   * `config` omits `walletSignature` since no keys are derived here. Pass keys as `0x` hex or bytes.
   */
  static async createViewOnly(
    config: Omit<OpaqueClientConfig, "walletSignature">,
    keys: { viewingKey: Hex | Uint8Array; spendPublicKey: Hex | Uint8Array },
  ): Promise<OpaqueClient> {
    const deployment = requireChainDeployment(config.chainId);
    const wasm = config.wasmModuleSpecifier
      ? await initStealthWasm({ moduleSpecifier: config.wasmModuleSpecifier })
      : wasmUnavailable();
    const viewingKey =
      typeof keys.viewingKey === "string" ? hexToBytes(keys.viewingKey) : keys.viewingKey;
    const spendPubKey =
      typeof keys.spendPublicKey === "string"
        ? hexToBytes(keys.spendPublicKey)
        : keys.spendPublicKey;
    const { metaAddress } = viewOnlyMetaAddress(viewingKey, spendPubKey);
    return new OpaqueClient(
      { ...config, walletSignature: "0x" as Hex },
      deployment,
      wasm,
      {
        viewingKey,
        spendPubKey,
        metaAddressHex: stealthMetaAddressToHex(metaAddress),
      },
    );
  }

  /** True for a {@link createViewOnly} client: scanning works, spending/sweeping throws. */
  get isViewOnly(): boolean {
    return this.spendingKey === undefined;
  }

  private requireSpendingKey(): Uint8Array {
    if (!this.spendingKey) {
      throw new Error(
        "Opaque: view-only client has no spending key; it can scan but cannot spend or sweep. " +
          "Use create() / fromWallet() with the spending key to move funds.",
      );
    }
    return this.spendingKey;
  }

  /**
   * Construct a client from wallet(s) in the {@link UnifiedSigner} shape — the
   * one-adapter entry point for integrators (Phase 2.5). Pass at most one wallet per
   * chain; the FIRST wallet is prompted for the {@link SETUP_MESSAGE} setup signature
   * (HKDF entropy) unless a cached `walletSignature` is supplied. Each wallet is also
   * wired as that chain's write signer (`ethereumProvider`/`ethereumWalletClient`,
   * `solanaWallet`), so PSR writes and sends work without further config.
   */
  static async fromWallet(
    params: Omit<
      OpaqueClientConfig,
      | "walletSignature"
      | "ethereumAddress"
      | "ethereumProvider"
      | "ethereumWalletClient"
      | "solanaWallet"
    > & {
      /** One wallet (or one per chain) in unified shape. */
      wallets: UnifiedSigner | UnifiedSigner[];
      /** Cached setup signature; skips the wallet prompt when present. */
      walletSignature?: Hex;
    },
  ): Promise<OpaqueClient> {
    const { wallets, walletSignature, ...rest } = params;
    const list = Array.isArray(wallets) ? wallets : [wallets];
    if (list.length === 0 && !walletSignature) {
      throw new Error(
        "Opaque: fromWallet needs at least one wallet (or a cached walletSignature).",
      );
    }
    const evm = selectSigner(list, "ethereum");
    const solana = selectSigner(list, "solana");
    const signature = walletSignature ?? (await requestSetupSignature(list[0]));
    return OpaqueClient.create({
      ...rest,
      walletSignature: signature,
      // Zero address keeps reads working for Solana-only sessions; never used for writes.
      ethereumAddress:
        evm?.address ?? ("0x0000000000000000000000000000000000000000" as Address),
      ethereumProvider: evm?.provider,
      ethereumWalletClient: evm?.walletClient,
      solanaWallet:
        solana?.signTransaction != null
          ? {
              publicKey: solana.publicKey,
              signTransaction: solana.signTransaction,
            }
          : undefined,
    });
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
   * Resolve ANY supported recipient identity to its 66-byte meta-address (CSAP §2.9):
   *
   * | Input | Path |
   * |-------|------|
   * | 66-byte meta-address (optionally `st:opq:`-prefixed) | validated and passed through |
   * | `0x…` 20-byte EVM address | ERC-6538 `StealthMetaAddressRegistry` |
   * | Solana base58 pubkey | `stealth-registry` PDA (needs {@link OpaqueClientConfig.solana}) |
   * | `ipfs://…` / bare CID | DID document fetch via gateways (configure {@link OpaqueClientConfig.ipfs}) |
   * | ONS name (`alice.opq.eth`) | Solana mirror PDA first, canonical OpaqueNameRegistry fallback (spec/ONS.md) |
   * | other `*.eth` | ENS `com.opaque.meta` text record (needs {@link OpaqueClientConfig.ens}) |
   * | `*.sol` | SNS Records V2 TXT record (needs {@link OpaqueClientConfig.solana} or `sns.getRecord`) |
   *
   * Every path point-validates both 33-byte halves before returning. Throws with a
   * path-specific message when the identity is unregistered, unset, or malformed.
   */
  async resolveRecipient(input: string): Promise<ResolvedRecipient> {
    const trimmed = input.trim();
    if (
      trimmed.startsWith(META_ADDRESS_VALUE_PREFIX) ||
      /^(0x)?[0-9a-fA-F]{132}$/.test(trimmed)
    ) {
      const meta = parseMetaAddressValue(trimmed);
      if (!meta) {
        throw new Error(
          "Opaque: recipient looks like a meta-address but failed validation (both 33-byte halves must be valid compressed secp256k1 points).",
        );
      }
      return { metaAddressHex: meta, source: "meta-address", input: trimmed };
    }
    const cidPath = ipfsPathFromInput(trimmed);
    if (cidPath) {
      const meta = await resolveIpfsDidMetaAddress(cidPath, this.resolveTransports());
      return { metaAddressHex: meta, source: "ipfs-did", input: trimmed };
    }
    if (isEnsNameInput(trimmed)) {
      const onsParent = this.onsParentName();
      if (onsParent && isOnsNameInput(trimmed, onsParent)) {
        return this.resolveOnsName(trimmed.toLowerCase());
      }
      const meta = await resolveEnsMetaAddress(trimmed, this.resolveTransports());
      return { metaAddressHex: meta, source: "ens-text", input: trimmed };
    }
    if (isSnsNameInput(trimmed)) {
      const meta = await resolveSnsMetaAddress(trimmed.toLowerCase(), this.snsGetRecord());
      return { metaAddressHex: meta, source: "sns-record", input: trimmed };
    }
    if (isEvmAddressInput(trimmed)) {
      const res = await this.resolveRecipientMetaAddress(trimmed as Address);
      if (!res.registered || !res.metaAddressHex) {
        throw new Error(
          `Opaque: ${trimmed} has no registered meta-address on Ethereum.`,
        );
      }
      return {
        metaAddressHex: res.metaAddressHex,
        source: "evm-registry",
        input: trimmed,
      };
    }
    if (isSolanaPubkeyInput(trimmed)) {
      const meta = await this.getSolanaAdapter().resolveMetaAddress(trimmed);
      if (!meta) {
        throw new Error(
          `Opaque: ${trimmed} has no registered meta-address on Solana.`,
        );
      }
      return { metaAddressHex: meta, source: "solana-registry", input: trimmed };
    }
    throw new Error(
      `Opaque: unrecognised recipient "${trimmed}" (expected a meta-address, EVM address, Solana pubkey, ipfs:// CID, or *.eth name).`,
    );
  }

  /**
   * Resolve an Opaque Name Service name (`alice.opq.eth`; `alice.opqtest.eth` on
   * testnet) to its meta-address (spec/ONS.md §7). Tries the Solana mirror PDA first
   * (one account read, no Ethereum RPC — needs {@link OpaqueClientConfig.solana});
   * falls back to the canonical OpaqueNameRegistry (ENSIP-10) over the scan RPC.
   * Both paths point-validate the 33-byte halves. Mirror records lag the canonical
   * record by Wormhole latency (eventually consistent, canonical-chain-wins).
   */
  async resolveOpaqueMetaAddress(name: string): Promise<Hex> {
    const { metaAddressHex } = await this.resolveOnsName(name.trim().toLowerCase());
    return metaAddressHex;
  }

  /** ONS resolution: mirror-PDA-first, canonical-registry fallback. */
  private async resolveOnsName(name: string): Promise<ResolvedRecipient> {
    // 1. Solana mirror PDA (cheap, chain-local).
    if (this.config.solana) {
      try {
        const adapter = this.getSolanaAdapter();
        const mirrorProgram = this.config.ons?.mirrorProgram
          ? new PublicKey(this.config.ons.mirrorProgram)
          : adapter.deployment.onsMirror;
        const record = await fetchOnsMirrorRecord(adapter.connection, mirrorProgram, name);
        if (record) {
          const meta = parseMetaAddressValue(record.metaAddressHex);
          if (meta) return { metaAddressHex: meta, source: "ons-mirror", input: name };
        }
      } catch {
        // Mirror unavailable (RPC outage, cluster mismatch): fall through to canonical.
      }
    }
    // 2. Canonical OpaqueNameRegistry (ENSIP-10 wildcard resolver) on the EVM RPC.
    const registry =
      this.config.ons?.registry ?? getOnsDeployment(this.config.chainId)?.registry;
    if (!registry) {
      throw new Error(
        `Opaque: cannot resolve ${name} — no ONS mirror record and no OpaqueNameRegistry ` +
          `is known for chainId ${this.config.chainId} (pass config.ons.registry).`,
      );
    }
    const value = (await this.publicClient.readContract({
      address: registry,
      abi: [
        {
          type: "function",
          name: "text",
          stateMutability: "view",
          inputs: [
            { name: "node", type: "bytes32" },
            { name: "key", type: "string" },
          ],
          outputs: [{ name: "", type: "string" }],
        },
      ] as const,
      functionName: "text",
      args: [namehash(name), OPAQUE_META_RECORD_KEY],
    })) as string;
    const meta = value ? parseMetaAddressValue(value) : null;
    if (!meta) {
      throw new Error(`Opaque: ${name} is not registered with the Opaque Name Service.`);
    }
    return { metaAddressHex: meta, source: "ons-registry", input: name };
  }

  /** The ONS parent name in force (config override, else bundled deployment), if any. */
  private onsParentName(): string | undefined {
    return (
      this.config.ons?.parentName?.toLowerCase() ??
      getOnsDeployment(this.config.chainId)?.parentName
    );
  }

  /** The `.sol` record reader: injected, else the bundled Records V2 TXT reader. */
  private snsGetRecord():
    | ((domain: string, key: string) => Promise<string | null>)
    | undefined {
    if (this.config.sns?.getRecord) return this.config.sns.getRecord;
    if (!this.config.solana) return undefined;
    return (domain: string) =>
      fetchSnsTxtRecord(this.getSolanaAdapter().connection, domain);
  }

  /** Build the {@link ResolveTransports} from config (ENS reader + IPFS gateways). */
  private resolveTransports(): ResolveTransports {
    const ens = this.config.ens;
    const ensGetText =
      ens?.getText ??
      (ens?.client
        ? (name: string, key: string) =>
            ens.client!.getEnsText({ name: normalizeEnsName(name), key })
        : undefined);
    return {
      ensGetText,
      ipfsGateways: this.config.ipfs?.gateways,
      fetchFn: this.config.ipfs?.fetch,
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
   * Register THIS wallet's 66-byte meta-address on-chain so others can resolve it, dispatching on
   * `chain`. Submits the transaction with the configured signer (`ethereumWalletClient` /
   * `ethereumProvider` for Ethereum, `solanaWallet` for Solana) and returns the tx id. For a
   * calldata-only request you submit yourself, see {@link buildRegisterMetaAddressTransaction}
   * (Ethereum) or `SolanaAdapter.buildRegisterKeysInstruction`.
   */
  async registerMetaAddress(chain: OpaqueScanChain): Promise<RegisterMetaAddressResult> {
    const schemeId = BigInt(EIP5564_SCHEME_SECP256K1);
    if (chain === "ethereum") {
      const wc = this.evmWalletClient();
      const txHash = await wc.writeContract({
        address: this.registry,
        abi: stealthMetaAddressRegistryAbi,
        functionName: "registerKeys",
        args: [schemeId, this.metaAddressHex],
        account: this.config.ethereumAddress,
        chain: wc.chain ?? this.viemChain(),
      });
      return { chain, txHash, metaAddressHex: this.metaAddressHex };
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const ix = this.getSolanaAdapter().buildRegisterKeysInstruction(
        wallet.publicKey,
        hexToBytes(this.metaAddressHex),
        schemeId,
      );
      const txHash = await this.sendSolanaTx([ix]);
      return { chain, txHash, metaAddressHex: this.metaAddressHex };
    }
    throw new Error(`Opaque: unsupported register chain "${chain as string}"`);
  }

  /**
   * Whether THIS wallet's meta-address is already registered on `chain` (Ethereum reads its
   * configured `ethereumAddress`; Solana reads the `solanaWallet` pubkey).
   */
  async isMetaAddressRegistered(chain: OpaqueScanChain): Promise<boolean> {
    if (chain === "ethereum") {
      const res = await this.resolveRecipientMetaAddress(this.config.ethereumAddress);
      return res.registered;
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      return this.getSolanaAdapter().isRegistered(wallet.publicKey.toBase58());
    }
    throw new Error(`Opaque: unsupported register chain "${chain as string}"`);
  }

  // ------------------------------------------------------------------ ONS names

  /**
   * Register `label.parent` for THIS wallet's meta-address on the canonical
   * OpaqueNameRegistry (Ethereum; spec/ONS.md §4.1). Immediately authoritative;
   * the Solana mirror follows after Wormhole relay. Submits with the configured
   * Ethereum signer and returns the tx hash.
   */
  async registerOpaqueName(label: string): Promise<Hex> {
    const registry = this.requireOnsRegistry();
    const { spendPubKey, viewPubKey } = this.ownMetaAddressHalves();
    const wc = this.evmWalletClient();
    return wc.writeContract({
      address: registry,
      abi: onsNameRegistryAbi,
      functionName: "register",
      args: [label.toLowerCase(), spendPubKey, viewPubKey],
      account: this.config.ethereumAddress,
      chain: wc.chain ?? this.viemChain(),
    });
  }

  /**
   * Claim `label.parent` from Solana (spec/ONS.md §4.2). Creates a PROVISIONAL
   * claim and publishes it to the canonical registry via Wormhole; it becomes
   * authoritative only when the registry confirms (mirror record appears), and it
   * loses to any concurrent direct Ethereum registration. Track with
   * {@link getOpaqueNameStatus}; surface `pending` in UI (never as owned).
   */
  async claimOpaqueName(label: string): Promise<{ signature: string; name: string }> {
    const parentName = this.requireOnsParentName();
    const adapter = this.getSolanaAdapter();
    const wallet = this.requireSolanaWallet();
    const { spendPubKey, viewPubKey } = this.ownMetaAddressHalves();
    const message = Keypair.generate();
    const fee = await fetchWormholeMessageFee(
      adapter.connection,
      adapter.deployment.wormholeCore,
    );
    const ix = buildOnsClaimInstruction({
      registrationProgramId: this.onsRegistrationProgram(),
      wormholeCore: adapter.deployment.wormholeCore,
      claimer: wallet.publicKey,
      label,
      parentName,
      spendPubKey: hexToBytes(spendPubKey),
      viewPubKey: hexToBytes(viewPubKey),
      wormholeMessage: message.publicKey,
      wormholeFee: fee,
    });
    const signature = await this.sendSolanaTx([ix], [message]);
    return { signature, name: `${label.toLowerCase()}.${parentName}` };
  }

  /**
   * Reconciliation state of an ONS name's Solana-originated claim
   * (`none`/`pending`/`confirmed`/`lost`/`expired`; spec/ONS.md §6), plus the
   * mirror record when one exists. Two Solana account reads.
   */
  async getOpaqueNameStatus(name: string): Promise<OnsClaimStatus> {
    const adapter = this.getSolanaAdapter();
    return fetchOnsClaimStatus(
      adapter.connection,
      this.onsRegistrationProgram(),
      this.onsMirrorProgram(),
      name.trim().toLowerCase(),
    );
  }

  /**
   * Close a finished provisional claim (confirmed / lost / expired) and refund its
   * rent to the claimer. Permissionless; submits with the configured Solana wallet.
   */
  async reconcileOpaqueName(name: string): Promise<string> {
    const status = await this.getOpaqueNameStatus(name);
    if (!status.claim) throw new Error(`Opaque: no provisional claim for ${name}.`);
    const wallet = this.requireSolanaWallet();
    const ix = buildOnsReconcileInstruction({
      registrationProgramId: this.onsRegistrationProgram(),
      mirrorProgramId: this.onsMirrorProgram(),
      fullName: name.trim().toLowerCase(),
      claimer: status.claim.claimer,
      payer: wallet.publicKey,
    });
    return this.sendSolanaTx([ix]);
  }

  /** The ONS parent name in force, or throw with setup guidance. */
  private requireOnsParentName(): string {
    const parent = this.onsParentName();
    if (!parent) {
      throw new Error(
        `Opaque: no ONS deployment is known for chainId ${this.config.chainId} ` +
          "(pass config.ons.parentName).",
      );
    }
    return parent;
  }

  private requireOnsRegistry(): Address {
    const registry =
      this.config.ons?.registry ?? getOnsDeployment(this.config.chainId)?.registry;
    if (!registry) {
      throw new Error(
        `Opaque: no OpaqueNameRegistry is known for chainId ${this.config.chainId} ` +
          "(pass config.ons.registry).",
      );
    }
    return registry;
  }

  private onsMirrorProgram(): PublicKey {
    return this.config.ons?.mirrorProgram
      ? new PublicKey(this.config.ons.mirrorProgram)
      : this.getSolanaAdapter().deployment.onsMirror;
  }

  private onsRegistrationProgram(): PublicKey {
    return this.getSolanaAdapter().deployment.onsRegistration;
  }

  /** Split this wallet's meta-address (CSAP V‖S) into its 33-byte halves. */
  private ownMetaAddressHalves(): { spendPubKey: Hex; viewPubKey: Hex } {
    const hex = this.metaAddressHex.slice(2);
    return {
      viewPubKey: `0x${hex.slice(0, 66)}` as Hex,
      spendPubKey: `0x${hex.slice(66, 132)}` as Hex,
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
      stealthPubKey: r.stealthPubKeyUncompressed,
    };
  }

  /**
   * High-level send: resolve the recipient, derive a one-time stealth destination, transfer the
   * native asset, and publish the discovery announcement — in one call, dispatching on `chain`.
   *
   * Solana bundles the transfer and `announce` (or `announce_with_relay` when `relay` is set) into a
   * single transaction and returns its signature. Ethereum submits the value transfer first, then
   * the announce, returning both tx hashes. Set `token` to send an SPL mint / ERC-20 instead of the
   * native asset (the announcement is unchanged); `gasDrop` optionally tops the stealth address up
   * with native gas so the recipient can move the token without a relayer.
   * Requires the chain's signer (`solanaWallet` / `ethereumWalletClient` or `ethereumProvider`).
   */
  async sendStealthPayment(
    params: SendStealthPaymentParams,
  ): Promise<SendStealthPaymentResult> {
    const metaAddressHex = await this.resolveSendRecipientMeta(
      params.chain,
      params.recipient,
    );
    const send = this.prepareStealthSend(metaAddressHex);
    const ephemeralPublicKey = bytesToHex0x(send.ephemeralPublicKey);
    const wantAnnounce = params.announce ?? true;

    if (params.chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const adapter = this.getSolanaAdapter();
      const destination = deriveStealthSolanaAddress(send.stealthPubKey);
      const transferIxs: TransactionInstruction[] = [];
      if (params.token) {
        const decimals = await resolveMintDecimals(adapter.connection, params.token);
        transferIxs.push(
          ...buildSplTransferInstructions({
            payer: wallet.publicKey,
            sourceOwner: wallet.publicKey,
            destinationOwner: destination,
            mint: params.token,
            amount: params.amount,
            decimals,
          }),
        );
        if (params.gasDrop != null && params.gasDrop > 0n) {
          transferIxs.push(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: new PublicKey(destination),
              lamports: params.gasDrop,
            }),
          );
        }
      } else {
        transferIxs.push(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(destination),
            lamports: params.amount,
          }),
        );
      }
      const buildAnnounceIxs = async (): Promise<{
        ixs: TransactionInstruction[];
        signers: Keypair[];
      }> => {
        if (params.relay) {
          const wormholeFee = await adapter.fetchWormholeMessageFee();
          const { instruction, messageKeypair } = adapter.buildAnnounceWithRelay({
            caller: wallet.publicKey,
            stealthAddress: hexToBytes(send.stealthAddress),
            ephemeralPubKey: send.ephemeralPublicKey,
            metadata: send.metadata,
            schemeId: send.schemeId,
            batchId: params.batchId,
            wormholeFee,
          });
          return { ixs: [instruction], signers: [messageKeypair] };
        }
        return {
          ixs: [
            adapter.buildAnnounceInstruction({
              caller: wallet.publicKey,
              stealthAddress: hexToBytes(send.stealthAddress),
              ephemeralPubKey: send.ephemeralPublicKey,
              metadata: send.metadata,
              schemeId: send.schemeId,
            }),
          ],
          signers: [],
        };
      };
      const wantsAnyAnnounce = params.relay || wantAnnounce;
      if (params.delayAnnouncement != null && wantsAnyAnnounce) {
        const txHash = await this.sendSolanaTx(transferIxs);
        const announcePromise = (async () => {
          await sleep(params.delayAnnouncement!);
          const { ixs, signers } = await buildAnnounceIxs();
          return this.sendSolanaTx(ixs, signers);
        })();
        return {
          chain: "solana",
          txHash,
          announcePromise,
          stealthAddress: send.stealthAddress,
          destination,
          ephemeralPublicKey,
          metaAddressHex,
        };
      }
      const ixs: TransactionInstruction[] = [...transferIxs];
      const extraSigners: Keypair[] = [];
      if (wantsAnyAnnounce) {
        const announce = await buildAnnounceIxs();
        ixs.push(...announce.ixs);
        extraSigners.push(...announce.signers);
      }
      const txHash = await this.sendSolanaTx(ixs, extraSigners);
      return {
        chain: "solana",
        txHash,
        stealthAddress: send.stealthAddress,
        destination,
        ephemeralPublicKey,
        metaAddressHex,
      };
    }

    if (params.chain === "ethereum") {
      const wc = this.evmWalletClient() as WalletClient<
        Transport,
        Chain,
        Account | undefined
      >;
      const viemChain = wc.chain ?? this.viemChain();
      let txHash: string;
      if (params.token) {
        if (params.gasDrop != null && params.gasDrop > 0n) {
          await wc.sendTransaction({
            account: this.config.ethereumAddress,
            chain: viemChain,
            to: send.stealthAddress,
            value: params.gasDrop,
          });
        }
        txHash = await wc.sendTransaction({
          account: this.config.ethereumAddress,
          chain: viemChain,
          to: getAddress(params.token),
          data: encodeFunctionData({
            abi: erc20SweepAbi,
            functionName: "transfer",
            args: [send.stealthAddress, params.amount],
          }),
        });
      } else {
        txHash = await wc.sendTransaction({
          account: this.config.ethereumAddress,
          chain: viemChain,
          to: send.stealthAddress,
          value: params.amount,
        });
      }
      const submitAnnounce = async (): Promise<string> => {
        if (params.relay) {
          const req = await this.buildAnnounceWithRelayRequest(send);
          return wc.sendTransaction({
            account: this.config.ethereumAddress,
            chain: viemChain,
            to: req.to,
            data: req.data,
            value: req.value,
          });
        }
        const req = this.buildAnnounceTransactionRequest(send);
        return wc.sendTransaction({
          account: this.config.ethereumAddress,
          chain: viemChain,
          to: req.to,
          data: req.data,
        });
      };
      const wantsAnyAnnounce = params.relay || wantAnnounce;
      if (params.delayAnnouncement != null && wantsAnyAnnounce) {
        const announcePromise = (async () => {
          await sleep(params.delayAnnouncement!);
          return submitAnnounce();
        })();
        return {
          chain: "ethereum",
          txHash,
          announcePromise,
          stealthAddress: send.stealthAddress,
          ephemeralPublicKey,
          metaAddressHex,
        };
      }
      let announceTxHash: string | undefined;
      if (wantsAnyAnnounce) {
        announceTxHash = await submitAnnounce();
      }
      return {
        chain: "ethereum",
        txHash,
        announceTxHash,
        stealthAddress: send.stealthAddress,
        ephemeralPublicKey,
        metaAddressHex,
      };
    }
    throw new Error(`Opaque: unsupported send chain "${params.chain as string}"`);
  }

  /**
   * Resolve a {@link SendStealthPaymentParams.recipient} to a 66-byte meta-address.
   * Delegates to {@link resolveRecipient}, so sends accept every supported identity
   * form (meta-address, registry address/pubkey, `ipfs://` DID, `*.eth`) on any chain —
   * meta-addresses are chain-neutral.
   */
  private async resolveSendRecipientMeta(
    _chain: OpaqueScanChain,
    recipient: string,
  ): Promise<Hex> {
    const resolved = await this.resolveRecipient(recipient);
    return resolved.metaAddressHex;
  }

  /**
   * Anonymity-set utility (guide §17): mint `n` decoy announcements. Each one is a fully
   * valid DKSAP announcement to a freshly generated THROWAWAY meta-address whose private
   * keys are discarded — on-chain it is indistinguishable from a real payment
   * announcement (valid curve points, correctly derived view tag), but nobody will ever
   * match or spend it. Submit them (e.g. via {@link buildDummyAnnouncementTransactions})
   * interleaved with real sends to grow every recipient's anonymity set.
   */
  generateDummyAnnouncements(n: number): DummyAnnouncement[] {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("Opaque: generateDummyAnnouncements needs a non-negative integer count.");
    }
    return Array.from({ length: n }, () => {
      const metaAddressHex = generateRandomMetaAddress();
      return { ...this.prepareStealthSend(metaAddressHex), metaAddressHex };
    });
  }

  /**
   * Convenience over {@link generateDummyAnnouncements}: `n` ready-to-submit `announce`
   * calldata requests for this chain's announcer. Broadcast them from any account —
   * announcements carry no value and any caller may announce.
   */
  buildDummyAnnouncementTransactions(n: number): AnnounceTransactionRequest[] {
    return this.generateDummyAnnouncements(n).map((d) =>
      this.buildAnnounceTransactionRequest(d),
    );
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
      stealthPubKey: r.stealthPubKeyUncompressed,
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

  // ---------------------------------------------------------------------------
  // Universal Announcement Bus (cross-chain announcements over Wormhole)
  // ---------------------------------------------------------------------------

  /** Resolve UAB addresses for this chain (config override takes precedence over the known deployment). */
  private uabAddresses(): {
    uabSender: Address;
    uabReceiver: Address;
    wormholeCore: Address;
    fromBlock: bigint;
  } {
    const d = getUabDeployment(this.config.chainId);
    const uabSender = this.config.contracts?.uabSender ?? d?.uabSender;
    const uabReceiver = this.config.contracts?.uabReceiver ?? d?.uabReceiver;
    const wormholeCore = this.config.contracts?.wormholeCore ?? d?.wormholeCore;
    if (!uabSender || !uabReceiver || !wormholeCore) {
      throw new Error(
        `UAB not configured for chainId ${this.config.chainId}; pass contracts.{uabSender,uabReceiver,wormholeCore}`,
      );
    }
    return { uabSender, uabReceiver, wormholeCore, fromBlock: d?.fromBlock ?? 0n };
  }

  /**
   * Build a `{to,data,value}` request for a CROSS-CHAIN announce (`announceWithRelay`): it emits the
   * local announcement AND publishes the 96-byte payload through Wormhole. `value` is the Wormhole
   * message fee. Pass the same {@link PrepareStealthSendResult} you'd use for a native announce.
   */
  async buildAnnounceWithRelayRequest(
    send: PrepareStealthSendResult,
    opts: { consistencyLevel?: number } = {},
  ): Promise<AnnounceWithRelayRequest & { chainId: number }> {
    const { uabSender, wormholeCore } = this.uabAddresses();
    const req = await uabBuildAnnounceWithRelayRequest(this.publicClient, {
      uabSender,
      wormholeCore,
      schemeId: send.schemeId,
      stealthAddress: send.stealthAddress,
      ephemeralPubKey: (`0x${bytesToHex(send.ephemeralPublicKey)}`) as Hex,
      metadata: (`0x${bytesToHex(send.metadata)}`) as Hex,
      consistencyLevel: opts.consistencyLevel,
    });
    return { ...req, chainId: this.config.chainId };
  }

  /**
   * Build a CROSS-CHAIN announce for either chain, dispatching on `chain`. Emits the local
   * announcement AND relays the 96-byte payload over Wormhole. Ethereum returns a `{to,data,value}`
   * request (`value` is the Wormhole fee); Solana returns `instructions` + extra `signers` (the
   * fresh Wormhole message keypair) — both must co-sign with the wallet. Pass the same
   * {@link PrepareStealthSendResult} you'd use for a native announce.
   *
   * EVM honours `consistencyLevel`; Solana honours `batchId` (Wormhole nonce) and `wormholeFee`
   * (auto-fetched from the core bridge when omitted; 0 on devnet).
   */
  async buildAnnounceWithRelay(
    chain: OpaqueScanChain,
    send: PrepareStealthSendResult,
    opts: { consistencyLevel?: number; batchId?: number; wormholeFee?: bigint } = {},
  ): Promise<AnnounceWithRelayResult> {
    if (chain === "ethereum") {
      const req = await this.buildAnnounceWithRelayRequest(send, {
        consistencyLevel: opts.consistencyLevel,
      });
      return {
        chain: "ethereum",
        to: req.to,
        data: req.data,
        value: req.value,
        chainId: req.chainId,
      };
    }
    if (chain === "solana") {
      const adapter = this.getSolanaAdapter();
      const caller = this.requireSolanaWallet().publicKey;
      const wormholeFee =
        opts.wormholeFee ?? (await adapter.fetchWormholeMessageFee());
      const { instruction, messageKeypair } = adapter.buildAnnounceWithRelay({
        caller,
        stealthAddress: hexToBytes(send.stealthAddress),
        ephemeralPubKey: send.ephemeralPublicKey,
        metadata: send.metadata,
        schemeId: send.schemeId,
        batchId: opts.batchId,
        wormholeFee,
      });
      return { chain: "solana", instructions: [instruction], signers: [messageKeypair] };
    }
    throw new Error(`Opaque: unsupported announce-with-relay chain "${chain as string}"`);
  }

  /**
   * Read inbound CROSS-CHAIN announcements (from the UABReceiver) as indexer-shaped rows, ready to
   * pass into {@link filterOwnedAnnouncements} alongside native rows.
   */
  async fetchCrossChainAnnouncements(
    opts: { fromBlock?: bigint; toBlock?: bigint | "latest" } = {},
  ): Promise<UabIndexerAnnouncement[]> {
    const { uabReceiver, fromBlock } = this.uabAddresses();
    const records = await uabFetchCrossChainAnnouncements(this.publicClient, {
      uabReceiver,
      fromBlock: opts.fromBlock ?? fromBlock,
      toBlock: opts.toBlock,
    });
    return records.map(uabToIndexerAnnouncement);
  }

  /** Discover stealth outputs owned by this user that arrived via the cross-chain UAB. */
  async scanCrossChain(
    opts: { fromBlock?: bigint; toBlock?: bigint | "latest" } = {},
  ): Promise<OwnedStealthOutput[]> {
    const rows = await this.fetchCrossChainAnnouncements(opts);
    return this.filterOwnedAnnouncements(rows);
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

      // Anyone can announce; skip rows whose ephemeral key is 33 bytes but not a valid
      // curve point (the WASM throws "Invalid public key" on them) instead of aborting.
      let ok = false;
      try {
        const tagResult = checkAnnouncementViewTag(this.wasm, vt, this.viewingKey, eph);
        if (tagResult === "NoMatch") continue;
        ok = checkAnnouncement(
          this.wasm,
          row.stealthAddress,
          vt,
          this.viewingKey,
          this.spendPubKey,
          eph,
        );
      } catch {
        continue;
      }
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

  // ---------------------------------------------------------------------------
  // Unified cross-chain inbox
  // ---------------------------------------------------------------------------

  /**
   * Scan one or more chains for stealth outputs owned by this wallet and return a single,
   * merged inbox. Each chain's native announcements are fetched through its {@link ChainAdapter}
   * and run through the same WASM view-tag + DKSAP filter ({@link filterOwnedAnnouncements}), so
   * detection is identical across chains. Outputs are tagged with their source `chain` / `chainId`.
   *
   * `"ethereum"` reuses this client's viem client + configured announcer/registry. `"solana"`
   * requires {@link OpaqueClientConfig.solana} (connection / rpcUrl / cluster; defaults to devnet).
   * The viewing/spending keys are chain-neutral, so one wallet's inbox spans both chains.
   */
  async scan(opts: {
    chains: OpaqueScanChain[];
    /** Lower-bound cursor: EVM block number (Solana scans the most recent signatures). */
    fromBlock?: bigint;
    /** Upper-bound EVM block; omit for the chain tip. */
    toBlock?: bigint;
    /** Max Solana signatures to scan (adapter default when omitted). */
    solanaLimit?: number;
    /**
     * Also merge cross-chain (UAB) announcements, tagged `source: "uab"`: on Ethereum, events
     * re-emitted by the EVM UABReceiver; on Solana, `CrossChainAnnouncement` events from the
     * `uab-receiver` program (merged by the adapter). Defaults to `true` wherever a UAB
     * deployment is configured; set `false` to skip, or `true` to force on the EVM side
     * (throws if UAB is unconfigured there).
     */
    includeCrossChain?: boolean;
  }): Promise<UnifiedOwnedOutput[]> {
    const out: UnifiedOwnedOutput[] = [];
    for (const chain of opts.chains) {
      const adapter = this.getAdapter(chain);
      const announcements = await adapter.fetchAnnouncements({
        fromCursor: opts.fromBlock,
        toCursor: opts.toBlock,
        limit: opts.solanaLimit,
        includeCrossChain: opts.includeCrossChain,
      });
      // Adapters may merge cross-chain (UAB) announcements relayed to their chain;
      // those keep their origin chainId, which distinguishes them from native ones.
      const native = announcements.filter((a) => a.chainId === adapter.chainId);
      const relayed = announcements.filter((a) => a.chainId !== adapter.chainId);
      for (const [list, source] of [
        [native, "native"],
        [relayed, "uab"],
      ] as const) {
        if (list.length === 0) continue;
        const rows = list.map(announcementToIndexerRow);
        const owned = await this.filterOwnedAnnouncements(rows);
        for (const o of owned) {
          out.push({ ...o, chain, chainId: adapter.chainId, source });
        }
      }
    }

    const uabConfigured =
      getUabDeployment(this.config.chainId) != null ||
      this.config.contracts?.uabReceiver != null;
    const includeCrossChain =
      opts.includeCrossChain ?? (opts.chains.includes("ethereum") && uabConfigured);
    if (includeCrossChain) {
      const crossOwned = await this.scanCrossChain({
        fromBlock: opts.fromBlock,
        toBlock: opts.toBlock,
      });
      const evmChainId = this.getAdapter("ethereum").chainId;
      for (const o of crossOwned) {
        out.push({ ...o, chain: "ethereum", chainId: evmChainId, source: "uab" });
      }
    }
    return out;
  }

  /**
   * Fetch ALL native announcements on `chain` as indexer-shaped rows — unfiltered, with their
   * full on-chain `metadata`. This is the raw input for the metadata-aware scanners:
   * {@link discoverTraits} / {@link getReputationTraitsFromAnnouncements} (PSR attestation
   * markers) and {@link filterOwnedAnnouncements}. Unlike {@link scan}, nothing is dropped, so
   * callers can decode announcement metadata that ownership filtering would discard.
   *
   * Note: cross-chain (UAB) announcements are NOT included — the 96-byte Wormhole payload only
   * carries a 24-byte metadata tail, which cannot hold the 130-byte V2 attestation metadata.
   * For trait discovery, fetch rows natively on each chain instead.
   */
  async fetchAnnouncementRows(
    chain: OpaqueScanChain,
    opts: {
      /** Lower-bound cursor: EVM block number (Solana scans the most recent signatures). */
      fromBlock?: bigint;
      /** Upper-bound EVM block; omit for the chain tip. */
      toBlock?: bigint;
      /** Max Solana signatures to scan (adapter default when omitted). */
      solanaLimit?: number;
    } = {},
  ): Promise<IndexerAnnouncement[]> {
    const announcements = await this.getAdapter(chain).fetchAnnouncements({
      fromCursor: opts.fromBlock,
      toCursor: opts.toBlock,
      limit: opts.solanaLimit,
    });
    return announcements.map(announcementToIndexerRow);
  }

  /** Lazily build and cache the {@link ChainAdapter} for a chain. */
  private getAdapter(chain: OpaqueScanChain): ChainAdapter {
    if (chain === "ethereum") {
      this.evmAdapter ??= new EvmAdapter({
        publicClient: this.publicClient,
        announcerAddress: this.announcer,
        // announceWithRelay mirrors the Announcement event from UABSender, not the
        // announcer singleton; without this, relay-sent payments are invisible to the
        // local scan and only discoverable via the destination chain's RPC.
        uabSenderAddress:
          this.config.contracts?.uabSender ??
          getUabDeployment(this.config.chainId)?.uabSender,
        registryAddress: this.registry,
        evmChainId: this.config.chainId,
        schemeId: BigInt(EIP5564_SCHEME_SECP256K1),
        // Scanning from block 0 both wastes RPC calls and trips public-RPC range caps.
        fromBlock: getEvmDeployment(this.config.chainId)?.stealthFromBlock ?? 0n,
      });
      return this.evmAdapter;
    }
    if (chain === "solana") {
      return this.getSolanaAdapter();
    }
    throw new Error(`Opaque: unsupported scan chain "${chain as string}"`);
  }

  /** Lazily build and cache the concrete {@link SolanaAdapter}. */
  private getSolanaAdapter(): SolanaAdapter {
    this.solanaAdapter ??= new SolanaAdapter(this.config.solana ?? {});
    return this.solanaAdapter;
  }

  /**
   * Sweep an owned stealth output to `destination`, signed by the reconstructed one-time key (the
   * on-chain `from` is the stealth address itself). Sweeps the full native balance, or the full
   * balance of `token` (ERC-20 address / SPL mint) when set. Works for Ethereum and Solana;
   * `"solana"` requires {@link OpaqueClientConfig.solana}. An ERC-20 sweep needs the stealth address
   * to hold native gas (see `gasDrop` on {@link sendStealthPayment}, or a relayer-sponsored sweep).
   */
  async sweep(params: {
    output: Pick<OwnedStealthOutput, "ephemeralPublicKey">;
    chain: OpaqueScanChain;
    destination: string;
    /** ERC-20 address / SPL mint to sweep; omit for the native asset. */
    token?: string;
    /** Solana only: also close the emptied token account and reclaim its rent. */
    closeAccount?: boolean;
  }): Promise<{ chain: OpaqueScanChain; tx: string }> {
    const stealthPrivKey = this.getStealthSignerPrivateKey(params.output);
    if (params.chain === "ethereum") {
      const hash = params.token
        ? await sweepEvmStealthToken(this.publicClient, {
            stealthPrivKey,
            token: getAddress(params.token),
            destination: getAddress(params.destination),
            rpcUrl: this.config.rpcUrl,
          })
        : await sweepStealthNative(this.publicClient, {
            stealthPrivKey,
            destination: getAddress(params.destination),
            rpcUrl: this.config.rpcUrl,
          });
      return { chain: "ethereum", tx: hash };
    }
    if (params.chain === "solana") {
      if (params.token) {
        const { signature } = await sweepSolanaStealthToken(
          this.getSolanaAdapter().connection,
          {
            stealthPrivKey,
            mint: params.token,
            destinationOwner: params.destination,
            closeAccount: params.closeAccount,
          },
        );
        return { chain: "solana", tx: signature };
      }
      const { signature } = await this.getSolanaAdapter().sweepStealthSol({
        stealthPrivKey,
        destination: params.destination,
      });
      return { chain: "solana", tx: signature };
    }
    throw new Error(`Opaque: unsupported sweep chain "${params.chain as string}"`);
  }

  /**
   * Build a relayer-submittable gasless token sweep (spec/relayer-market.md, fee-in-token). The
   * reconstructed stealth key authorizes the move offline (no native gas needed); a relayer submits
   * it, pays the gas, and takes `fee` in the token. Ethereum returns `sweepWithPermit` calldata for
   * the `StealthTokenSweep` forwarder; Solana returns a transaction partially signed by the stealth
   * key that the relayer co-signs as fee payer. EVM chain reads (balance, token name, permit and
   * forwarder nonces) are auto-resolved unless overridden.
   */
  async buildGaslessTokenSweep(params: {
    output: Pick<OwnedStealthOutput, "ephemeralPublicKey">;
    chain: OpaqueScanChain;
    /** ERC-20 address (Ethereum) or SPL mint (Solana base58). */
    token: string;
    /** Recipient: an address (Ethereum) or token-account owner (Solana). */
    destination: string;
    /** Relayer fee, taken from the swept amount in the token's smallest unit. */
    fee: bigint;
    /** Unix-seconds authorization deadline. */
    deadline: bigint;
    /** EVM forwarder override; defaults to the configured / deployed `stealthTokenSweep`. */
    forwarder?: Address;
    /** EVM amount to sweep; defaults to the full token balance. */
    value?: bigint;
    /** EVM token EIP-712 domain name; defaults to the on-chain `name()`. */
    tokenName?: string;
    /** EVM token EIP-712 domain version; defaults to `"1"`. */
    tokenVersion?: string;
    /** Solana relayer fee payer (base58); required for the Solana path. */
    feePayer?: string;
    /** Solana: also close the emptied token account and return its rent to the fee payer. */
    closeAccount?: boolean;
  }): Promise<GaslessSweep> {
    const stealthPrivKey = this.getStealthSignerPrivateKey(params.output);

    if (params.chain === "ethereum") {
      const forwarder =
        params.forwarder ??
        this.config.contracts?.stealthTokenSweep ??
        this.deployment.stealthTokenSweep;
      if (!forwarder) {
        throw new Error(
          "Opaque: no StealthTokenSweep forwarder configured for this chain; pass `forwarder`.",
        );
      }
      const token = getAddress(params.token);
      const owner = privateKeyToAccount(`0x${bytesToHex(stealthPrivKey)}` as Hex).address;

      const value =
        params.value ??
        ((await this.publicClient.readContract({
          address: token,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [owner],
        })) as bigint);
      if (value === 0n) throw new Error("Opaque: stealth address holds none of this token.");

      const tokenName =
        params.tokenName ??
        ((await this.publicClient.readContract({
          address: token,
          abi: ERC20_PERMIT_READ_ABI,
          functionName: "name",
        })) as string);
      const permitNonce = (await this.publicClient.readContract({
        address: token,
        abi: ERC20_PERMIT_READ_ABI,
        functionName: "nonces",
        args: [owner],
      })) as bigint;
      const sweepNonce = (await this.publicClient.readContract({
        address: forwarder,
        abi: stealthTokenSweepAbi,
        functionName: "nonces",
        args: [owner],
      })) as bigint;

      const { ownerSig, authorization } = await signStealthSweepAuthorization({
        stealthPrivKey,
        forwarder,
        chainId: this.config.chainId,
        authorization: {
          token,
          destination: getAddress(params.destination),
          value,
          fee: params.fee,
          nonce: sweepNonce,
          deadline: params.deadline,
        },
      });
      const permit = await signStealthTokenPermit({
        stealthPrivKey,
        token,
        chainId: this.config.chainId,
        spender: forwarder,
        value,
        nonce: permitNonce,
        deadline: params.deadline,
        tokenName,
        tokenVersion: params.tokenVersion,
      });

      return {
        chain: "ethereum",
        to: forwarder,
        data: encodeSweepWithPermit(authorization, ownerSig, permit),
        authorization,
        ownerSig,
        permit,
      };
    }

    if (params.chain === "solana") {
      if (!params.feePayer) {
        throw new Error("Opaque: a Solana gasless sweep requires `feePayer` (the relayer pubkey).");
      }
      const plan = await buildStealthTokenSweepTransaction(this.getSolanaAdapter().connection, {
        stealthPrivKey,
        mint: params.token,
        destinationOwner: params.destination,
        feePayer: params.feePayer,
        closeAccount: params.closeAccount,
      });
      plan.transaction.partialSign(plan.stealthKeypair);
      const transactionBase64 = plan.transaction
        .serialize({ requireAllSignatures: false })
        .toString("base64");
      return {
        chain: "solana",
        transactionBase64,
        feePayer: params.feePayer,
        amount: plan.amount,
      };
    }
    throw new Error(`Opaque: unsupported sweep chain "${params.chain as string}"`);
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
      this.requireSpendingKey(),
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
      this.requireSpendingKey(),
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
   * Native balance per owned stealth output across chains. Ethereum reads the stealth address
   * directly; Solana reconstructs the one-time key (WASM), derives the Solana stealth account, and
   * reads its lamports. Pass the {@link UnifiedOwnedOutput}s from {@link scan}. SPL/ERC-20 token
   * sums for the EVM tracked-token set live in {@link getBalancesFromAnnouncements}.
   */
  async getBalancesForOutputs(
    outputs: UnifiedOwnedOutput[],
  ): Promise<OutputBalance[]> {
    const result: OutputBalance[] = [];
    for (const o of outputs) {
      if (o.chain === "ethereum") {
        const wei = await this.publicClient.getBalance({
          address: getAddress(o.stealthAddress),
        });
        result.push({
          chain: "ethereum",
          stealthAddress: o.stealthAddress,
          address: o.stealthAddress,
          nativeRaw: wei,
        });
      } else if (o.chain === "solana") {
        const stealthPrivKey = this.getStealthSignerPrivateKey(o);
        const address = deriveStealthSolanaAddressFromStealthPrivKey(stealthPrivKey);
        const lamports = await this.getSolanaAdapter().connection.getBalance(
          new PublicKey(address),
        );
        result.push({
          chain: "solana",
          stealthAddress: o.stealthAddress,
          address,
          nativeRaw: BigInt(lamports),
        });
      }
    }
    return result;
  }

  /**
   * Per-token balance for each owned stealth output, across chains. Ethereum reads ERC-20
   * `balanceOf` at the stealth address; Solana reconstructs the one-time key (WASM), derives the
   * stealth account, and reads its associated token account. Zero balances are omitted.
   *
   * `tokens.ethereum` defaults to the configured tracked ERC-20s ({@link OpaqueClientConfig.trackedTokens}
   * minus the native sentinel); `tokens.solana` (SPL mints, base58) has no default and must be passed.
   */
  async getTokenBalancesForOutputs(
    outputs: UnifiedOwnedOutput[],
    tokens?: { ethereum?: Address[]; solana?: string[] },
  ): Promise<OutputTokenBalance[]> {
    const evmTokens =
      tokens?.ethereum ??
      this.tokens
        .filter((t) => t.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase())
        .map((t) => t.address);
    const solanaMints = tokens?.solana ?? [];
    const result: OutputTokenBalance[] = [];

    for (const o of outputs) {
      if (o.chain === "ethereum") {
        const stealthAddress = getAddress(o.stealthAddress);
        for (const token of evmTokens) {
          const raw = (await this.publicClient.readContract({
            address: token,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [stealthAddress],
          })) as bigint;
          if (raw > 0n) {
            result.push({
              chain: "ethereum",
              stealthAddress: o.stealthAddress,
              address: stealthAddress,
              token,
              raw,
            });
          }
        }
      } else if (o.chain === "solana") {
        if (solanaMints.length === 0) continue;
        const stealthPrivKey = this.getStealthSignerPrivateKey(o);
        const address = deriveStealthSolanaAddressFromStealthPrivKey(stealthPrivKey);
        const connection = this.getSolanaAdapter().connection;
        for (const mint of solanaMints) {
          const raw = await getStealthTokenBalance(connection, { owner: address, mint });
          if (raw > 0n) {
            result.push({
              chain: "solana",
              stealthAddress: o.stealthAddress,
              address,
              token: mint,
              raw,
            });
          }
        }
      }
    }
    return result;
  }

  /**
   * Legacy PSR V1: map owned `0xA7` attestation markers to a {@link DiscoveredTrait} list.
   * Use {@link discoverTraitsV2} for schema-bound V2 attestations created by {@link issueAttestation}.
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
   * PSR V2: map owned schema-bound attestation announcements to {@link DiscoveredTrait}.
   *
   * V2 announcements use marker `0xB2` and must be validated against the native chain's schema
   * registry snapshot before they are returned. Use this for attestations created by
   * {@link issueAttestation}; keep {@link discoverTraits} for legacy V1 `0xA7` announcements.
   */
  async discoverTraitsV2(
    rows: IndexerAnnouncement[],
    options: DiscoverTraitsV2Options,
  ): Promise<DiscoveredTrait[]> {
    if (rows.length === 0) return [];
    const schemas = options.schemas ?? await this.fetchAllPsrSchemas(options.chain);
    if (schemas.length === 0) return [];
    const currentSlot =
      options.currentSlot ?? await this.getCurrentPsrSlot(options.chain);
    const json = indexerAnnouncementsToScannerJson(rows);
    const schemasJson = JSON.stringify(
      schemas.map((schema) => schemaToScannerSchemaInfo(schema, options.chain)),
    );
    const trusted = options.trustedIssuers?.length
      ? JSON.stringify(options.trustedIssuers.map((i) => normalizeScannerIssuer(i, options.chain)))
      : "";
    const out = scanAttestationsV2Json(
      this.wasm,
      json,
      schemasJson,
      this.viewingKey,
      this.spendPubKey,
      currentSlot,
      trusted,
    );
    const list = JSON.parse(out) as V2Attestation[];
    return v2AttestationsToDiscoveredTraits(list);
  }

  /**
   * Legacy PSR V1: same as {@link discoverTraits}, an alias for older reputation call sites.
   */
  async getReputationTraitsFromAnnouncements(
    rows: IndexerAnnouncement[],
  ): Promise<DiscoveredTrait[]> {
    return this.discoverTraits(rows);
  }

  /**
   * Legacy V1: encode `announce` metadata for a PSR attestation
   * (view tag byte + `0xA7` + u64 `attestationId`).
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
   * Legacy V1 issuer flow: derive one-time stealth material for the recipient and embed
   * `attestationId` in metadata.
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
   * Legacy V1 issuer flow: calldata for `StealthAddressAnnouncer.announce` with PSR metadata
   * (no asset transfer).
   */
  buildAssignReputationTransaction(
    recipientMetaAddressHex: Hex,
    attestationId: bigint,
  ): AnnounceTransactionRequest {
    return this.buildAnnounceTransactionRequest(
      this.prepareReputationAssignment(recipientMetaAddressHex, attestationId),
    );
  }

  // ---------------------------------------------------------------------------
  // PSR admin API (cross-chain): schema + attestation lifecycle.
  //
  // Every method dispatches on `chain` and behaves identically from the caller's view, returning
  // the chain-neutral SchemaV2 / AttestationV2 shapes. Ethereum writes need `ethereumProvider`;
  // Solana writes need `solanaWallet`. The recipient/field/expiry/announce semantics match the
  // reference frontends byte-for-byte.
  // ---------------------------------------------------------------------------

  /**
   * Register a new schema (attestation class + issuance rules). Returns the tx id and derived
   * `schemaId`. `fieldDefinitions` accepts an ABI string or {@link FieldDef}s.
   */
  async createSchema(chain: PsrChain, params: CreateSchemaParams): Promise<CreateSchemaResult> {
    const fieldDefinitions = normalizeFieldDefs(params.fieldDefinitions);
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      const clients = this.evmWriteClients();
      const schemaExpiryBlock = await this.resolveEvmExpiryBlock(params.schemaExpiry);
      return evmRegisterSchema(clients, cfg, {
        name: params.name,
        fieldDefinitions,
        revocable: params.revocable,
        resolver: params.resolver ? getAddress(params.resolver) : undefined,
        schemaExpiryBlock,
      });
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const programs = this.getSolanaAdapter().deployment;
      const schemaId = solanaComputeSchemaId(wallet.publicKey, params.name);
      const schemaPda = deriveSchemaPda(programs.schemaRegistry, wallet.publicKey, schemaId);
      const schemaExpirySlot = await this.resolveSolanaExpirySlot(params.schemaExpiry);
      const ix = buildRegisterSchemaInstruction({
        schemaRegistryProgramId: programs.schemaRegistry,
        authority: wallet.publicKey,
        schemaPda,
        schemaId,
        name: params.name,
        fieldDefinitions,
        revocable: params.revocable,
        resolver: params.resolver ? new PublicKey(params.resolver) : null,
        schemaExpirySlot,
      });
      const txHash = await this.sendSolanaTx([ix]);
      return { txHash, schemaId: bytesToHex0x(schemaId) };
    }
    throw unsupportedPsrChain(chain);
  }

  /** Schemas where this client's wallet is the authority OR an authorized delegate. */
  async getMySchemas(chain: PsrChain): Promise<SchemaV2[]> {
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      return evmFetchSchemasForWallet(this.publicClient, cfg, this.config.ethereumAddress);
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const programs = this.getSolanaAdapter().deployment;
      const me = wallet.publicKey.toBase58();
      const all = await solanaFetchAllSchemas(this.getSolanaAdapter().connection, programs.schemaRegistry);
      return all
        .filter(
          ({ schema }) =>
            schema.authority.toBase58() === me ||
            schema.delegates.some((d) => d.toBase58() === me),
        )
        .map(({ address, schema }) => solanaSchemaToV2(address, schema));
    }
    throw unsupportedPsrChain(chain);
  }

  /** All schemas on the selected chain, used by V2 trait discovery authorization. */
  private async fetchAllPsrSchemas(chain: PsrChain): Promise<SchemaV2[]> {
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      return evmFetchAllSchemas(this.publicClient, cfg);
    }
    if (chain === "solana") {
      const programs = this.getSolanaAdapter().deployment;
      const all = await solanaFetchAllSchemas(this.getSolanaAdapter().connection, programs.schemaRegistry);
      return all.map(({ address, schema }) => solanaSchemaToV2(address, schema));
    }
    throw unsupportedPsrChain(chain);
  }

  /** Current Ethereum block or Solana slot for V2 schema expiry checks. */
  private async getCurrentPsrSlot(chain: PsrChain): Promise<number> {
    if (chain === "ethereum") return evmGetCurrentBlock(this.publicClient);
    if (chain === "solana") {
      return this.getSolanaAdapter().connection.getSlot("confirmed");
    }
    throw unsupportedPsrChain(chain);
  }

  /** Authority-only, irreversible: deprecate a schema (blocks new attestations). */
  async deprecateSchema(chain: PsrChain, schemaId: string): Promise<PsrTxResult> {
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      const txHash = await evmDeprecateSchema(this.evmWriteClients(), cfg, schemaId as Hex);
      return { txHash };
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const programs = this.getSolanaAdapter().deployment;
      const schemaPda = deriveSchemaPda(programs.schemaRegistry, wallet.publicKey, hexToBytes(schemaId as Hex));
      const ix = buildDeprecateSchemaInstruction({
        schemaRegistryProgramId: programs.schemaRegistry,
        authority: wallet.publicKey,
        schemaPda,
      });
      return { txHash: await this.sendSolanaTx([ix]) };
    }
    throw unsupportedPsrChain(chain);
  }

  /** Authority-only: authorize `delegate` to issue under `schemaId`. */
  async addSchemaDelegate(chain: PsrChain, schemaId: string, delegate: string): Promise<PsrTxResult> {
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      const txHash = await evmAddDelegate(this.evmWriteClients(), cfg, schemaId as Hex, getAddress(delegate));
      return { txHash };
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const programs = this.getSolanaAdapter().deployment;
      const schemaPda = deriveSchemaPda(programs.schemaRegistry, wallet.publicKey, hexToBytes(schemaId as Hex));
      const ix = buildAddDelegateInstruction({
        schemaRegistryProgramId: programs.schemaRegistry,
        authority: wallet.publicKey,
        schemaPda,
        delegate: new PublicKey(delegate),
      });
      return { txHash: await this.sendSolanaTx([ix]) };
    }
    throw unsupportedPsrChain(chain);
  }

  /** Authority-only: revoke a delegate's issuance rights under `schemaId`. */
  async removeSchemaDelegate(chain: PsrChain, schemaId: string, delegate: string): Promise<PsrTxResult> {
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      const txHash = await evmRemoveDelegate(this.evmWriteClients(), cfg, schemaId as Hex, getAddress(delegate));
      return { txHash };
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const programs = this.getSolanaAdapter().deployment;
      const schemaPda = deriveSchemaPda(programs.schemaRegistry, wallet.publicKey, hexToBytes(schemaId as Hex));
      const ix = buildRemoveDelegateInstruction({
        schemaRegistryProgramId: programs.schemaRegistry,
        authority: wallet.publicKey,
        schemaPda,
        delegate: new PublicKey(delegate),
      });
      return { txHash: await this.sendSolanaTx([ix]) };
    }
    throw unsupportedPsrChain(chain);
  }

  /** Attestations issued by this client's wallet. */
  async getMyIssuedAttestations(chain: PsrChain): Promise<AttestationV2[]> {
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      return evmFetchAttestationsIssuedBy(this.publicClient, cfg, this.config.ethereumAddress);
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const programs = this.getSolanaAdapter().deployment;
      const me = wallet.publicKey.toBase58();
      const all = await solanaFetchAllAttestations(this.getSolanaAdapter().connection, programs.attestationEngineV2);
      return all
        .filter(({ attestation }) => attestation.issuer.toBase58() === me)
        .map(({ address, attestation }) => solanaAttestationToV2(address, attestation));
    }
    throw unsupportedPsrChain(chain);
  }

  /**
   * Issue a schema-bound attestation against a stealth identity. Resolves the recipient to a
   * `stealth_address_hash`, encodes the field values per the schema, submits `attest`, and
   * (when the recipient is a meta-address and `announce` is not `false`) publishes a discovery
   * announcement so the recipient's scanner can find the trait. Verifies the wallet is an
   * authorized issuer first.
   */
  async issueAttestation(chain: PsrChain, params: IssueAttestationParams): Promise<IssueAttestationResult> {
    if (chain === "ethereum") {
      const cfg = requirePsrV2Config(this.config.chainId);
      const clients = this.evmWriteClients();
      const schema = await evmFetchSchema(this.publicClient, cfg, params.schemaId as Hex);
      if (!schema) throw new Error(`Opaque PSR: schema ${params.schemaId} not found on Ethereum.`);
      const authorized = await evmIsAuthorizedIssuer(this.publicClient, cfg, params.schemaId as Hex, this.config.ethereumAddress);
      if (!authorized) {
        throw new Error(`Opaque PSR: ${this.config.ethereumAddress} is not an authorized issuer for schema ${params.schemaId}.`);
      }
      const resolved = this.resolveStealthAddressHash(params.recipient);
      const expirationBlock = await this.resolveEvmExpiryBlock(params.expiration);
      const { txHash, uid } = await evmAttest(clients, cfg, {
        schemaId: params.schemaId as Hex,
        stealthAddressHash: resolved.hash,
        fieldValues: params.fieldValues,
        fieldDefs: parseFieldDefs(schema.fieldDefinitions),
        expirationBlock,
        refUid: params.refUid as Hex | undefined,
      });
      const wantAnnounce = params.announce ?? resolved.ephemeralPubKey != null;
      if (wantAnnounce && resolved.stealthAddress && resolved.ephemeralPubKey && resolved.viewTag != null) {
        const metadata = encodeV2AttestationMetadata({
          viewTag: resolved.viewTag,
          schemaId: params.schemaId as Hex,
          issuer: this.config.ethereumAddress,
          uid,
          nonce: randomNonce(),
        });
        try {
          await evmAnnounceV2Attestation(clients, this.announcer, {
            stealthAddress: resolved.stealthAddress,
            ephemeralPubKey: bytesToHex0x(resolved.ephemeralPubKey),
            metadata,
          });
        } catch {
          // Announcement is a discovery convenience; issuance already succeeded.
        }
      }
      return { txHash, uid, stealthAddressHash: resolved.hash };
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const conn = this.getSolanaAdapter().connection;
      const programs = this.getSolanaAdapter().deployment;
      const schemaIdBytes = hexToBytes(params.schemaId as Hex);
      const found = await this.fetchSolanaSchemaById(schemaIdBytes);
      if (!found) throw new Error(`Opaque PSR: schema ${params.schemaId} not found on Solana.`);
      const me = wallet.publicKey.toBase58();
      const authorized =
        found.schema.authority.toBase58() === me ||
        found.schema.delegates.some((d) => d.toBase58() === me);
      if (!authorized) {
        throw new Error(`Opaque PSR: ${me} is not an authorized issuer for schema ${params.schemaId}.`);
      }
      const resolved = this.resolveStealthAddressHash(params.recipient);
      const stealthHashBytes = hexToBytes(resolved.hash);
      const dataBytes = hexToBytes(encodeAttestationData(params.fieldValues, parseFieldDefs(found.schema.fieldDefinitions)));
      const expirationSlot = await this.resolveSolanaExpirySlot(params.expiration);
      const refUid = params.refUid ? hexToBytes(params.refUid as Hex) : new Uint8Array(32);
      const schemaPda = deriveSchemaPda(programs.schemaRegistry, found.schema.authority, schemaIdBytes);
      const attestationPda = deriveAttestationPda(programs.attestationEngineV2, schemaIdBytes, wallet.publicKey, stealthHashBytes);
      const resolverProgram = found.schema.resolver.equals(PublicKey.default) ? undefined : found.schema.resolver;
      const ix = buildAttestInstruction({
        attestationProgramId: programs.attestationEngineV2,
        issuer: wallet.publicKey,
        schemaPda,
        attestationPda,
        stealthAddressHash: stealthHashBytes,
        data: dataBytes,
        expirationSlot,
        refUid,
        resolverProgram,
      });
      const txHash = await this.sendSolanaTx([ix]);
      const confirmed = await solanaFetchAttestationPda(conn, attestationPda);
      const uid = confirmed ? bytesToHex0x(confirmed.uid) : ZERO_BYTES32_HEX;
      const wantAnnounce = params.announce ?? resolved.ephemeralPubKey != null;
      if (wantAnnounce && confirmed && resolved.stealthAddress && resolved.ephemeralPubKey && resolved.viewTag != null) {
        const metadata = buildSolanaV2AttestationMetadata(resolved.viewTag, schemaIdBytes, wallet.publicKey, confirmed.uid);
        const announceIx = this.getSolanaAdapter().buildAnnounceInstruction({
          caller: wallet.publicKey,
          stealthAddress: hexToBytes(resolved.stealthAddress),
          ephemeralPubKey: resolved.ephemeralPubKey,
          metadata,
        });
        try {
          await this.sendSolanaTx([announceIx]);
        } catch {
          // Announcement is a discovery convenience; issuance already succeeded.
        }
      }
      return { txHash, uid, stealthAddressHash: resolved.hash };
    }
    throw unsupportedPsrChain(chain);
  }

  // --- PSR admin helpers ----------------------------------------------------

  /** EIP-1193 provider or a clear error. */
  private requireEthereumProvider(): EIP1193Provider {
    const p = this.config.ethereumProvider;
    if (!p) {
      throw new Error(
        "Opaque PSR: ethereumProvider is required for Ethereum PSR writes. Pass it to OpaqueClient.create.",
      );
    }
    return p;
  }

  /** Viem chain for the configured chain id (bundled Sepolia, else a minimal definition). */
  private viemChain(): Chain {
    if (this.config.chainId === sepolia.id) return sepolia;
    return defineChain({
      id: this.config.chainId,
      name: `chain-${this.config.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [this.config.rpcUrl] } },
    });
  }

  /** Lazily build the signing wallet client for Ethereum PSR writes. */
  private evmWalletClient(): WalletClient {
    if (!this.evmWalletClientCache) {
      this.evmWalletClientCache =
        this.config.ethereumWalletClient ??
        createWalletClient({
          account: this.config.ethereumAddress,
          chain: this.viemChain(),
          transport: custom(this.requireEthereumProvider()),
        });
    }
    return this.evmWalletClientCache;
  }

  private evmWriteClients(): EvmPsrWriteClients {
    return {
      publicClient: this.publicClient,
      walletClient: this.evmWalletClient(),
      account: this.config.ethereumAddress,
    };
  }

  /** Solana signer (normalized) or a clear error. */
  private requireSolanaWallet(): {
    publicKey: PublicKey;
    signTransaction: (transaction: Transaction) => Promise<Transaction>;
  } {
    if (!this.solanaWalletCache) {
      const w = this.config.solanaWallet;
      if (!w) {
        throw new Error(
          "Opaque PSR: solanaWallet ({ publicKey, signTransaction }) is required for Solana PSR writes. Pass it to OpaqueClient.create.",
        );
      }
      this.solanaWalletCache = {
        publicKey: typeof w.publicKey === "string" ? new PublicKey(w.publicKey) : w.publicKey,
        signTransaction: w.signTransaction,
      };
    }
    return this.solanaWalletCache;
  }

  /**
   * Sign + send + confirm a Solana transaction built from `ixs`. Any `extraSigners` (e.g. the
   * Wormhole message keypair for `announce_with_relay`) partial-sign before the wallet signs as
   * fee payer.
   */
  private async sendSolanaTx(
    ixs: TransactionInstruction[],
    extraSigners: Keypair[] = [],
  ): Promise<string> {
    const wallet = this.requireSolanaWallet();
    const conn = this.getSolanaAdapter().connection;
    const tx = new Transaction();
    for (const ix of ixs) tx.add(ix);
    tx.feePayer = wallet.publicKey;
    const latest = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    if (extraSigners.length > 0) tx.partialSign(...extraSigners);
    const signed = await wallet.signTransaction(tx);
    const signature = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction({ signature, ...latest }, "confirmed");
    return signature;
  }

  /**
   * Resolve a recipient to a 32-byte `stealth_address_hash` (and, for a meta-address, the
   * ephemeral material needed to announce). Matches the frontends: 66-byte meta-address → DKSAP →
   * `keccak256(stealthAddress)`; 20-byte stealth address → `keccak256(address)`; 32-byte → as-is.
   */
  private resolveStealthAddressHash(recipient: string): {
    hash: Hex;
    stealthAddress?: Address;
    ephemeralPubKey?: Uint8Array;
    viewTag?: number;
  } {
    const trimmed = recipient.trim();
    const normalized = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
    const hexLen = normalized.length - 2;
    if (hexLen === 132) {
      const r = computeStealthAddressAndViewTag(normalized);
      return {
        hash: keccak256(r.stealthAddress),
        stealthAddress: r.stealthAddress,
        ephemeralPubKey: r.ephemeralPubKey,
        viewTag: r.viewTag,
      };
    }
    if (hexLen === 40) {
      return { hash: keccak256(getAddress(normalized)), stealthAddress: getAddress(normalized) };
    }
    if (hexLen === 64) {
      return { hash: normalized };
    }
    throw new Error(
      "Opaque PSR: recipient must be a 66-byte meta-address, 20-byte stealth address, or 32-byte hash (hex).",
    );
  }

  /** Resolve a {@link PsrExpiryInput} to an absolute Ethereum block (0 = no expiry). */
  private async resolveEvmExpiryBlock(expiry?: PsrExpiryInput): Promise<bigint> {
    if (!expiry) return 0n;
    if (expiry.slotOrBlock != null) return BigInt(expiry.slotOrBlock);
    if (expiry.dateTime) {
      const targetMs = Date.parse(expiry.dateTime);
      if (!Number.isFinite(targetMs)) throw new Error(`Opaque PSR: invalid expiry dateTime "${expiry.dateTime}".`);
      const nowMs = Date.now();
      if (targetMs <= nowMs) throw new Error("Opaque PSR: expiry must be in the future.");
      const current = await this.publicClient.getBlockNumber();
      const blocks = Math.ceil((targetMs - nowMs) / 12_000); // ~12s/block
      return current + BigInt(Math.max(1, blocks));
    }
    return 0n;
  }

  /** Resolve a {@link PsrExpiryInput} to an absolute Solana slot (0 = no expiry). */
  private async resolveSolanaExpirySlot(expiry?: PsrExpiryInput): Promise<number> {
    if (!expiry) return 0;
    if (expiry.slotOrBlock != null) return Number(expiry.slotOrBlock);
    if (expiry.dateTime) {
      const targetMs = Date.parse(expiry.dateTime);
      if (!Number.isFinite(targetMs)) throw new Error(`Opaque PSR: invalid expiry dateTime "${expiry.dateTime}".`);
      const nowMs = Date.now();
      if (targetMs <= nowMs) throw new Error("Opaque PSR: expiry must be in the future.");
      const currentSlot = await this.getSolanaAdapter().connection.getSlot("confirmed");
      const slots = Math.ceil((targetMs - nowMs) / 400); // ~400ms/slot
      return currentSlot + Math.max(1, slots);
    }
    return 0;
  }

  /** Find a Solana schema by `schemaId` (PSR schemas have no id-indexed PDA across authorities). */
  private async fetchSolanaSchemaById(
    schemaIdBytes: Uint8Array,
  ): Promise<{ address: PublicKey; schema: ParsedSchemaPda } | null> {
    const programs = this.getSolanaAdapter().deployment;
    const all = await solanaFetchAllSchemas(this.getSolanaAdapter().connection, programs.schemaRegistry);
    const target = bytesToHex(schemaIdBytes);
    return all.find(({ schema }) => bytesToHex(schema.schemaId) === target) ?? null;
  }

  /**
   * JSON array string in the Rust scanner's announcement format (general scanner interop;
   * no longer consumed by {@link generateReputationProof}, which builds V2 witnesses directly).
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
        "Opaque: DiscoveredTrait.ephemeralPubkey is required (use discoverTraitsV2, or legacy discoverTraits / getReputationTraitsFromAnnouncements)",
      );
    }
    const ephemeralPublicKey = (`0x${trait.ephemeralPubkey
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`) as Hex;
    return this.getStealthSignerPrivateKey({ ephemeralPublicKey });
  }

  /**
   * V2 Groth16 proof bundle for the reputation verifiers (requires `snarkjs`).
   * When `artifacts` is omitted, the V2 wasm/zkey are loaded from the default hosted paths on
   * opaque.cash (same as the Opaque frontend `/circuits/v2/...` assets).
   * Traits returned by {@link discoverTraitsV2} carry `merkleLeafPreimage`, which supplies
   * `issuerPkX`, `traitDataHash`, and `nonce` automatically unless these params are overridden.
   *
   * Public signals: `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`;
   * `ProofData.nullifier` carries `nullifier_hash`.
   */
  async generateReputationProof(params: {
    trait: DiscoveredTrait;
    stealthPrivKeyBytes: Uint8Array;
    externalNullifier: string;
    issuerPkX?: string | bigint;
    traitDataHash?: string | bigint;
    nonce?: string | bigint;
    artifacts?: ArtifactPaths;
    onProgress?: ProofProgressCallback;
  }): Promise<ProofData> {
    await ensureBufferPolyfill();
    return runGenerateReputationProof({
      trait: params.trait,
      stealthPrivKeyBytes: params.stealthPrivKeyBytes,
      externalNullifier: params.externalNullifier,
      issuerPkX: params.issuerPkX ?? params.trait.merkleLeafPreimage?.issuerPkX,
      traitDataHash: params.traitDataHash ?? params.trait.merkleLeafPreimage?.traitDataHash,
      nonce: params.nonce ?? params.trait.merkleLeafPreimage?.nonceField,
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

  /**
   * Broadcast a reputation proof to the verifier, dispatching on `chain` (consumes the nullifier on
   * success). Uses the configured signer for each chain — `ethereumWalletClient` / `ethereumProvider`
   * for Ethereum, `solanaWallet` for Solana. The same {@link VerifyReputationArgs} feeds both:
   * `proofData` (from {@link generateReputationProof}), `merkleRoot`, and `externalNullifier`.
   */
  async submitReputationVerification(
    chain: OpaqueScanChain,
    args: VerifyReputationArgs,
  ): Promise<PsrTxResult> {
    if (chain === "ethereum") {
      // The configured wallet client carries a concrete chain at runtime (viemChain / wagmi);
      // cast to satisfy submitVerifyReputation's `TChain extends Chain` constraint.
      const wallet = this.evmWalletClient() as WalletClient<
        Transport,
        Chain,
        Account | undefined
      >;
      const txHash = await submitVerifyReputation(
        this.publicClient,
        wallet,
        this.getReputationVerifierAddress(),
        args,
      );
      return { txHash };
    }
    if (chain === "solana") {
      const wallet = this.requireSolanaWallet();
      const adapter = this.getSolanaAdapter();
      const txHash = await solanaSubmitReputationProof(adapter.connection, {
        reputationProgramId: adapter.deployment.reputationVerifier,
        groth16ProgramId: adapter.deployment.groth16Verifier,
        proof: args.proofData.proof,
        merkleRoot: args.merkleRoot,
        nullifier: args.proofData.nullifier,
        externalNullifier: args.externalNullifier,
        attestationId: args.proofData.attestationId,
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
      });
      return { txHash };
    }
    throw unsupportedPsrChain(chain);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stand-in WASM module for clients created without a `wasmModuleSpecifier`: any property access
 * throws a clear error. The PSR admin API never touches it; scan/sweep/proof/trait methods do.
 */
function wasmUnavailable(): StealthWasmModule {
  return new Proxy({} as StealthWasmModule, {
    get() {
      throw new Error(
        "Opaque: this method requires the cryptography WASM module. Pass `wasmModuleSpecifier` to " +
          "OpaqueClient.create. (Scanning, sweeping, trait discovery, key reconstruction, and proof " +
          "generation need it; PSR schema/attestation admin does not.)",
      );
    },
  });
}

/** All-zero bytes32 as `0x`-hex (no attestation uid). */
const ZERO_BYTES32_HEX = ("0x" + "00".repeat(32)) as Hex;

function bytesToHex0x(b: Uint8Array): Hex {
  return ("0x" + bytesToHex(b)) as Hex;
}

function unsupportedPsrChain(chain: string): Error {
  return new Error(`Opaque PSR: unsupported chain "${chain}".`);
}

interface ScannerSchemaInfo {
  schema_id: number[];
  authority: number[];
  delegates: number[][];
  deprecated: boolean;
  schema_expiry_slot: number;
  name: string;
}

function schemaToScannerSchemaInfo(
  schema: SchemaV2,
  chain: PsrChain,
): ScannerSchemaInfo {
  return {
    schema_id: Array.from(hexToBytes(schema.schemaId as Hex)),
    authority: Array.from(identityToScannerIssuer(schema.authority, chain)),
    delegates: schema.delegates.map((d) => Array.from(identityToScannerIssuer(d, chain))),
    deprecated: schema.deprecated,
    schema_expiry_slot: schema.schemaExpirySlot,
    name: schema.name,
  };
}

function normalizeScannerIssuer(identity: string, chain: PsrChain): string {
  return bytesToHex(identityToScannerIssuer(identity, chain));
}

function identityToScannerIssuer(identity: string, chain: PsrChain): Uint8Array {
  const trimmed = identity.trim();
  if (chain === "ethereum" || trimmed.startsWith("0x")) {
    const bytes = hexToBytes((trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex);
    if (bytes.length === 32) return bytes;
    if (bytes.length === 20) {
      const out = new Uint8Array(32);
      out.set(bytes, 12);
      return out;
    }
    throw new Error(`Opaque PSR: expected 20-byte address or 32-byte issuer hex, got ${identity}.`);
  }
  return new PublicKey(trimmed).toBytes();
}

/** Accept an ABI string or {@link FieldDef}s and return the canonical ABI string. */
function normalizeFieldDefs(fieldDefinitions: string | FieldDef[]): string {
  return typeof fieldDefinitions === "string"
    ? fieldDefinitions
    : fieldDefsToString(fieldDefinitions);
}

/** Convert a parsed Solana schema PDA into the chain-neutral {@link SchemaV2}. */
function solanaSchemaToV2(address: PublicKey, s: ParsedSchemaPda): SchemaV2 {
  return {
    address: address.toBase58(),
    schemaId: bytesToHex0x(s.schemaId),
    authority: s.authority.toBase58(),
    resolver: s.resolver.toBase58(),
    revocable: s.revocable,
    name: s.name,
    fieldDefinitions: s.fieldDefinitions,
    version: s.version,
    delegates: s.delegates.map((d) => d.toBase58()),
    createdAt: Number(s.createdAt),
    schemaExpirySlot: Number(s.schemaExpirySlot),
    deprecated: s.deprecated,
  };
}

/** Convert a parsed Solana attestation PDA into the chain-neutral {@link AttestationV2}. */
function solanaAttestationToV2(address: PublicKey, a: ParsedAttestationPda): AttestationV2 {
  return {
    address: address.toBase58(),
    uid: bytesToHex0x(a.uid),
    schemaId: bytesToHex0x(a.schemaId),
    issuer: a.issuer.toBase58(),
    stealthAddressHash: bytesToHex0x(a.stealthAddressHash),
    dataHex: bytesToHex0x(a.data),
    createdAt: Number(a.createdAt),
    expirationSlot: Number(a.expirationSlot),
    revocationSlot: Number(a.revocationSlot),
    refUid: bytesToHex0x(a.refUid),
  };
}

/**
 * Build the 130-byte V2 attestation announcement metadata for Solana (the issuer is a 32-byte
 * Ed25519 pubkey, so this is the Solana counterpart to `encodeV2AttestationMetadata`):
 * `viewTag(1) || 0xB2 || schemaId(32) || issuer(32) || uid(32) || nonce(32)`.
 */
function buildSolanaV2AttestationMetadata(
  viewTag: number,
  schemaIdBytes: Uint8Array,
  issuer: PublicKey,
  uid: Uint8Array,
): Uint8Array {
  const metadata = new Uint8Array(130);
  metadata[0] = viewTag & 0xff;
  metadata[1] = 0xb2;
  metadata.set(schemaIdBytes.slice(0, 32), 2);
  metadata.set(issuer.toBytes(), 34);
  metadata.set(uid.slice(0, 32), 66);
  metadata.set(hexToBytes(randomNonce()), 98);
  return metadata;
}

/**
 * Map a chain-neutral {@link Announcement} (from any {@link ChainAdapter}) into the
 * {@link IndexerAnnouncement} row shape consumed by {@link OpaqueClient.filterOwnedAnnouncements}.
 * `txHash` passes through verbatim (an EVM `0x` hash or a Solana base58 signature); `cursor`
 * (EVM block / Solana slot) becomes `blockNumber`.
 */
export function announcementToIndexerRow(a: Announcement): IndexerAnnouncement {
  return {
    blockNumber: (a.cursor ?? 0n).toString(),
    etherealPublicKey: (`0x${bytesToHex(a.ephemeralPubKey)}`) as Hex,
    logIndex: a.logIndex ?? 0,
    metadata: (`0x${bytesToHex(a.metadata)}`) as Hex,
    stealthAddress: a.stealthAddress as Address,
    transactionHash: (a.txHash ?? "0x") as Hex,
    viewTag: a.viewTag,
  };
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
