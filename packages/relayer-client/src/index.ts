/**
 * `@opaquecash/relayer-client` — client for the Opaque gas-private submission market
 * (spec/relayer-market.md). Build a job and its payload commitment, fund the escrow,
 * advertise to relayer nodes, verify + select a stake-weighted winner, and deliver the
 * payload sealed to the winner's key. Used by PSR verify and (later) pool withdrawals
 * to submit without linking the user's gas wallet to the action.
 *
 * @packageDocumentation
 */

export {
  CHAIN_ETHEREUM,
  CHAIN_SOLANA,
  BID_DOMAIN,
  evmPayloadBytes,
  evmPayloadHash,
  solanaPayloadBytes,
  solanaPayloadHash,
  payloadBytes,
  payloadHash,
  bidSigningHash,
  hexToBytes,
  bytesToHex,
  type Advert,
  type Bid,
  type PayloadEnvelope,
  type MessageTag,
  type JobPayload,
  type EvmJobPayload,
  type SolanaJobPayload,
} from "./job.js";

export { sealBox, openBox } from "./crypto.js";

export {
  relayerRegistryCreateJobAbi,
  buildEvmCreateJob,
  buildSolanaCreateJob,
  solanaJobPda,
  type EvmTxRequest,
} from "./escrow.js";

export {
  postAdvert,
  getBids,
  postPayload,
  collectBids,
  type GatewayOptions,
} from "./gateway.js";

export {
  verifyEvmBidSignature,
  verifyBids,
  selectWinner,
  type RegistryReaders,
  type VerifiedBid,
} from "./select.js";

export {
  prepareJob,
  buildPayloadEnvelope,
  submitGasPrivate,
  type PreparedJob,
  type PrepareOptions,
  type SubmitGasPrivateOptions,
  type SubmitGasPrivateResult,
} from "./client.js";

export {
  evmGaslessSweepRequest,
  submitSolanaGaslessSweep,
  gaslessSweepSubmission,
  postGaslessSweep,
  getSweepInfo,
  type GaslessSweepSubmission,
  type SweepInfoChain,
} from "./sweep.js";
