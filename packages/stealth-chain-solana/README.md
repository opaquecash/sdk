# @opaquecash/stealth-chain-solana

Solana (`@solana/web3.js`) integration for the Opaque stealth registry and announcer — the
Solana counterpart to `@opaquecash/stealth-chain` (EVM/viem).

All DKSAP crypto is shared with the Ethereum path via the chain-neutral core
(`@opaquecash/stealth-core` / `opaque-scanner` WASM). Only chain access lives here: program
ids, PDA derivation, Anchor instruction building, and `Announcement` log decoding.

## What's here

- **`SolanaAdapter`** — implements `@opaquecash/adapter`'s `ChainAdapter`
  (`fetchAnnouncements`, `resolveMetaAddress`, `isRegistered`, `watchAnnouncements`) and adds
  `buildAnnounceInstruction` / `buildRegisterKeysInstruction`.
- **Registry** — `getRegistryEntryPda` (`["stealth_meta", registrant, schemeId_le]`),
  `buildRegisterKeysInstruction`, `resolveMetaAddress`, `isRegistered`,
  `decodeRegistryEntryMetaAddress`.
- **Announcer** — `buildAnnounceInstruction`, `decodeAnnouncementLogs` /
  `decodeAnnouncementEventData` / `encodeAnnouncementEventData`, `fetchAnnouncementsRange`,
  `watchAnnouncements`.
- **Stealth destinations** — `deriveStealthSolanaKeypair[FromStealthPrivKey]` and the
  matching address helpers (`Keypair.fromSeed(sha256("opaque-solana-stealth-v1" || pubkey))`).
- **Config** — `getSolanaDeployment(cluster)`, `SOLANA_DEPLOYMENTS`, `CLUSTER_ENDPOINTS`,
  discriminators, `SCHEME_ID_SECP256K1`.

This package never reads `import.meta.env` or any ambient config: pass a `Connection`,
`rpcUrl`, or `cluster` explicitly. Signing stays in the app's wallet layer — the builders
return unsigned `TransactionInstruction`s.

## Usage

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { SolanaAdapter } from "@opaquecash/stealth-chain-solana";

const adapter = new SolanaAdapter({ cluster: "devnet" });

// Unified inbox (chain-neutral announcements; run the WASM view-tag/DKSAP filter next).
const announcements = await adapter.fetchAnnouncements({ limit: 500 });

// Resolve a recipient's meta-address by Solana pubkey.
const meta = await adapter.resolveMetaAddress("E9LBRG5e...");

// Build an announce instruction for the wallet layer to sign.
const ix = adapter.buildAnnounceInstruction({
  caller: new PublicKey("..."),
  stealthAddress,   // 20-byte EVM-style bytes from computeStealthAddressAndViewTag
  ephemeralPubKey,  // 33-byte compressed secp256k1
  metadata,         // metadata[0] = view tag
});
```

## IDL

`idl/stealth_announcer.json` is the deployed program IDL (devnet
`HGFn2fH7bVQ5cSuiG52NjzN9m11YrB3FZUfoN9b9A5jf`), vendored for consumers that prefer Anchor.
This package decodes/encodes with hardcoded discriminators (sourced from that IDL) so it has
no Anchor runtime dependency.

## Devnet program ids

| Program | Id |
| --- | --- |
| Stealth registry | `E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno` |
| Stealth announcer | `HGFn2fH7bVQ5cSuiG52NjzN9m11YrB3FZUfoN9b9A5jf` |
| Schema registry | `FbgMJYGWnLKLcrKYS1NxM5uER1ihQkYLMTLs4STuDMWB` |
| Attestation engine V2 | `4T9kPCVCFGdEuLpEqRJihsPCbEEo2LWWDEPFvUESEqtM` |
| Groth16 verifier | `6mFaKyp7F4NqNeoiBLEWSqy5wJSk7rWf1EYumVXgHvhQ` |
| Reputation verifier | `BSnkCDoTpgNVN5BbF3aN5L5EJPiaYUkqqj9MHp8kaqWM` |
