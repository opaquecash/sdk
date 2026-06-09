# SDK

Opaque TypeScript SDK monorepo.

This workspace contains the published packages for stealth payments (EIP-5564), PSR flows, and the unified `@opaquecash/opaque` client.

## Run locally

```bash
cd sdk
npm install
npm run build
```

## Scripts

- `npm run build` - build all workspace packages in dependency order
- `npm run clean` - run package clean scripts where available

## Workspace packages

- `@opaquecash/opaque` - unified client API
- `@opaquecash/stealth-core` - stealth primitives
- `@opaquecash/stealth-wasm` - WASM bindings
- `@opaquecash/stealth-chain` - chain helpers and ABIs
- `@opaquecash/stealth-balance` - balance aggregation helpers
- `@opaquecash/psr-core` - PSR core types/utilities
- `@opaquecash/psr-prover` - proof generation pipeline
- `@opaquecash/psr-chain` - PSR chain-facing helpers

For package-level usage details, see `sdk/packages/opaque/README.md`.
