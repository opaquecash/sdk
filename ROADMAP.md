# Opaque SDK & Protocol Roadmap

What the SDK exposes today and where it's going, aligned with the protocol's execution plan.
The SDK is the integration layer for every phase — each capability lands as new methods on
`@opaquecash/opaque` (and a focused package) without breaking existing callers.

Every protocol phase is **shipped and live on Ethereum Sepolia and Solana devnet**. The work
that remains is hardening toward mainnet (audits + production deployments), not new surface.

## Shipped (live on testnet)

One client, both chains. `OpaqueClient.fromWallet({ wallets: { ethereum, solana } })` derives
keys from a single wallet signature and serves every flow below.

### Foundations

- **Phase 0 — core.** Canonical key derivation, cross-validated DKSAP vectors, the Rust→WASM
  scanner (`opaque-scanner`), and a chain-agnostic core (`ChainAdapter` trait in Rust,
  mirrored by `@opaquecash/adapter` in TypeScript).
- **PSR V2 — both chains.** Schema registry, attestation engine, and Groth16 verifier deployed
  on Sepolia **and** Solana devnet. Chain-neutral codecs in `@opaquecash/psr-core`; per-chain
  integration in `@opaquecash/psr-chain` / `@opaquecash/psr-chain-solana`; the full cross-chain
  PSR admin API (`createSchema`, `issueAttestation`, `getMyIssuedAttestations`, …) on
  `OpaqueClient`, each taking `chain: "ethereum" | "solana"`.

### Phase 1 — Universal Announcement Bus

- Cross-chain announcements over Wormhole, live Sepolia ⇄ Solana devnet (both directions).
  `@opaquecash/uab` + `OpaqueClient.buildAnnounceWithRelay` / `scanCrossChain`.

### Phase 2 — Universal scanner + cross-chain adapters

The SDK is fully chain-agnostic: one client serves Ethereum **and** Solana.

- **`@opaquecash/adapter`** — the `ChainAdapter` interface mirroring the Rust trait, plus the
  chain-neutral `Announcement` type and Wormhole chain-id constants.
- **`EvmAdapter`** (`@opaquecash/stealth-chain`) and **`SolanaAdapter`**
  (`@opaquecash/stealth-chain-solana`) — per-chain reads/builders behind one interface, plus
  deterministic stealth destinations and stealth sweeps on each chain.
- **Universal scan** — `OpaqueClient.scan({ chains: ["ethereum", "solana"] })` returns one
  merged inbox. Each chain's native announcements run through the shared WASM view-tag + DKSAP
  filter, and cross-chain UAB results fold into the same call (`includeCrossChain`, on by
  default when Ethereum + UAB are configured), so native + relayed arrive together, tagged with
  `chain` / `chainId`.
- **Unified signer** — `@opaquecash/opaque`'s `signer.ts` abstracts EIP-1193 and the Solana
  wallet-adapter behind `fromWallet`.
- **`@opaquecash/deployments`** — generated addresses/ABIs/IDLs/program ids, the single source
  of deployment config (regenerated via `npm run generate` in the chain repos). The SDK ingests
  config instead of importing from chain repos.
- **PSR on Solana** — `@opaquecash/psr-chain-solana` (schema registry, attestation engine V2,
  reputation verifier), the peer to `@opaquecash/psr-chain`.

### Phase 3 — Privacy pool (amount privacy)

- **`@opaquecash/privacy-pool`** — shielded `deposit → withdraw` over the Privacy Pools
  (Buterin/Soleimani association-set) construction: Poseidon commitments/trees byte-identical
  to circuit and contract, withdrawal witness + Groth16 proving, on-chain deposit/withdraw
  builders, and association-set resolution (`reconstructAspSetFromDeposits` /
  `resolveAspSetViaEns`). Live on both chains. **Audited circuits gate mainnet.**

### Phase 4 — Decentralised relayer market

- **`@opaquecash/relayer-client`** — gas-private submission through the permissionless market:
  commit → bid → encrypted payload → submit, with stake-weighted winner selection and
  NaCl-box-sealed delivery. PSR verify and pool withdrawals submit without linking the user's
  gas wallet. Relay is wired into `sendStealthPayment` and the gasless token sweeps on
  `OpaqueClient`.

### Conditional disclosure — threshold viewing keys

- **`@opaquecash/disclosure`** — two surfaces: a Shamir **escrow backstop** of the CSAP viewing
  key (`splitViewingKey` / `recoverViewingKey`), and **active disclosure** — a pool-scoped
  Groth16 proof gated by a custodian FROST(secp256k1, Taproot) quorum's BIP-340 signature
  (`buildDisclosureWitness`, `generateDisclosureProof`, `verifyQuorumSignature`). Live on both
  chains. The `tools/frost-custodian` Rust CLI runs the DKG + 2-round threshold signing.

### ONS — naming layer

- `OpaqueClient.resolveOpaqueMetaAddress("alice.opqtest.eth")` — one name resolving a stealth
  meta-address on both chains (ENS wildcard resolver on Ethereum, Wormhole-mirrored PDA on
  Solana), plus `registerOpaqueName` / `claimOpaqueName`. Rides the Phase 1 UAB and Phase 2
  adapters. `resolveRecipient` accepts names, `0x…`, pubkeys, `ipfs://`, `.eth`, and `.sol`.

### SDK packaging

- Standalone `opaquecash/sdk` repo; 17 published `@opaquecash/*` packages; vitest suite with an
  80% line-coverage gate on the core surface and opt-in live E2E suites (PSR issuance,
  cross-chain) gated by env vars.

## Toward mainnet (next)

The protocol surface is feature-complete on testnet; mainnet is gated on hardening, not new
methods.

- **Audits + audited circuits.** Privacy-pool and disclosure circuits must be audited before
  mainnet; relayer-market and PSR contracts enter external review.
- **Mainnet deployments.** Promote each chain's contracts/programs from Sepolia + Solana devnet
  to mainnet; `@opaquecash/deployments` gains the mainnet entries.
- **Additional chains.** New `ChainAdapter` implementations land additively behind the existing
  seam — no client changes for callers.

## Developer experience

- **Docs** → [docs.opaque.cash](https://docs.opaque.cash) with a TypeDoc-generated API
  reference (`typedoc.json`, entry points `@opaquecash/opaque` + `@opaquecash/react`). Next: a
  live, SDK-backed playground (send/scan/prove/cross-chain in-browser against testnet).
- **Framework adapters** — `@opaquecash/react` ships `OpaqueProvider`, `useScan`, and
  `useStealthBalance`; more hooks and wallet-adapter integrations to follow.
- **Examples** — runnable flows under [`examples/`](examples/) (`from-wallet`, `send`, `scan`,
  `psr-prove`, `ons-resolve`, `uab-readonly`, `gas-private-submit`, gasless sweeps on both
  chains). The goal remains weekend integration; end-to-end sample apps per flow are next.

## Compatibility principles

- Additive only: new chains/features are new methods, never breaking changes to existing ones.
- Chain-agnostic core stays pure (no chain libs); chain coupling lives behind adapters.
- The protocol is specified in `opaquecash/spec` before code; the SDK tracks the spec.
