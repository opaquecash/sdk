/**
 * {@link SolanaAdapter} — the Solana implementation of `@opaquecash/adapter`'s
 * {@link ChainAdapter}. Wraps a `Connection` plus a {@link SolanaDeployment} (program ids)
 * and exposes the chain-neutral read/scan surface the universal scanner consumes, alongside
 * Solana-specific instruction builders for the app's wallet layer to sign.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  type Finality,
} from "@solana/web3.js";
import {
  type ChainAdapter,
  type Announcement,
  type AnnouncementHandlers,
  type FetchAnnouncementsOptions,
  type Hex,
  WORMHOLE_CHAIN_SOLANA,
} from "@opaquecash/adapter";
import {
  CLUSTER_ENDPOINTS,
  getSolanaDeployment,
  type SolanaCluster,
  type SolanaDeployment,
} from "./programs.js";
import {
  buildAnnounceInstruction,
  fetchAnnouncementsRange,
  watchAnnouncements,
} from "./announcer.js";
import { fetchCrossChainAnnouncementsRange } from "./uab-receiver.js";
import {
  type AnnounceWithRelayBuild,
  buildAnnounceWithRelay,
  fetchWormholeMessageFee,
} from "./relay.js";
import { sweepStealthSol } from "./sweep.js";
import {
  buildRegisterKeysInstruction,
  isRegistered,
  resolveMetaAddress,
} from "./registry.js";

/** Construction options for {@link SolanaAdapter}. */
export interface SolanaAdapterConfig {
  /** Pre-built connection (takes precedence over `rpcUrl`/`cluster`). */
  connection?: Connection;
  /** RPC URL to build a connection from (falls back to the cluster's public endpoint). */
  rpcUrl?: string;
  /** Target cluster (default `devnet`); selects bundled program ids and the public RPC. */
  cluster?: SolanaCluster;
  /** Program-id overrides (default: bundled deployment for `cluster`). */
  deployment?: SolanaDeployment;
  /** Read commitment for fetch/watch (default `confirmed`). */
  commitment?: Finality;
}

export class SolanaAdapter implements ChainAdapter {
  readonly chainId = WORMHOLE_CHAIN_SOLANA;
  readonly name = "solana";

  readonly connection: Connection;
  readonly deployment: SolanaDeployment;
  private readonly commitment: Finality;

  constructor(config: SolanaAdapterConfig = {}) {
    const cluster = config.cluster ?? config.deployment?.cluster ?? "devnet";
    this.deployment = config.deployment ?? getSolanaDeployment(cluster);
    this.commitment = config.commitment ?? "confirmed";
    this.connection =
      config.connection ??
      new Connection(config.rpcUrl ?? CLUSTER_ENDPOINTS[cluster], this.commitment);
  }

  async fetchAnnouncements(
    opts: FetchAnnouncementsOptions = {},
  ): Promise<Announcement[]> {
    const native = await fetchAnnouncementsRange(this.connection, {
      announcerProgramId: this.deployment.stealthAnnouncer,
      limit: opts.limit,
      commitment: this.commitment,
    });
    // Merge Ethereum-originated announcements mirrored by the uab-receiver program,
    // normalised to the same shape (their chainId stays the origin chain's).
    const includeCrossChain = opts.includeCrossChain ?? Boolean(this.deployment.uabReceiver);
    if (!includeCrossChain) return native;
    const cross = await fetchCrossChainAnnouncementsRange(this.connection, {
      uabReceiverProgramId: this.deployment.uabReceiver,
      limit: opts.limit,
      commitment: this.commitment,
    });
    return [...native, ...cross];
  }

  async resolveMetaAddress(identity: string): Promise<Hex | null> {
    return resolveMetaAddress(this.connection, {
      registryProgramId: this.deployment.stealthRegistry,
      registrant: identity,
    });
  }

  async isRegistered(identity: string): Promise<boolean> {
    return isRegistered(this.connection, {
      registryProgramId: this.deployment.stealthRegistry,
      registrant: identity,
    });
  }

  watchAnnouncements(handlers: AnnouncementHandlers): () => void {
    return watchAnnouncements(this.connection, {
      announcerProgramId: this.deployment.stealthAnnouncer,
      commitment: this.commitment,
      onAnnouncement: handlers.onAnnouncement,
      onError: handlers.onError,
    });
  }

  // ---------------------------------------------------------------------------
  // Solana-specific instruction builders (app's wallet layer signs + submits).
  // ---------------------------------------------------------------------------

  /** Build a `register_keys` instruction for `registrant`'s 66-byte meta-address. */
  buildRegisterKeysInstruction(
    registrant: PublicKey,
    stealthMetaAddress: Uint8Array,
    schemeId?: bigint,
  ): TransactionInstruction {
    return buildRegisterKeysInstruction({
      registryProgramId: this.deployment.stealthRegistry,
      registrant,
      stealthMetaAddress,
      schemeId,
    });
  }

  /** Build an `announce` instruction (the `caller` signs and pays). */
  buildAnnounceInstruction(params: {
    caller: PublicKey;
    stealthAddress: Uint8Array;
    ephemeralPubKey: Uint8Array;
    metadata: Uint8Array;
    schemeId?: bigint;
  }): TransactionInstruction {
    return buildAnnounceInstruction({
      announcerProgramId: this.deployment.stealthAnnouncer,
      ...params,
    });
  }

  /**
   * Build a cross-chain `announce_with_relay` instruction (emits locally AND relays over Wormhole)
   * plus the fresh message keypair that must co-sign the transaction. Resolves the announcer and
   * Wormhole core program ids from this adapter's deployment.
   */
  buildAnnounceWithRelay(params: {
    caller: PublicKey;
    stealthAddress: Uint8Array;
    ephemeralPubKey: Uint8Array;
    metadata: Uint8Array;
    schemeId?: bigint;
    batchId?: number;
    wormholeFee?: bigint;
  }): AnnounceWithRelayBuild {
    return buildAnnounceWithRelay({
      announcerProgramId: this.deployment.stealthAnnouncer,
      wormholeCore: this.deployment.wormholeCore,
      ...params,
    });
  }

  /** Current Wormhole message fee (lamports) for `announce_with_relay`; `0n` on devnet. */
  async fetchWormholeMessageFee(): Promise<bigint> {
    return fetchWormholeMessageFee(this.connection, this.deployment.wormholeCore);
  }

  /**
   * Sweep the full SOL balance of a one-time stealth account to `destination`. The stealth
   * keypair signs and pays its own fee; pass the reconstructed 32-byte secp256k1 stealth
   * private key (or the derived keypair).
   */
  async sweepStealthSol(params: {
    stealthPrivKey?: Uint8Array;
    stealthKeypair?: Keypair;
    destination: PublicKey | string;
  }): Promise<{ signature: string; sweepLamports: bigint; feeLamports: bigint }> {
    return sweepStealthSol(this.connection, {
      ...params,
      commitment: this.commitment,
    });
  }
}
