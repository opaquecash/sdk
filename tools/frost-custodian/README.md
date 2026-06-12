# frost-custodian

Custodian CLI for [Opaque Cash](https://opaque.cash) conditional disclosure
([spec/conditional-disclosure.md](https://github.com/opaquecash/spec/blob/main/conditional-disclosure.md) §1, §5).

Runs the RFC 9591 FROST(secp256k1, SHA-256) distributed key generation with
Taproot tweaking ([`frost-secp256k1-tr`](https://crates.io/crates/frost-secp256k1-tr)),
so the aggregate output is a standard BIP-340 Schnorr signature over the 32-byte
disclosure `context`, verifiable by the on-chain registries on both Ethereum and
Solana. The group secret never exists in one place — not at the ceremony (DKG,
no dealer) and not during signing (share aggregation).

All rounds exchange JSON files through a shared directory; each custodian keeps
their `*.secret.json` files private and publishes the rest.

## Install

```sh
cargo install frost-custodian
```

## Key ceremony

Each of the N custodians, in lockstep:

```sh
frost-custodian dkg-part1    --id <i> --min M --max N --dir ceremony/
frost-custodian dkg-part2    --id <i> --dir ceremony/
frost-custodian dkg-finalize --id <i> --dir ceremony/
```

Outputs `ceremony/keys/<i>.key.secret.json` (private, one per custodian) and
`ceremony/group.json` (shared; contains the x-only group key used as the
`registerPolicy` input on both chains).

## Signing a disclosure context

Any M custodians:

```sh
frost-custodian sign-round1 --id <i> --key ceremony/keys/<i>.key.secret.json --dir signing/
frost-custodian sign-round2 --id <i> --key ceremony/keys/<i>.key.secret.json --message <hex32> --dir signing/
frost-custodian aggregate   --group ceremony/group.json --message <hex32> --dir signing/
```

Outputs `signing/signature.json`: `{ rx, ry, s }` — the `SchnorrSig` tuple the
on-chain registries verify.

## License

GPL-3.0
