/**
 * {@link EvmAdapter} — the Ethereum implementation of `@opaquecash/adapter`'s
 * {@link ChainAdapter}. It wraps this package's existing viem helpers
 * ({@link fetchAnnouncementsRange}, {@link watchAnnouncements}, {@link getStealthMetaAddress})
 * behind the chain-neutral interface so one universal scanner serves Ethereum and Solana.
 *
 * This is a thin wrapper: the EVM read path is unchanged, so the existing exports stay the
 * reference decoding path for indexers.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  http,
} from "viem";
import {
  type ChainAdapter,
  type Announcement,
  type AnnouncementHandlers,
  type FetchAnnouncementsOptions,
  WORMHOLE_CHAIN_ETHEREUM,
} from "@opaquecash/adapter";
import {
  EIP5564_SCHEME_SECP256K1,
  type AnnouncementDecoded,
} from "@opaquecash/stealth-core";
import { fetchAnnouncementsRange, watchAnnouncements } from "./announcer.js";
import { getStealthMetaAddress } from "./registry.js";

const META_ADDRESS_BYTES = 66;

/** Construction options for {@link EvmAdapter}. */
export interface EvmAdapterConfig {
  /** Pre-built viem public client (takes precedence over `rpcUrl`). */
  publicClient?: PublicClient;
  /** RPC URL to build a public client from when `publicClient` is omitted. */
  rpcUrl?: string;
  /** `StealthAddressAnnouncer` address. */
  announcerAddress: Address;
  /**
   * `UABSender` address. `announceWithRelay` mirrors the ERC-5564 `Announcement` event from
   * this contract (the announcer singleton is left untouched), so relay-sent payments are
   * only locally scannable when its logs are read too.
   */
  uabSenderAddress?: Address;
  /** `StealthMetaAddressRegistry` address. */
  registryAddress: Address;
  /** Underlying EVM chain id (e.g. 11155111 Sepolia); informational. Wormhole id is fixed at 2. */
  evmChainId?: number;
  /** EIP-5564 scheme id for registry reads (default 1, secp256k1). */
  schemeId?: bigint;
  /** Lower-bound block for fetch/watch when not overridden per call (default 0). */
  fromBlock?: bigint;
}

/** Map a viem-decoded EVM announcement to the chain-neutral {@link Announcement}. */
export function evmAnnouncementToNeutral(a: AnnouncementDecoded): Announcement {
  return {
    stealthAddress: a.stealthAddress as Hex,
    ephemeralPubKey: a.ephemeralPubKey,
    viewTag: a.metadata.length > 0 ? a.metadata[0] : 0,
    metadata: a.metadata,
    chainId: WORMHOLE_CHAIN_ETHEREUM,
    txHash: a.transactionHash,
    cursor: a.blockNumber,
    logIndex: a.logIndex,
  };
}

export class EvmAdapter implements ChainAdapter {
  readonly chainId = WORMHOLE_CHAIN_ETHEREUM;
  readonly name = "ethereum";
  /** Underlying EVM chain id (Wormhole {@link chainId} stays 2). */
  readonly evmChainId?: number;
  readonly publicClient: PublicClient;

  private readonly announcerAddresses: Address | Address[];
  private readonly registryAddress: Address;
  private readonly schemeId: bigint;
  private readonly fromBlock: bigint;

  constructor(config: EvmAdapterConfig) {
    if (!config.publicClient && !config.rpcUrl) {
      throw new Error("EvmAdapter requires either publicClient or rpcUrl");
    }
    this.publicClient = (config.publicClient ??
      createPublicClient({ transport: http(config.rpcUrl) })) as PublicClient;
    this.announcerAddresses = config.uabSenderAddress
      ? [config.announcerAddress, config.uabSenderAddress]
      : config.announcerAddress;
    this.registryAddress = config.registryAddress;
    this.evmChainId = config.evmChainId;
    this.schemeId = config.schemeId ?? BigInt(EIP5564_SCHEME_SECP256K1);
    this.fromBlock = config.fromBlock ?? 0n;
  }

  async fetchAnnouncements(
    opts: FetchAnnouncementsOptions = {},
  ): Promise<Announcement[]> {
    const decoded = await fetchAnnouncementsRange(this.publicClient, {
      announcerAddress: this.announcerAddresses,
      fromBlock: opts.fromCursor ?? this.fromBlock,
      toBlock: opts.toCursor ?? "latest",
    });
    return decoded.map(evmAnnouncementToNeutral);
  }

  async resolveMetaAddress(identity: string): Promise<Hex | null> {
    const bytes = await getStealthMetaAddress(this.publicClient, {
      registryAddress: this.registryAddress,
      registrant: identity as Address,
      schemeId: this.schemeId,
    });
    return hexByteLength(bytes) >= META_ADDRESS_BYTES ? (bytes as Hex) : null;
  }

  async isRegistered(identity: string): Promise<boolean> {
    return (await this.resolveMetaAddress(identity)) != null;
  }

  watchAnnouncements(handlers: AnnouncementHandlers): () => void {
    return watchAnnouncements(this.publicClient, {
      announcerAddress: this.announcerAddresses,
      fromBlock: this.fromBlock,
      onAnnouncement: (decoded) =>
        handlers.onAnnouncement(evmAnnouncementToNeutral(decoded)),
      onError: handlers.onError,
    });
  }
}

function hexByteLength(h: Hex): number {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return s.length / 2;
}
