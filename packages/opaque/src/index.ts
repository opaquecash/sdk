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
  type ResolveRecipientMetaResult,
  type OpaqueScanChain,
  type UnifiedOwnedOutput,
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

export type { VerifyReputationArgs } from "@opaquecash/psr-chain";
export type {
  ArtifactPaths,
  ProofProgressCallback,
} from "@opaquecash/psr-prover";
export {
  DEFAULT_REPUTATION_ARTIFACT_PATHS,
  DEFAULT_REPUTATION_ARTIFACTS_ORIGIN,
} from "@opaquecash/psr-prover";
export type { ProofData } from "@opaquecash/psr-core";
export { buildActionScope, externalNullifierFromScope } from "@opaquecash/psr-core";

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

export {
  SETUP_MESSAGE,
  deriveKeysFromSignature,
  computeStealthAddressAndViewTag,
  recomputeStealthSendFromEphemeralPrivateKey,
  ephemeralPrivateKeyToCompressedPublicKey,
  stealthMetaAddressToHex,
  keysToStealthMetaAddress,
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
