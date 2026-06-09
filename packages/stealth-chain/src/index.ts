/**
 * `@opaquecash/stealth-chain` — Ethereum (viem) integration for the stealth registry and announcer.
 *
 * ABIs ship alongside this package; use {@link registerStealthMetaAddress}, {@link getStealthMetaAddress},
 * and {@link watchAnnouncements} as the reference decoding path for indexers.
 *
 * @packageDocumentation
 */

export {
  stealthAddressAnnouncerAbi,
  stealthMetaAddressRegistryAbi,
} from "./abis.js";

export type {
  OpaqueClientConfig,
  StealthChainAddresses,
} from "./config.js";
export {
  requireStealthAddresses,
  metaAddressBytesToHex,
} from "./config.js";

export {
  registerStealthMetaAddress,
  getStealthMetaAddress,
} from "./registry.js";

export type { WatchAnnouncementsOptions } from "./announcer.js";
export {
  announceStealthTransfer,
  watchAnnouncements,
  fetchAnnouncementsRange,
} from "./announcer.js";
