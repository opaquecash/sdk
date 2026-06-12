/**
 * Disclosure request contexts — spec/conditional-disclosure.md §5.
 * `context` commits the proof and the custodian quorum signature to one exact
 * request (policy, case, requester). Each chain's registry recomputes it on-chain,
 * so these MUST match the deployed encodings byte-for-byte.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** keccak256("opaque/disclosure/v1") mod r — the nullifier domain tag (spec §7). */
export const DOMAIN_DISCLOSURE =
  2892858644728810973983554811705195156385130922452064297470708309156017996001n;

/** Ethereum: `uint256(keccak256(abi.encode(policyId, caseId, requester))) % r`. */
export function computeContextEvm(policyId: bigint, caseId: Hex, requester: Address): bigint {
  return (
    BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "bytes32" }, { type: "address" }],
          [policyId, caseId, requester],
        ),
      ),
    ) % FIELD
  );
}

/**
 * Solana: `keccak256(policy_pda ‖ case_id ‖ requester)` with the top 3 bits
 * cleared (< 2^253 < r), matching the program and the pool's scope/context style.
 */
export function computeContextSolana(
  policy: Uint8Array,
  caseId: Uint8Array,
  requester: Uint8Array,
): bigint {
  if (policy.length !== 32 || caseId.length !== 32 || requester.length !== 32) {
    throw new Error("policy, caseId, and requester must each be 32 bytes");
  }
  const joined = new Uint8Array(96);
  joined.set(policy, 0);
  joined.set(caseId, 32);
  joined.set(requester, 64);
  const digest = Buffer.from(keccak256(joined).slice(2), "hex");
  digest[0] &= 0x1f;
  return BigInt("0x" + digest.toString("hex"));
}

/** The 32-byte big-endian message the custodian quorum FROST-signs. */
export function contextToMessage(context: bigint): Uint8Array {
  if (context < 0n || context >= FIELD) throw new Error("context out of field");
  return Uint8Array.from(Buffer.from(context.toString(16).padStart(64, "0"), "hex"));
}
