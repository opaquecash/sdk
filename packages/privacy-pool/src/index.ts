/**
 * `@opaquecash/privacy-pool` — client for the Opaque privacy pool (spec/privacy-pool.md).
 * Amount privacy via the Privacy Pools (Buterin/Soleimani association-set) construction:
 * deposit a value-bearing commitment, then withdraw to a fresh stealth address with a
 * zero-knowledge proof of state-tree membership AND association-set membership.
 *
 * Building blocks (compose into a shielded `deposit → withdraw` flow):
 *   - {@link buildPoolCrypto} + {@link PoolMerkleTree}: Poseidon commitments + trees,
 *     byte-identical to the circuit and contract.
 *   - {@link generateDepositNote} + {@link buildDepositTx}: shielded deposit.
 *   - {@link buildWithdrawalWitness} + {@link generateWithdrawalProof}: the ZK proof.
 *   - {@link buildWithdrawTx}: the on-chain withdrawal call.
 *
 * @packageDocumentation
 */

export {
  POOL_LEVELS,
  FIELD,
  buildPoolCrypto,
  PoolMerkleTree,
  type PoolCrypto,
} from "./crypto.js";

export {
  buildWithdrawalWitness,
  generateWithdrawalProof,
  toSolidityProof,
  type PoolArtifacts,
  type CommitmentNote,
  type BuildWithdrawalWitnessParams,
  type WithdrawalWitness,
  type SolidityProof,
} from "./prove.js";

export {
  opaquePrivacyPoolAbi,
  generateDepositNote,
  buildDepositTx,
  buildWithdrawTx,
  type WithdrawalParams,
  type DepositNote,
  type EvmTxRequest,
} from "./tx.js";
