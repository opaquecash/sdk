# Changelog

All notable changes to the Opaque SDK packages.

## Unreleased

### Added
- **`@opaquecash/adapter`** — chain-agnostic `ChainAdapter` interface and chain-neutral
  `Announcement` type, mirroring the Rust `ChainAdapter` trait in `opaque-scanner`. The shared
  contract every per-chain adapter implements and the universal scanner consumes; ships the
  Wormhole chain-id constants.
- **`@opaquecash/stealth-chain-solana`** — Solana (`@solana/web3.js`) registry + announcer
  integration, the counterpart to `@opaquecash/stealth-chain`: program ids and cluster config,
  registry-entry PDA derivation, `register_keys` / `announce` instruction builders,
  `Announcement` log decoding, historical `fetchAnnouncementsRange` + live `watchAnnouncements`,
  deterministic stealth Solana keypair derivation, and `SolanaAdapter` (implements
  `ChainAdapter`). Vendors the deployed `stealth_announcer` IDL. No ambient config: pass a
  `Connection`, `rpcUrl`, or `cluster`.
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
