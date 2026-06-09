/**
 * `@opaquecash/stealth-chain-solana` — Solana (web3.js) integration for the Opaque stealth
 * registry and announcer.
 *
 * Mirrors `@opaquecash/stealth-chain` (EVM/viem): program ids and cluster config, PDA
 * derivation, Anchor instruction builders, `Announcement` log decoding, and {@link SolanaAdapter}
 * (an implementation of `@opaquecash/adapter`'s `ChainAdapter`). All crypto is shared with the
 * EVM path via the chain-neutral DKSAP core; only chain access lives here.
 *
 * @packageDocumentation
 */

export {
  type SolanaCluster,
  type SolanaDeployment,
  SOLANA_DEPLOYMENTS,
  getSolanaDeployment,
  CLUSTER_ENDPOINTS,
  SCHEME_ID_SECP256K1,
  ANNOUNCE_DISCRIMINATOR,
  REGISTER_KEYS_DISCRIMINATOR,
  ANNOUNCEMENT_EVENT_DISCRIMINATOR,
  REGISTRY_ENTRY_SEED,
} from "./programs.js";

export {
  getRegistryEntryPda,
  buildRegisterKeysInstruction,
  decodeRegistryEntryMetaAddress,
  resolveMetaAddress,
  isRegistered,
} from "./registry.js";

export {
  type DecodedAnnouncementEvent,
  buildAnnounceInstruction,
  encodeAnnouncementEventData,
  decodeAnnouncementEventData,
  decodeAnnouncementLogs,
  eventToAnnouncement,
  fetchAnnouncementsRange,
  watchAnnouncements,
} from "./announcer.js";

export {
  deriveStealthSolanaKeypair,
  deriveStealthSolanaAddress,
  deriveStealthSolanaKeypairFromStealthPrivKey,
  deriveStealthSolanaAddressFromStealthPrivKey,
} from "./stealth.js";

export {
  type StealthSweepPlan,
  buildStealthSweepTransaction,
  sweepStealthSol,
} from "./sweep.js";

export {
  SolanaAdapter,
  type SolanaAdapterConfig,
} from "./adapter.js";

// Byte helpers (handy for indexers and tests).
export {
  bytesToHex,
  hexToBytes,
  u64le,
  u32le,
  vecU8,
  concatBytes,
  ByteReader,
} from "./bytes.js";
