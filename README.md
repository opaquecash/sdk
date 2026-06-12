# Opaque SDK

[![CI](https://github.com/opaquecash/sdk/actions/workflows/sdk-test.yml/badge.svg)](https://github.com/opaquecash/sdk/actions/workflows/sdk-test.yml)
[![npm](https://img.shields.io/npm/v/@opaquecash/opaque?style=flat-square&label=%40opaquecash%2Fopaque)](https://www.npmjs.com/package/@opaquecash/opaque)

TypeScript SDK for the [Opaque protocol](https://opaque.cash): stealth payments
(EIP-5564/DKSAP), ZK reputation (PSR), cross-chain announcements (UAB/Wormhole), ONS
naming, the privacy pool, the gas-private relayer market, and conditional disclosure —
one client over Ethereum Sepolia and Solana devnet.

Full guides and API reference: [docs.opaque.cash](https://docs.opaque.cash). Protocol
specs: [`opaquecash/spec`](https://github.com/opaquecash/spec).

## Quickstart

```bash
npm install @opaquecash/opaque
```

```ts
import { OpaqueClient } from "@opaquecash/opaque";

// One client, both chains. Keys derive from a wallet signature over SETUP_MESSAGE.
const opaque = await OpaqueClient.fromWallet({
  wallets: { ethereum: walletClient, solana: walletAdapter },
  wasmModuleSpecifier: "https://www.opaque.cash/pkg/cryptography.js",
});

await opaque.registerMetaAddress("ethereum");          // be payable by your 0x… address
const { metaAddressHex } = await opaque.resolveRecipient("alice.opqtest.eth"); // or 0x…, pubkey, ipfs://, .eth, .sol
await opaque.sendStealthPayment({ chain: "ethereum", recipient: metaAddressHex, amount });

const inbox = await opaque.scan({ chains: ["ethereum", "solana"] }); // native + cross-chain, one inbox
await opaque.sweep({ output: inbox[0], chain: inbox[0].chain, destination });
```

See [`examples/`](examples/) for runnable flows (send, scan, PSR prove, cross-chain,
ONS resolve, gas-private submit) and the [quickstart](https://docs.opaque.cash/quickstart).

## Packages

Most apps import only `@opaquecash/opaque`. The rest exist for narrow surfaces:

| Package | Purpose |
|---|---|
| **`@opaquecash/opaque`** | Unified client — start here |
| `@opaquecash/deployments` | Generated addresses/ABIs/program ids for every deployment (the only address source) |
| `@opaquecash/react` | `OpaqueProvider`, `useScan`, `useStealthBalance` hooks |
| `@opaquecash/privacy-pool` | Pool notes, Poseidon trees, withdrawal proving ([spec](https://github.com/opaquecash/spec/blob/main/privacy-pool.md)) |
| `@opaquecash/disclosure` | Shamir viewing-key escrow + FROST-gated disclosure proofs ([spec](https://github.com/opaquecash/spec/blob/main/conditional-disclosure.md)) |
| `@opaquecash/relayer-client` | Gas-private submission through the relayer market ([spec](https://github.com/opaquecash/spec/blob/main/relayer-market.md)) |
| `@opaquecash/uab` | Cross-chain announce + VAA fetch ([spec](https://github.com/opaquecash/spec/blob/main/UAB.md)) |
| `@opaquecash/stealth-core` / `-wasm` / `-chain` / `-chain-solana` / `-balance` | DKSAP types, WASM bindings, per-chain transport, balances |
| `@opaquecash/psr-core` / `-prover` / `-chain` / `-chain-solana` | PSR codecs, Groth16 proving, per-chain verifiers |
| `@opaquecash/adapter` | Chain-neutral `ChainAdapter` seam |

Deployed addresses are **not** documented here — read them from `@opaquecash/deployments`
(regenerated via `npm run generate` in the `ethereum`/`solana` repos) or the
[deployments page](https://docs.opaque.cash/protocol/deployments).

## WASM

Scanning and key reconstruction run in a Rust→WASM module built from
[`opaque-scanner`](https://github.com/opaquecash/scanner):

```bash
# in the scanner repo
wasm-pack build --target web --out-dir pkg --out-name cryptography
```

The SDK never vendors the binary — pass the glue URL as `wasmModuleSpecifier`
(hosted at `https://www.opaque.cash/pkg/cryptography.js`).

## Tools

[`tools/frost-custodian`](tools/frost-custodian) — Rust CLI for the conditional-disclosure
custodian ceremony: FROST(secp256k1, Taproot) DKG and 2-round threshold signing.

## Develop

```bash
npm install
npm run build            # all packages in dependency order
npm test                 # vitest; WASM + live-network suites skip without their prerequisites
npm run test:coverage    # enforces the 80% line threshold on the core surface
```

Live E2E suites (PSR issuance, cross-chain) are opt-in via env vars — see the test
file headers under [`tests/`](tests/).

## License

Apache-2.0.
