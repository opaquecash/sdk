/**
 * `@opaquecash/psr-chain-solana` — Solana (web3.js) PSR V2 integration: the schema registry,
 * attestation engine V2, and reputation-verifier proof submission. The Solana counterpart to
 * `@opaquecash/psr-chain` (EVM). Instruction encoding uses Anchor discriminators
 * (`sha256("global:<method>")`); the chain-neutral schema/attestation codecs live in
 * `@opaquecash/psr-core`.
 *
 * @packageDocumentation
 */

export {
  type PsrSolanaPrograms,
  getPsrSolanaPrograms,
} from "./programs.js";

export {
  anchorDiscriminator,
  accountDiscriminator,
  bigIntToBytes32,
} from "./codec.js";

export {
  type ParsedSchemaPda,
  computeSchemaId,
  deriveSchemaPda,
  buildRegisterSchemaInstruction,
  buildAddDelegateInstruction,
  buildRemoveDelegateInstruction,
  buildDeprecateSchemaInstruction,
  parseSchemaPda,
  fetchSchemaPda,
  fetchAllSchemas,
} from "./schema.js";

export {
  type ParsedAttestationPda,
  deriveAttestationPda,
  buildAttestInstruction,
  buildRevokeInstruction,
  parseAttestationPda,
  fetchAttestationPda,
  fetchAllAttestations,
} from "./attestation.js";

export {
  type Groth16ProofInput,
  VERIFY_REPUTATION_DISCRIMINATOR,
  deriveRootHistoryPda,
  deriveVerifierConfigPda,
  deriveMerkleRootPda,
  deriveNullifierPda,
  encodeGroth16Proof,
  fetchLatestValidMerkleRoot,
  buildVerifyReputationInstruction,
  submitReputationProof,
} from "./reputation.js";
