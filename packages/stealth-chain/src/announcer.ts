import type {
  PublicClient,
  WalletClient,
  Address,
  Hex,
  Chain,
  Transport,
  Account,
} from "viem";
import { decodeEventLog } from "viem";
import {
  decodeAnnouncementArgs,
  type AnnouncementDecoded,
} from "@opaquecash/stealth-core";
import { stealthAddressAnnouncerAbi } from "./abis.js";

/**
 * Publish an `Announcement` on `StealthAddressAnnouncer`.
 *
 * @param wallet - Wallet paying gas; often a dedicated “announcer” signer.
 * @param params - `schemeId`, derived `stealthAddress`, compressed ephemeral pubkey, metadata (view tag first byte).
 */
export async function announceStealthTransfer<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account | undefined,
>(
  wallet: WalletClient<TTransport, TChain, TAccount>,
  params: {
    announcerAddress: Address;
    schemeId: bigint;
    stealthAddress: Address;
    /** Compressed ephemeral secp256k1 pubkey bytes as hex. */
    ephemeralPubKey: Hex;
    /** Metadata; Opaque uses `metadata[0]` as view tag. */
    metadata: Hex;
  },
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("Wallet client has no account");
  const hash = await wallet.writeContract({
    address: params.announcerAddress,
    abi: stealthAddressAnnouncerAbi,
    functionName: "announce",
    args: [
      params.schemeId,
      params.stealthAddress,
      params.ephemeralPubKey,
      params.metadata,
    ],
    chain: wallet.chain,
    account,
  } as Parameters<typeof wallet.writeContract>[0]);
  return hash;
}

/**
 * Options for {@link watchAnnouncements}.
 */
export interface WatchAnnouncementsOptions {
  /** `StealthAddressAnnouncer` address. */
  announcerAddress: Address;
  /** Inclusive lower bound block for log subscription / polling. */
  fromBlock?: bigint;
  /** Called for each decoded announcement (sync errors should be handled by the caller). */
  onAnnouncement: (announcement: AnnouncementDecoded) => void;
  /** Invoked when the underlying watcher stops or errors (viem-dependent). */
  onError?: (error: Error) => void;
}

/**
 * Subscribe to `Announcement` logs and decode them into {@link AnnouncementDecoded}.
 *
 * @param publicClient - Viem public client for the target chain.
 * @param options - Announcer address and callbacks.
 * @returns Unsubscribe function (call to stop watching).
 */
export function watchAnnouncements(
  publicClient: PublicClient,
  options: WatchAnnouncementsOptions,
): () => void {
  return publicClient.watchContractEvent({
    address: options.announcerAddress,
    abi: stealthAddressAnnouncerAbi,
    eventName: "Announcement",
    fromBlock: options.fromBlock,
    onLogs: (logs) => {
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: stealthAddressAnnouncerAbi,
            data: log.data,
            topics: log.topics,
            strict: false,
          });
          if (decoded.eventName !== "Announcement") continue;
          const a = decoded.args as unknown as {
            schemeId: bigint;
            stealthAddress: Address;
            caller: Address;
            ephemeralPubKey: Hex;
            metadata: Hex;
          };
          const normalized = decodeAnnouncementArgs({
            schemeId: a.schemeId,
            stealthAddress: a.stealthAddress,
            caller: a.caller,
            ephemeralPubKey: a.ephemeralPubKey,
            metadata: a.metadata,
            logIndex: log.logIndex ?? undefined,
            blockNumber: log.blockNumber ?? undefined,
            transactionHash: log.transactionHash ?? undefined,
          });
          options.onAnnouncement(normalized);
        } catch (e) {
          options.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      }
    },
    onError: (error) => {
      options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  });
}

/**
 * Fetch historical `Announcement` logs in a block range and decode them.
 *
 * @param publicClient - Viem public client.
 * @param params - Announcer address and block range.
 * @returns Decoded announcements in log order.
 */
export async function fetchAnnouncementsRange(
  publicClient: PublicClient,
  params: {
    announcerAddress: Address;
    fromBlock: bigint;
    toBlock: bigint | "latest";
  },
): Promise<AnnouncementDecoded[]> {
  const logs = await publicClient.getContractEvents({
    address: params.announcerAddress,
    abi: stealthAddressAnnouncerAbi,
    eventName: "Announcement",
    fromBlock: params.fromBlock,
    toBlock: params.toBlock,
  });

  const out: AnnouncementDecoded[] = [];
  for (const log of logs) {
    const decoded = decodeEventLog({
      abi: stealthAddressAnnouncerAbi,
      data: log.data,
      topics: log.topics,
      strict: false,
    });
    if (decoded.eventName !== "Announcement") continue;
    const a = decoded.args as unknown as {
      schemeId: bigint;
      stealthAddress: Address;
      caller: Address;
      ephemeralPubKey: Hex;
      metadata: Hex;
    };
    out.push(
      decodeAnnouncementArgs({
        schemeId: a.schemeId,
        stealthAddress: a.stealthAddress,
        caller: a.caller,
        ephemeralPubKey: a.ephemeralPubKey,
        metadata: a.metadata,
        logIndex: log.logIndex ?? undefined,
        blockNumber: log.blockNumber ?? undefined,
        transactionHash: log.transactionHash ?? undefined,
      }),
    );
  }
  return out;
}
