# @opaquecash/opaque

Single entry point for Opaque **stealth** (EIP-5564) and **PSR** flows used together with your own indexer.

**Full documentation** (guides, API reference, playground): **[docs.opaque.cash](https://docs.opaque.cash)**

## Install

```bash
npm install @opaquecash/opaque
```

The package ships TypeScript types and depends on **`viem`** (v2). You must load the **WASM** bundle (`cryptography.js`) at runtime—either from your app’s static assets or a hosted URL (see below).

### Working from this repository

```bash
cd sdk && npm install && npm run build
```

Then depend on `@opaquecash/opaque` via your workspace or `npm link`.

## Initialize

```ts
import { OpaqueClient } from "@opaquecash/opaque";

const client = await OpaqueClient.create({
  chainId: 11155111,
  rpcUrl: "https://…",
  walletSignature: userSignatureHex,
  ethereumAddress: userAddress,
  wasmModuleSpecifier: new URL("/pkg/cryptography.js", import.meta.url).href,
});
```

Hosted WASM entry used by the reference app:

`https://www.opaque.cash/pkg/cryptography.js`

## Constants

- `OpaqueClient.supportedChainIds()`
- `OpaqueClient.chainDeployment(chainId)` — registry, announcer, verifier, default tokens
- `NATIVE_TOKEN_ADDRESS` — sentinel for ETH in balance aggregation

## Indexer announcements

Pass subgraph-shaped rows:

```ts
const rows: IndexerAnnouncement[] = [
  {
    blockNumber: "10533630",
    etherealPublicKey: "0x02…",
    logIndex: 161,
    metadata: "0x…",
    stealthAddress: "0x…",
    transactionHash: "0x…",
    viewTag: 234,
  },
];
```

## Flows

| Goal | API |
|------|-----|
| Resolve recipient meta-address (registry read via `rpcUrl`) | `resolveRecipientMetaAddress(normalAddress)` |
| Register meta-address calldata | `buildRegisterMetaAddressTransaction()` |
| Send: derive stealth + ephemeral | `prepareStealthSend(recipientMetaHex)` |
| Announce calldata | `buildAnnounceTransactionRequest(prepareResult)` |
| Owned outputs | `filterOwnedAnnouncements(rows)` |
| Balances by token | `getBalancesFromAnnouncements(rows)` |
| PSR traits | `discoverTraits(rows)` |

You always submit transactions from your own wallet; the SDK returns **structured calldata** and **read results**.

## Lower-level packages

`@opaquecash/stealth-core`, `@opaquecash/stealth-wasm`, `@opaquecash/stealth-chain`, `@opaquecash/psr-core`, and related packages remain available for advanced integrations.
