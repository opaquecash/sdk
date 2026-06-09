import { parseAbi, parseAbiItem } from "viem";

/** UABSender — cross-chain announce + the legacy Announcement event. */
export const uabSenderAbi = parseAbi([
  "function announceWithRelay(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata, uint8 consistencyLevel) payable returns (uint64)",
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
  "event RelayedAnnouncement(uint64 indexed sequence, bytes payload)",
]);

/** UABReceiver — verify an incoming VAA and re-emit it locally. */
export const uabReceiverAbi = parseAbi([
  "function receiveAnnouncement(bytes encodedVaa)",
  "function setExpectedEmitter(uint16 chainId, bytes32 emitter)",
  "function expectedEmitter() view returns (bytes32)",
  "function expectedEmitterChain() view returns (uint16)",
  "event CrossChainAnnouncement(uint16 indexed sourceChain, bytes32 indexed sourceEmitter, uint64 sequence, bytes payload)",
]);

/** Wormhole Core Contract — the message fee charged by publishMessage. */
export const wormholeCoreAbi = parseAbi(["function messageFee() view returns (uint256)"]);

/** Typed event for `getLogs`. */
export const crossChainAnnouncementEvent = parseAbiItem(
  "event CrossChainAnnouncement(uint16 indexed sourceChain, bytes32 indexed sourceEmitter, uint64 sequence, bytes payload)",
);

/** Typed event for reading the published sequence from a send receipt. */
export const relayedAnnouncementEvent = parseAbiItem(
  "event RelayedAnnouncement(uint64 indexed sequence, bytes payload)",
);
