/**
 * Bid verification and stake-weighted winner selection (spec/relayer-market.md §3.2,
 * §6). A user MUST verify, before delivering the payload, that each candidate bid is
 * signed by the registered operator, that the operator's free stake covers the fee,
 * and that the advertised x25519 key matches the registry. Selection among the valid
 * bids is client policy; the default weights uniformly at random by free stake.
 */

import { hashMessage, recoverAddress, type Hex } from "viem";
import { bidSigningHash, CHAIN_ETHEREUM, type Bid } from "./job.js";

/** A verified bid plus the operator's free stake (base units). */
export interface VerifiedBid {
  bid: Bid;
  freeStake: bigint;
}

/**
 * Readers the user injects so selection can check on-chain truth without this package
 * owning RPC. `freeStakeOf` returns the operator's unbonded stake; `registeredKey`
 * returns the operator's registered x25519 key (0x…) or null if unregistered.
 */
export interface RegistryReaders {
  freeStakeOf(operator: string): Promise<bigint>;
  registeredKey(operator: string): Promise<Hex | null>;
}

/** Verify an EVM bid signature recovers the claimed operator address. */
export async function verifyEvmBidSignature(bid: Bid): Promise<boolean> {
  if (bid.chain !== CHAIN_ETHEREUM) return false;
  try {
    // The operator signs the personal_sign of the bid hash; recover and compare.
    const digest = bidSigningHash(bid.jobId, bid.x25519Pk);
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: digest }),
      signature: bid.sig as Hex,
    });
    return recovered.toLowerCase() === bid.operator.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Filter bids to those that are well-formed, signed by the registered operator, whose
 * registered key matches the advertised key, and whose free stake covers `fee`.
 * `verifySig` defaults to the EVM verifier; pass a Solana ed25519 verifier for `.sol`.
 */
export async function verifyBids(
  bids: Bid[],
  fee: bigint,
  readers: RegistryReaders,
  verifySig?: (bid: Bid) => Promise<boolean>,
): Promise<VerifiedBid[]> {
  const out: VerifiedBid[] = [];
  for (const bid of bids) {
    const sigOk = verifySig ? await verifySig(bid) : await verifyEvmBidSignature(bid);
    if (!sigOk) continue;
    const registered = await readers.registeredKey(bid.operator);
    if (!registered || registered.toLowerCase() !== bid.x25519Pk.toLowerCase()) continue;
    const freeStake = await readers.freeStakeOf(bid.operator);
    if (freeStake < fee) continue;
    out.push({ bid, freeStake });
  }
  return out;
}

/**
 * Pick a winner among verified bids, weighted by free stake (spec §6 deters Sybil
 * bidding). `random` returns a float in [0, 1); injectable for determinism in tests.
 */
export function selectWinner(
  verified: VerifiedBid[],
  random: () => number = Math.random,
): VerifiedBid | null {
  if (verified.length === 0) return null;
  const total = verified.reduce((a, v) => a + v.freeStake, 0n);
  if (total === 0n) return verified[0];
  // Weighted pick: scale the random draw into the cumulative stake range.
  let target = BigInt(Math.floor(random() * 1e9)) * total / 1_000_000_000n;
  for (const v of verified) {
    if (target < v.freeStake) return v;
    target -= v.freeStake;
  }
  return verified[verified.length - 1];
}
