# Changelog

All notable changes to the Opaque SDK packages.

## Unreleased

### Added
- **`@opaquecash/uab`** — Universal Announcement Bus client: `buildAnnounceWithRelayRequest`,
  `getWormholeMessageFee`, `fetchVaa` (Wormholescan), `fetchCrossChainAnnouncements` +
  `toIndexerAnnouncement`, and the Sepolia deployment registry.
- **`@opaquecash/stealth-core`**: the 96-byte cross-chain payload codec
  (`encodeUabPayload` / `decodeUabPayload` / `uabPayloadToMetadata` / `uabStealthAddressEvm`).
- **`@opaquecash/opaque`**: cross-chain methods on `OpaqueClient` —
  `buildAnnounceWithRelayRequest`, `fetchCrossChainAnnouncements`, `scanCrossChain` — plus
  UAB re-exports. Cross-chain announcements scan through the same `filterOwnedAnnouncements` path.
- Test suite (vitest): payload codec against on-chain fixtures, UAB encode/map, PSR scope, and an
  opt-in live Sepolia test.

### Changed
- The SDK now lives in its own repository (`opaquecash/sdk`), extracted from `opaquecash/ethereum`.
