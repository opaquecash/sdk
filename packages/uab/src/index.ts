/**
 * `@opaquecash/uab` — Universal Announcement Bus client.
 *
 * Send a stealth announcement cross-chain via the Wormhole Core Contract (`announceWithRelay`),
 * fetch the guardian VAA, and discover inbound cross-chain announcements (`CrossChainAnnouncement`)
 * re-emitted by the UABReceiver — shaped so they flow through the same scanner as native ones.
 * See `spec/UAB.md` and `spec/payload-format.md`.
 *
 * @packageDocumentation
 */

export {
  WORMHOLE_CHAIN,
  CONSISTENCY_FINALIZED,
  CONSISTENCY_SAFE,
  WORMHOLESCAN_TESTNET,
  WORMHOLESCAN_MAINNET,
  UAB_DEPLOYMENTS,
  getUabDeployment,
  requireUabDeployment,
} from "./config.js";
export type { UabDeployment } from "./config.js";

export {
  uabSenderAbi,
  uabReceiverAbi,
  wormholeCoreAbi,
  crossChainAnnouncementEvent,
  relayedAnnouncementEvent,
} from "./abis.js";

export {
  encodeAnnounceWithRelay,
  getWormholeMessageFee,
  buildAnnounceWithRelayRequest,
} from "./sender.js";
export type { AnnounceWithRelayArgs, AnnounceWithRelayRequest } from "./sender.js";

export { fetchVaa } from "./vaa.js";
export type { FetchVaaOptions } from "./vaa.js";

export { fetchCrossChainAnnouncements, toIndexerAnnouncement } from "./receiver.js";
export type { CrossChainAnnouncementRecord, UabIndexerAnnouncement } from "./receiver.js";
