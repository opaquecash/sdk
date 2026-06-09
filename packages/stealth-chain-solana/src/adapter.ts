/**
 * {@link SolanaAdapter} — the Solana implementation of `@opaquecash/adapter`'s
 * {@link ChainAdapter}. Wraps a `Connection` plus a {@link SolanaDeployment} (program ids)
 * and exposes the chain-neutral read/scan surface the universal scanner consumes, alongside
 * Solana-specific instruction builders for the app's wallet layer to sign.
 */

import {
  Connection,
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
    return fetchAnnouncementsRange(this.connection, {
      announcerProgramId: this.deployment.stealthAnnouncer,
      limit: opts.limit,
      commitment: this.commitment,
    });
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
}
