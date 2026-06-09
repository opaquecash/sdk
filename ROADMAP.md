# Opaque SDK & Protocol Roadmap

What the SDK exposes today and where it's going, aligned with the protocol's execution plan.
The SDK is the integration layer for every phase — each phase below lands as new methods on
`@opaquecash/opaque` (and a focused package) without breaking existing callers.

## Done

- **Phase 0 — foundations.** Canonical key derivation, cross-validated DKSAP vectors, the
  Rust→WASM scanner (`opaque-scanner`), and a chain-agnostic core (`ChainAdapter` trait in Rust).
- **PSR V2 (Ethereum).** Schema registry, attestation engine, and Groth16 verifier deployed;
  SDK surfaces schema/attestation/proof flows (`@opaquecash/psr-*`).
- **Phase 1 — Universal Announcement Bus.** Cross-chain announcements over Wormhole, live on
  Sepolia ⇄ Solana devnet (both directions). SDK ships the Ethereum-side UAB surface
  (`@opaquecash/uab` + `OpaqueClient` cross-chain methods).
- **SDK extraction.** Standalone `opaquecash/sdk` repo; published `@opaquecash/*`; test suite.

## Phase 2 — Universal scanner + cross-chain adapters (next)

Make the SDK fully chain-agnostic so one client serves Ethereum **and** Solana.

- **`@opaquecash/adapter`** — a TypeScript `ChainAdapter` interface mirroring the Rust trait:
  `getAnnouncements`, `submitAnnounce`, `read/submit` for registry/PSR, event subscriptions.
- **`EvmAdapter`** (viem) — refactor today's `stealth-chain` / `psr-chain` logic behind the interface.
- **`SolanaAdapter`** (`@solana/web3.js` + `@coral-xyz/anchor`) — `stealth-announcer`,
  `schema-registry`, `attestation-engine-v2`, `uab-receiver`; reads `CrossChainAnnouncement`.
- **Unified signer** abstraction over EIP-1193 and Solana wallet-adapter.
- **`@opaquecash/deployments`** — generated address/ABI/IDL package fed by each chain's deploy
  scripts, so the SDK ingests config instead of importing from chain repos.
- Universal scan: `opaque.scan()` matches native + cross-chain announcements across both chains.

## Phase 3 — Privacy pool (amount privacy)

- SDK surface for shielded deposits/withdrawals and the associated proofs, layered on the
  stealth + PSR primitives. Audited circuits gate mainnet.

## Phase 4 — Decentralised relayer market

- **`@opaquecash/relayer-client`** — submit gas-private jobs to the permissionless relayer market
  (replaces the single Phase-1 relay). Blind job protocol: commit → bid → encrypted proof → submit.
- The UAB Solana-delivery legs move from the trusted Phase-1 relay to this market.

## ONS — naming layer (feature track)

- `resolveOpaqueMetaAddress("alice.opq.eth")` in the SDK: one name resolving a stealth
  meta-address on both chains (ENS wildcard resolver on Ethereum, Wormhole-mirrored PDA on
  Solana), riding the Phase 1 UAB and Phase 2 adapters.

## Developer experience

- **Docs** → Mintlify site (`docs/`) with a TypeDoc-generated API reference and a live,
  SDK-backed playground (send/scan/prove/cross-chain in-browser against testnet).
- **Framework adapters** — `@opaquecash/react` hooks; wallet-adapter integrations.
- **Examples** — end-to-end sample apps per flow; the goal remains weekend integration.

## Compatibility principles

- Additive only: new chains/features are new methods, never breaking changes to existing ones.
- Chain-agnostic core stays pure (no chain libs); chain coupling lives behind adapters.
- The protocol is specified in `opaquecash/spec` before code; the SDK tracks the spec.
