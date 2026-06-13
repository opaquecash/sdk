/**
 * `@opaquecash/opaque` — unified Opaque SDK client.
 *
 * Initialize once with chain, RPC, wallet signature, and WASM URL; then prepare txs,
 * filter indexer announcements, aggregate balances, reconstruct one-time spend keys, and discover PSR traits.
 *
 * @packageDocumentation
 */

export {
  OpaqueClient,
  type OpaqueClientConfig,
  type PrepareStealthSendResult,
  type PrepareGhostReceiveResult,
  type AnnounceTransactionRequest,
  type RegisterMetaAddressTransactionRequest,
  type RegisterMetaAddressResult,
  type ResolveRecipientMetaResult,
  type OpaqueScanChain,
  type UnifiedOwnedOutput,
  type OutputBalance,
  type SendStealthPaymentParams,
  type SendStealthPaymentResult,
  type AnnounceWithRelayResult,
  type EvmAnnounceWithRelayResult,
  type SolanaAnnounceWithRelayResult,
  type PsrChain,
  type PsrExpiryInput,
  type CreateSchemaParams,
  type IssueAttestationParams,
  type PsrTxResult,
  type CreateSchemaResult,
  type IssueAttestationResult,
  type DiscoverTraitsV2Options,
  type DummyAnnouncement,
  announcementToIndexerRow,
} from "./client.js";

// Chain adapters (the unified scan surface) — re-exported so consumers get them from one package.
export type {
  ChainAdapter,
  Announcement,
  FetchAnnouncementsOptions,
  AnnouncementHandlers,
} from "@opaquecash/adapter";
export {
  WORMHOLE_CHAIN_ETHEREUM,
  WORMHOLE_CHAIN_SOLANA,
} from "@opaquecash/adapter";
export {
  EvmAdapter,
  type EvmAdapterConfig,
} from "@opaquecash/stealth-chain";
export {
  SolanaAdapter,
  type SolanaAdapterConfig,
  getSolanaDeployment,
  type SolanaCluster,
  type SolanaDeployment,
} from "@opaquecash/stealth-chain-solana";

// PSR on Solana (schema registry, attestation engine, reputation verifier). Namespaced to avoid
// clashing with the chain-neutral psr-core codecs (e.g. both export `computeSchemaId`).
export * as solanaPsr from "@opaquecash/psr-chain-solana";

export type { VerifyReputationArgs } from "@opaquecash/psr-chain";
export type {
  ArtifactPaths,
  ProofProgressCallback,
} from "@opaquecash/psr-prover";
export {
  DEFAULT_REPUTATION_ARTIFACT_PATHS,
  DEFAULT_REPUTATION_ARTIFACTS_ORIGIN,
} from "@opaquecash/psr-prover";
export type {
  AttestationIdentifier,
  ProofData,
  DiscoveredTrait,
  V2Attestation,
  V2MerkleLeafPreimage,
} from "@opaquecash/psr-core";
export { buildActionScope, externalNullifierFromScope } from "@opaquecash/psr-core";

// PSR V2 schema + attestation codecs (chain-neutral).
export type {
  FieldType,
  FieldDef,
  SchemaV2,
  AttestationField,
  AttestationV2,
} from "@opaquecash/psr-core";
export {
  SCHEMA_VERSION,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  parseFieldDefs,
  fieldDefsToString,
  computeSchemaId,
  packSchemaIdToField,
  computeUid,
  encodeAttestationData,
  decodeAttestationData,
  encodeV2AttestationMetadata,
  randomNonce,
  isZeroUid,
} from "@opaquecash/psr-core";

export type {
  IndexerAnnouncement,
  OwnedStealthOutput,
  TokenBalanceSummary,
} from "./types/indexer.js";

export {
  getSupportedChainIds,
  getChainDeployment,
  requireChainDeployment,
  NATIVE_TOKEN_ADDRESS,
  type OpaqueChainDeployment,
} from "./chains.js";

export {
  indexerAnnouncementToScannerRecord,
  indexerAnnouncementsToScannerJson,
} from "./indexer/normalize.js";

// Unified signer abstraction (one adapter shape over EIP-1193 + wallet-adapter).
export {
  requestSetupSignature,
  selectSigner,
  type UnifiedSigner,
  type EvmUnifiedSigner,
  type SolanaUnifiedSigner,
} from "./signer.js";

// Identity resolution beyond the on-chain registries (CSAP §2.9 + spec/ONS.md).
export {
  OPAQUE_META_RECORD_KEY,
  META_ADDRESS_VALUE_PREFIX,
  DEFAULT_IPFS_GATEWAYS,
  parseMetaAddressValue,
  extractMetaAddressFromDidDocument,
  ipfsPathFromInput,
  isOnsNameInput,
  isSnsNameInput,
  resolveIpfsDidMetaAddress,
  resolveEnsMetaAddress,
  resolveSnsMetaAddress,
  type ResolvedRecipient,
  type ResolvedRecipientSource,
  type ResolveTransports,
} from "./resolve.js";

export {
  SETUP_MESSAGE,
  deriveKeysFromSignature,
  generateRandomMetaAddress,
  computeStealthAddressAndViewTag,
  recomputeStealthSendFromEphemeralPrivateKey,
  ephemeralPrivateKeyToCompressedPublicKey,
  stealthMetaAddressToHex,
  keysToStealthMetaAddress,
  viewOnlyMetaAddress,
  parseStealthMetaAddress,
} from "./crypto/dksap.js";

export { EIP5564_SCHEME_SECP256K1 } from "@opaquecash/stealth-core";
export {
  encodeUabPayload,
  decodeUabPayload,
  uabStealthAddressEvm,
  uabPayloadToMetadata,
  UAB_PAYLOAD_LENGTH,
  WORMHOLE_CHAIN_ID,
} from "@opaquecash/stealth-core";
export type { UabPayload } from "@opaquecash/stealth-core";

// Universal Announcement Bus (cross-chain) — re-exported so consumers get it from @opaquecash/opaque.
export {
  fetchVaa,
  getUabDeployment,
  requireUabDeployment,
  CONSISTENCY_FINALIZED,
  CONSISTENCY_SAFE,
  WORMHOLESCAN_TESTNET,
  WORMHOLESCAN_MAINNET,
} from "@opaquecash/uab";
export type {
  AnnounceWithRelayRequest,
  UabIndexerAnnouncement,
  CrossChainAnnouncementRecord,
  UabDeployment,
} from "@opaquecash/uab";
