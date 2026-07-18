import { STARKNET_SEPOLIA_PSR } from "./addresses.js";

/**
 * A Starknet call in the shape `starknet.js` (`Account.execute`,
 * `Provider.callContract`) accepts, without this package depending on
 * `starknet.js` itself.
 */
export interface StarknetCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

/** BN254 scalar-field order `r`; every V2 public signal lies in `[0, r)`. */
export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const U128_MASK = (1n << 128n) - 1n;
const U256_MAX = (1n << 256n) - 1n;

function toFelt(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function toBigInt(value: bigint | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

/**
 * Split a value into the `{low, high}` 128-bit limbs of Cairo's `u256`.
 * Calldata order on the wire is `[low, high]`.
 */
export function toU256Limbs(value: bigint | string): { low: bigint; high: bigint } {
  const v = toBigInt(value);
  if (v < 0n || v > U256_MAX) {
    throw new Error(`Value out of u256 range: ${v}`);
  }
  return { low: v & U128_MASK, high: v >> 128n };
}

/** Serialise a value as `u256` calldata (`[low, high]`, hex felts). */
export function u256ToCalldata(value: bigint | string): [string, string] {
  const { low, high } = toU256Limbs(value);
  return [toFelt(low), toFelt(high)];
}

function spanCalldata(fullProofWithHints: readonly bigint[]): string[] {
  if (fullProofWithHints.length === 0) {
    throw new Error("Empty full_proof_with_hints");
  }
  // `encodeFullProofWithHints` returns the length-prefixed Span serialisation;
  // accept the raw body too so callers can pass `garaga calldata` file output.
  const [head, ...rest] = fullProofWithHints;
  const prefixed = head === BigInt(rest.length) ? fullProofWithHints : [
    BigInt(fullProofWithHints.length),
    ...fullProofWithHints,
  ];
  return prefixed.map(toFelt);
}

/**
 * Build the `verify_reputation` invoke: verifies the proof, requires a fresh
 * root and a live schema, and consumes the nullifier (one-time use).
 */
export function buildVerifyReputationCall(
  fullProofWithHints: readonly bigint[],
  contractAddress: string = STARKNET_SEPOLIA_PSR.reputationVerifier.address,
): StarknetCall {
  return {
    contractAddress,
    entrypoint: "verify_reputation",
    calldata: spanCalldata(fullProofWithHints),
  };
}

/**
 * Build the `verify_reputation_view` call: the same checks without consuming
 * the nullifier. Execute as a (free) call, not an invoke.
 */
export function buildVerifyReputationViewCall(
  fullProofWithHints: readonly bigint[],
  contractAddress: string = STARKNET_SEPOLIA_PSR.reputationVerifier.address,
): StarknetCall {
  return {
    contractAddress,
    entrypoint: "verify_reputation_view",
    calldata: spanCalldata(fullProofWithHints),
  };
}

/** Build the admin `update_merkle_root` invoke. Rejects out-of-field roots. */
export function buildUpdateMerkleRootCall(
  root: bigint | string,
  contractAddress: string = STARKNET_SEPOLIA_PSR.reputationVerifier.address,
): StarknetCall {
  const value = toBigInt(root);
  if (value >= BN254_R) {
    throw new Error(`Merkle root out of BN254 scalar field: ${value}`);
  }
  return {
    contractAddress,
    entrypoint: "update_merkle_root",
    calldata: u256ToCalldata(value),
  };
}

/** Build the `is_nullifier_used` view call for a V2 `nullifier_hash`. */
export function buildIsNullifierUsedCall(
  nullifierHash: bigint | string,
  contractAddress: string = STARKNET_SEPOLIA_PSR.reputationVerifier.address,
): StarknetCall {
  return {
    contractAddress,
    entrypoint: "is_nullifier_used",
    calldata: u256ToCalldata(toBigInt(nullifierHash)),
  };
}
