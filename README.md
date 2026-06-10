<div align="center">

# Opaque SDK

[![CI](https://github.com/opaquecash/sdk/actions/workflows/sdk-test.yml/badge.svg)](https://github.com/opaquecash/sdk/actions/workflows/sdk-test.yml)

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

### One inbox across both chains

`OpaqueClient.scan` fetches each chain through its `ChainAdapter` and runs the same WASM
view-tag + DKSAP filter, so one wallet has one inbox. Sweeping reconstructs the one-time key and
sends from the stealth address itself.

```ts
const opaque = await OpaqueClient.create({
  chainId: 11155111,
  rpcUrl: "https://rpc.sepolia.org",
  walletSignature: userSignature,
  ethereumAddress: userAddress,
  wasmModuleSpecifier: "https://www.opaque.cash/pkg/cryptography.js",
  solana: { cluster: "devnet" },            // only needed to scan Solana
});

const inbox = await opaque.scan({ chains: ["ethereum", "solana"] });  // UnifiedOwnedOutput[]
await opaque.sweep({ output: inbox[0], chain: inbox[0].chain, destination: freshAddress });
```

## Packages

| Package | Purpose | Chain-coupled |
|---|---|:---:|
| **`@opaquecash/opaque`** | Unified client — start here | — |
| `@opaquecash/stealth-core` | EIP-5564 types, helpers, 96-byte UAB payload codec | no |
| `@opaquecash/stealth-wasm` | Bindings to the Rust→WASM cryptography module | no |
| `@opaquecash/stealth-chain` | Registry + Announcer viem helpers/ABIs | EVM |
| `@opaquecash/stealth-balance` | Balance aggregation by token | no |
| `@opaquecash/uab` | Cross-chain announce + VAA fetch + receiver scan | EVM |
| `@opaquecash/psr-core` | PSR types, action-scope / nullifier derivation, V2 schema + attestation codecs | no |
| `@opaquecash/psr-prover` | Groth16 proving (snarkjs) over the PSR circuit | no |
| `@opaquecash/psr-chain` | Reputation verifier viem helpers | EVM |
| `@opaquecash/adapter` | Chain-agnostic `ChainAdapter` interface + chain-neutral `Announcement` | no |
| `@opaquecash/stealth-chain-solana` | Registry + Announcer + scan + sweep (`SolanaAdapter`, web3.js) | Solana |
| `@opaquecash/psr-chain-solana` | Schema registry, attestation engine, reputation verifier (web3.js) | Solana |

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

Solana devnet program ids ship in `@opaquecash/stealth-chain-solana`
(`getSolanaDeployment("devnet")`):

| | Solana devnet |
|---|---|
| StealthMetaAddressRegistry | `E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno` |
| StealthAddressAnnouncer | `HGFn2fH7bVQ5cSuiG52NjzN9m11YrB3FZUfoN9b9A5jf` |
| SchemaRegistry / AttestationEngineV2 | `FbgMJYGWnLKLcrKYS1NxM5uER1ihQkYLMTLs4STuDMWB` / `4T9kPCVCFGdEuLpEqRJihsPCbEEo2LWWDEPFvUESEqtM` |
| Groth16Verifier / ReputationVerifier | `6mFaKyp7F4NqNeoiBLEWSqy5wJSk7rWf1EYumVXgHvhQ` / `BSnkCDoTpgNVN5BbF3aN5L5EJPiaYUkqqj9MHp8kaqWM` |

All addresses are centralized in the SDK (`@opaquecash/opaque` `chains.ts` for EVM,
`@opaquecash/stealth-chain-solana` for Solana, `@opaquecash/uab` for the UAB). Consuming apps must
not hardcode addresses — read them from the SDK.

## WASM

Stealth scanning, key reconstruction, and PSR witness generation run in a Rust→WASM module
([`opaque-scanner`](https://crates.io/crates/opaque-scanner)). The SDK never vendors the binary —
`@opaquecash/stealth-wasm` loads it from a URL you provide as `wasmModuleSpecifier`, so every
surface (SDK, docs playground, app) uses the same artifact.

### Build step

The module is produced from the `opaque-scanner` crate with `wasm-pack` (target `web`):

```bash
# in the opaquecash/scanner repo
wasm-pack build --target web --out-dir pkg --out-name cryptography
```

This emits `pkg/cryptography.js` (the JS glue) and `pkg/cryptography_bg.wasm`. Host the `pkg/`
directory (the project serves it at `https://www.opaque.cash/pkg/`) or bundle it with your app,
then pass the glue URL:

```ts
await OpaqueClient.create({
  /* … */
  wasmModuleSpecifier: new URL("/pkg/cryptography.js", import.meta.url).href,
});
```

Do not copy `cryptography_bg.wasm` into app/doc repos — point at the single built artifact.

## Develop

```bash
npm install
npm run build      # builds all packages in dependency order
npm test           # builds, then runs vitest (unit + UAB; live Sepolia test opt-in)
```

The live cross-chain test runs only when `SEPOLIA_RPC_URL` is set, so CI stays fast and offline.

### Live PSR E2E tests (opt-in)

`tests/psr-e2e.test.ts` and `tests/psr-e2e-solana.test.ts` drive the full issuer flow through
`OpaqueClient` (register a schema, list it, issue an attestation, list it) against the live
testnets. They SEND transactions, so they are skipped unless their env vars are set:

```bash
# Ethereum (Sepolia) — funded issuer
SEPOLIA_RPC_URL=https://...
SEPOLIA_ISSUER_PRIVATE_KEY=0x...

# Solana (devnet) — funded issuer keypair (file path, inline JSON byte array, or base58 secret)
SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
SOLANA_ISSUER_KEYPAIR=/path/to/id.json
```

Run one chain or both:

```bash
SEPOLIA_RPC_URL=… SEPOLIA_ISSUER_PRIVATE_KEY=… npm test
SOLANA_DEVNET_RPC_URL=… SOLANA_ISSUER_KEYPAIR=… npm test
```

Each run uses a timestamped schema name so it is independent. The PSR admin API needs no WASM, so
these tests omit `wasmModuleSpecifier`. Unit tests (including offline PSR-admin coverage in
`tests/psr-admin.test.ts`) always run; the live tests stay skipped in CI.

## Roadmap

See [ROADMAP.md](ROADMAP.md). Phase 2 (Solana adapter + universal cross-chain scan/sweep + PSR on
Solana) has landed; next are the unified signer and `@opaquecash/deployments`, then the privacy
pool (Phase 3), the decentralised relayer market (Phase 4), and the ONS naming layer.

## License

Apache-2.0.
