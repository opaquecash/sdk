# @opaquecash/psr-chain-solana

Solana (`@solana/web3.js`) PSR V2 integration — the Solana counterpart to
`@opaquecash/psr-chain` (EVM). Covers the three PSR programs:

- **Schema registry** — `computeSchemaId`, `deriveSchemaPda`, `buildRegisterSchemaInstruction`,
  `buildAddDelegateInstruction` / `buildRemoveDelegateInstruction`,
  `buildDeprecateSchemaInstruction`, `parseSchemaPda`, `fetchSchemaPda` / `fetchAllSchemas`.
- **Attestation engine V2** — `deriveAttestationPda`
  (`["attestation_v2", schemaId, issuer, stealthAddressHash]`), `buildAttestInstruction`,
  `buildRevokeInstruction`, `parseAttestationPda`, `fetchAttestationPda` / `fetchAllAttestations`.
- **Reputation verifier** — `deriveRootHistoryPda` / `deriveVerifierConfigPda` /
  `deriveMerkleRootPda` / `deriveNullifierPda`, `encodeGroth16Proof`, `fetchLatestValidMerkleRoot`,
  `buildVerifyReputationInstruction`, and `submitReputationProof` (derive PDAs, check root +
  nullifier, sign via a wallet-adapter `signTransaction`, send).

Instruction encoding uses Anchor discriminators (`sha256("global:<method>")`). Program ids come
from the centralized `getSolanaDeployment` in `@opaquecash/stealth-chain-solana`
(`getPsrSolanaPrograms(cluster)`). The chain-neutral schema/attestation codecs (field encoding,
`encodeV2AttestationMetadata`, uid computation) live in `@opaquecash/psr-core`.

Signing stays in the app's wallet layer — builders return unsigned `TransactionInstruction`s, and
`submitReputationProof` takes a `signTransaction` callback.

> Note: the deployed devnet reputation verifier uses a fixed `verify_reputation` dispatch tag
> (`VERIFY_REPUTATION_DISCRIMINATOR`), not Anchor's default. Override it in
> `buildVerifyReputationInstruction` if the program is redeployed.
