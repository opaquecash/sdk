/**
 * `@opaquecash/disclosure` — conditional disclosure / threshold viewing keys
 * (spec/conditional-disclosure.md).
 *
 * Two surfaces:
 *   - **Escrow backstop**: {@link splitViewingKey} / {@link recoverViewingKey} —
 *     Shamir shares of the CSAP viewing key. Reconstruction reveals the FULL key;
 *     recovery only.
 *   - **Active disclosure**: {@link buildDisclosureWitness} +
 *     {@link generateDisclosureProof} (pool-scoped Groth16 proof) gated by a
 *     custodian FROST quorum's BIP-340 signature ({@link verifyQuorumSignature})
 *     over the request {@link computeContextEvm | context}, submitted via
 *     {@link buildDiscloseTx} / {@link buildDiscloseIx}.
 *
 * @packageDocumentation
 */

export {
  splitViewingKey,
  recoverViewingKey,
  parseShare,
  SHARE_SCHEME,
  type ParsedShare,
} from "./shamir.js";

export {
  FIELD,
  DOMAIN_DISCLOSURE,
  computeContextEvm,
  computeContextSolana,
  contextToMessage,
} from "./context.js";

export {
  liftEvenY,
  parseBip340,
  parseFrostSignature,
  verifyQuorumSignature,
  type QuorumSignature,
  type FrostSignatureFile,
} from "./schnorr.js";

export {
  disclosureNullifier,
  buildDisclosureWitness,
  generateDisclosureProof,
  POOL_LEVELS,
  type DisclosureArtifacts,
  type BuildDisclosureWitnessParams,
  type DisclosureWitness,
  type DisclosureProof,
} from "./prove.js";

export {
  opaqueDisclosureRegistryAbi,
  buildRegisterPolicyTx,
  buildDiscloseTx,
  policyPda,
  disclosureNullifierPda,
  buildRegisterPolicyIx,
  buildDiscloseIx,
  toSolanaProof,
  toSolidityProof,
  type EvmTxRequest,
  type SolanaProofBytes,
  type SolidityProof,
} from "./tx.js";
