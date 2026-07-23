/**
 * `@opaquecash/adapter` — the chain-agnostic `ChainAdapter` interface.
 *
 * Mirrors the Rust `ChainAdapter` trait in `opaque-scanner` (`src/dksap.rs`): the DKSAP
 * *payment* layer — key derivation, view-tag matching, stealth-address recovery — is
 * identical across chains; only *how announcements are fetched and submitted* differs.
 * This package is the shared TypeScript contract that `EvmAdapter` and `SolanaAdapter`
 * implement, and that the universal scanner consumes.
 *
 * Submission (signing) is intentionally **not** part of the interface — concrete adapters
 * expose chain-specific transaction / instruction builders and the app's wallet layer
 * signs them.
 *
 * @packageDocumentation
 */

/** `0x`-prefixed hex string. */
export type Hex = `0x${string}`;

/** Wormhole chain id for Ethereum (mainnet and testnets share id 2). */
export const WORMHOLE_CHAIN_ETHEREUM = 2;
/** Wormhole chain id for Solana (mainnet-beta and devnet share id 1). */
export const WORMHOLE_CHAIN_SOLANA = 1;

/**
 * A chain-neutral stealth announcement, as surfaced by a {@link ChainAdapter}.
 *
 * Mirrors `opaque_scanner::dksap::Announcement`. Each adapter decodes its chain's native
 * event/log into this shape so the cheap view-tag filter and the expensive DKSAP recovery
 * run once, regardless of source chain.
 */
export interface Announcement {
  /** Scanner-matching id: 20-byte EVM-style stealth address, `0x`-prefixed lowercase hex. */
  stealthAddress: Hex;
  /** Sender ephemeral public key: 33-byte compressed secp256k1. */
  ephemeralPubKey: Uint8Array;
  /** View tag (`metadata[0]`) for the cheap pre-filter. */
  viewTag: number;
  /** Raw announcement metadata (scheme-specific payload; `metadata[0]` is the view tag). */
  metadata: Uint8Array;
  /** Wormhole chain id of the source chain (Ethereum = 2, Solana = 1). */
  chainId: number;
  /** Source transaction hash (EVM) or signature (Solana), when known. */
  txHash?: string;
  /** Source cursor: EVM block number or Solana slot, when known. */
  cursor?: bigint;
  /** Log index within the source transaction, when applicable (EVM). */
  logIndex?: number;
}

/** Per-program Solana signature cursors (histories are per address; see `untilSignature`). */
export interface SolanaSignatureCursor {
  /** Cursor for the native stealth-announcer program walk. */
  native?: string;
  /** Cursor for the cross-chain (UAB) receiver program walk. */
  crossChain?: string;
}

/** Options for {@link ChainAdapter.fetchAnnouncements}. */
export interface FetchAnnouncementsOptions {
  /** Inclusive lower bound cursor (EVM block number or Solana slot). */
  fromCursor?: bigint;
  /** Inclusive upper bound cursor; omit for the chain tip. */
  toCursor?: bigint;
  /** Soft cap on the number of source records to scan (adapter-interpreted). */
  limit?: number;
  /**
   * Solana only (signature-cursor chains): stop walking history at this transaction
   * signature (RPC `until`, exclusive). Persist the newest signature after each pass and
   * pass it here so periodic scans fetch only what's new instead of replaying the full
   * signature window. Signature histories are per program address — pass the object form
   * to give the native announcer and the cross-chain (UAB) receiver their own cursors
   * (a string applies to both; a cursor absent from a program's history degrades to a
   * full-window walk, never skipped data). Other adapters ignore it.
   */
  untilSignature?: string | SolanaSignatureCursor;
  /**
   * Solana only: walk backwards starting from this signature (RPC `before`, exclusive) —
   * pagination into history. String or per-program object, as {@link untilSignature}.
   * Other adapters ignore it.
   */
  beforeSignature?: string | SolanaSignatureCursor;
  /**
   * Also include cross-chain (UAB) announcements relayed TO this chain, normalised to the
   * same {@link Announcement} shape with their *origin* `chainId`. Adapter-interpreted:
   * defaults to `true` where the chain has a UAB receiver deployment configured.
   */
  includeCrossChain?: boolean;
}

/** Callbacks for {@link ChainAdapter.watchAnnouncements}. */
export interface AnnouncementHandlers {
  /** Invoked for each decoded announcement (caller handles its own sync errors). */
  onAnnouncement: (announcement: Announcement) => void;
  /** Invoked when the underlying watcher stops or errors. */
  onError?: (error: Error) => void;
}

/**
 * Abstracts chain-specific announcement retrieval and registry reads so the universal
 * scan loop is written once. The universal scanner iterates a set of adapters, calls
 * {@link ChainAdapter.fetchAnnouncements}, then runs the shared view-tag filter and DKSAP
 * recovery on the returned {@link Announcement}s.
 */
export interface ChainAdapter {
  /** Wormhole chain id this adapter serves (Ethereum = 2, Solana = 1). */
  readonly chainId: number;
  /** Human-readable adapter name, e.g. `"ethereum"` or `"solana"`. */
  readonly name: string;

  /** Fetch announcements in chain-neutral form (order is adapter-defined). */
  fetchAnnouncements(opts?: FetchAnnouncementsOptions): Promise<Announcement[]>;

  /**
   * Resolve an identity to its 66-byte stealth meta-address as `0x`-hex, or `null` when
   * unregistered. Identity is an EVM address (Ethereum) or a base58 pubkey (Solana).
   */
  resolveMetaAddress(identity: string): Promise<Hex | null>;

  /** Whether `identity` has a stealth meta-address registered. */
  isRegistered(identity: string): Promise<boolean>;

  /** Optional live subscription to new announcements; returns an unsubscribe function. */
  watchAnnouncements?(handlers: AnnouncementHandlers): () => void;
}
