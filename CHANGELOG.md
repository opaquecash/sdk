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
- **`@opaquecash/stealth-chain`**: `EvmAdapter` implements `ChainAdapter` by wrapping the
  existing viem registry/announcer helpers (`fetchAnnouncementsRange`, `watchAnnouncements`,
  `getStealthMetaAddress`); `evmAnnouncementToNeutral` maps decoded EVM events to the
  chain-neutral `Announcement`. The EVM read path is unchanged.
- **`@opaquecash/opaque`**: `OpaqueClient.scan({ chains: ["ethereum","solana"] })` — one wallet,
  one unified inbox across both chains. Each chain's announcements are fetched through its
  `ChainAdapter` and run through the same WASM view-tag + DKSAP filter; results are tagged with
  `chain` / `chainId` (`UnifiedOwnedOutput`). Adds optional `solana` config, the
  `announcementToIndexerRow` mapper, and re-exports the adapters + interface so one package is the
  full surface.
- **Stealth sweep / withdrawal.** `@opaquecash/stealth-chain-solana` adds
  `buildStealthSweepTransaction` / `sweepStealthSol` (+ `SolanaAdapter.sweepStealthSol`): full SOL
  balance minus fee, signed by the derived stealth keypair. `@opaquecash/stealth-chain` adds
  `planStealthSweep` / `sweepStealthNative`: full ETH balance minus gas, signed by the
  reconstructed stealth key. `OpaqueClient.sweep({ output, chain, destination })` unifies both — the
  on-chain `from` is the stealth address itself, preserving unlinkability.
- **PSR V2 codecs (chain-neutral)** in `@opaquecash/psr-core`: schema utilities (`computeSchemaId`,
  `parseFieldDefs` / `fieldDefsToString`, `packSchemaIdToField`, `SchemaV2`/`FieldDef` types) and
  attestation codecs (`computeUid`, `encodeAttestationData` / `decodeAttestationData`,
  `encodeV2AttestationMetadata` — the 130-byte `0xB2` announce marker — `randomNonce`, `isZeroUid`).
  Ported from the frontends; re-exported from `@opaquecash/opaque`.
- **`@opaquecash/psr-chain-solana`** — Solana PSR V2 integration (counterpart to `psr-chain`):
  schema registry (`computeSchemaId`, `deriveSchemaPda`, register/delegate/deprecate builders,
  `parseSchemaPda`, `fetchAllSchemas`), attestation engine V2 (`deriveAttestationPda`,
  `buildAttestInstruction` / `buildRevokeInstruction`, `parseAttestationPda`,
  `fetchAllAttestations`), and the reputation verifier (`encodeGroth16Proof`, PDA derivers,
  `fetchLatestValidMerkleRoot`, `buildVerifyReputationInstruction`, `submitReputationProof`).
  Anchor discriminators via `sha256("global:<method>")`; program ids from the centralized
  `getSolanaDeployment`. Re-exported from `@opaquecash/opaque` as `solanaPsr`.
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
