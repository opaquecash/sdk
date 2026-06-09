<div align="center">

# Opaque SDK

**Stealth payments · Provable reputation · Cross-chain — one TypeScript client.**

[![npm](https://img.shields.io/npm/v/@opaquecash/opaque?style=flat-square&label=%40opaquecash%2Fopaque)](https://www.npmjs.com/package/@opaquecash/opaque)
[![license](https://img.shields.io/badge/license-Apache--2.0-5c7cfa?style=flat-square)](LICENSE)

</div>

The Opaque SDK is the single integration layer for the [Opaque protocol](https://opaque.cash):
unlinkable **stealth payments** (EIP-5564 / DKSAP), privacy-preserving **reputation** (PSR, ZK),
and **cross-chain** announcements over the Universal Announcement Bus (Wormhole). You configure
one client and never touch a chain library, RPC quirk, or circuit detail directly.

> Designed to be integrated in a weekend: one package, one client, calldata you hand to any wallet.

## Install

```bash
npm install @opaquecash/opaque
```

## Quickstart (5 minutes)

```ts
import { OpaqueClient } from "@opaquecash/opaque";

// 1. Configure once. `walletSignature` is the user's signature over SETUP_MESSAGE
//    (HKDF entropy for their viewing/spending keys — never sent on-chain).
const opaque = await OpaqueClient.create({
  chainId: 11155111,                       // Sepolia
  rpcUrl: "https://rpc.sepolia.org",
  walletSignature: userSignature,          // from wallet.signMessage(SETUP_MESSAGE)
  ethereumAddress: userAddress,
  wasmModuleSpecifier: "https://www.opaque.cash/pkg/cryptography.js",
});

// 2. Publish your stealth meta-address so people can pay you by your normal address.
const reg = opaque.buildRegisterMetaAddressTransaction();   // { to, data } -> wallet.sendTransaction

// 3. Pay someone: resolve their meta-address, derive a one-time stealth address, announce.
const { metaAddressHex } = await opaque.resolveRecipientMetaAddress(recipient);
const send = opaque.prepareStealthSend(metaAddressHex!);
const announce = opaque.buildAnnounceTransactionRequest(send);  // { to, data } -> send funds + announce

// 4. Receive: scan announcements (Rust→WASM, view-tag prefilter + DKSAP) and read balances.
const owned = await opaque.filterOwnedAnnouncements(indexerRows);
const balances = await opaque.getBalancesFromAnnouncements(owned);

// 5. Reputation: discover traits and prove one without revealing your address.
const traits = await opaque.discoverTraits();
const proof = await opaque.generateReputationProof({ /* trait, action scope */ });
```

### Cross-chain in two calls (UAB)

A stealth payment announced on one chain becomes visible to the other chain's scanner — no
central server. Sending is one extra method; receiving is uniform with native scanning.

```ts
// Send cross-chain: emits the local announcement AND publishes to Wormhole. `value` is the fee.
const relay = await opaque.buildAnnounceWithRelayRequest(send);   // { to, data, value }

// Receive cross-chain: inbound announcements re-emitted by the UABReceiver, scanned the same way.
const crossChain = await opaque.fetchCrossChainAnnouncements();   // indexer-shaped rows
const owned = await opaque.filterOwnedAnnouncements([...indexerRows, ...crossChain]);
// or, in one step:
const ownedCrossChain = await opaque.scanCrossChain();
```

The off-chain VAA delivery (Wormhole's relayer is EVM-only) is handled by
[`opaquecash/relayer`](https://github.com/opaquecash/relayer). See `spec/UAB.md`.

## Packages

| Package | Purpose | Chain-coupled |
|---|---|:---:|
| **`@opaquecash/opaque`** | Unified client — start here | — |
| `@opaquecash/stealth-core` | EIP-5564 types, helpers, 96-byte UAB payload codec | no |
| `@opaquecash/stealth-wasm` | Bindings to the Rust→WASM cryptography module | no |
| `@opaquecash/stealth-chain` | Registry + Announcer viem helpers/ABIs | EVM |
| `@opaquecash/stealth-balance` | Balance aggregation by token | no |
| `@opaquecash/uab` | Cross-chain announce + VAA fetch + receiver scan | EVM |
| `@opaquecash/psr-core` | PSR types, action-scope / nullifier derivation | no |
| `@opaquecash/psr-prover` | Groth16 proving (snarkjs) over the PSR circuit | no |
| `@opaquecash/psr-chain` | Reputation verifier viem helpers | EVM |

Most apps only import `@opaquecash/opaque`. The modular packages are there when you need a
narrow surface (e.g. a worker that only parses, or a server that only proves).

## Deployments (Testnet)

| | Ethereum Sepolia |
|---|---|
| StealthMetaAddressRegistry | `0x77425e04163d608B876c7f50E34A378624A12067` |
| StealthAddressAnnouncer | `0x840f72249A8bF6F10b0eB64412E315efBD730865` |
| UABSender / UABReceiver | `0x872787c0BD1A0C71e6D1be5a144EB044e0CB2069` / `0x9eF189f7a263F870Cf80f9A89d1349A6AF7b15cF` |
| OpaqueSchemaRegistry / AttestationRegistry | `0xAA5F3942117bD48E7Cd81A500A8b7Bbb122ae80f` / `0x049aF9CBB62387034CDd5403794a94E9c000ACCc` |

These ship as defaults; override any address via `OpaqueClient.create({ contracts: { … } })`.

## WASM

Stealth scanning, key reconstruction, and PSR witness generation run in a Rust→WASM module
([`opaque-scanner`](https://crates.io/crates/opaque-scanner)). Point `wasmModuleSpecifier` at the
hosted build (`https://www.opaque.cash/pkg/cryptography.js`) or your own.

## Develop

```bash
npm install
npm run build      # builds all packages in dependency order
npm test           # builds, then runs vitest (unit + UAB; live Sepolia test opt-in)
```

The live cross-chain test runs only when `SEPOLIA_RPC_URL` is set, so CI stays fast and offline.

## Roadmap

See [ROADMAP.md](ROADMAP.md) — Solana adapter + universal scanner (Phase 2), privacy pool
(Phase 3), decentralised relayer market (Phase 4), and the ONS naming layer.

## License

Apache-2.0.
