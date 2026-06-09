# @opaquecash/adapter

The chain-agnostic `ChainAdapter` interface for the Opaque SDK.

The DKSAP payment layer (key derivation, view-tag matching, stealth-address recovery) is
identical across chains. Only *how announcements are fetched and submitted* differs. This
package is the shared TypeScript contract — mirroring the Rust `ChainAdapter` trait in
`opaque-scanner` — that concrete adapters implement and the universal scanner consumes.

## Exports

- `ChainAdapter` — the interface: `chainId`, `name`, `fetchAnnouncements`,
  `resolveMetaAddress`, `isRegistered`, optional `watchAnnouncements`.
- `Announcement` — the chain-neutral announcement shape (mirrors
  `opaque_scanner::dksap::Announcement`).
- `FetchAnnouncementsOptions`, `AnnouncementHandlers`.
- `WORMHOLE_CHAIN_ETHEREUM` (2), `WORMHOLE_CHAIN_SOLANA` (1).
- `Hex`.

## Implementations

- `@opaquecash/stealth-chain-solana` → `SolanaAdapter`.
- `EvmAdapter` (planned) wraps `@opaquecash/stealth-chain` / `@opaquecash/psr-chain`.

Submission (signing) is intentionally not part of the interface: concrete adapters expose
chain-specific transaction / instruction builders and the app's wallet layer signs them.
