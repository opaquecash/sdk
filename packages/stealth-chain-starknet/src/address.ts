import { pedersen } from "@scure/starknet";
import { starknetKeccak } from "./bytearray.js";
import { STARKNET_SEPOLIA } from "./deployment.js";

function asBigInt(hexOrValue: string): bigint {
  return BigInt(hexOrValue.startsWith("0x") ? hexOrValue : `0x${hexOrValue}`);
}

/**
 * Starknet's array-hash `H(...H(H(0, a0), a1)..., n)` over Pedersen, as used
 * for contract-address computation and constructor-calldata hashing.
 */
function pedersenOnElements(data: bigint[]): bigint {
  let acc = 0n;
  for (const x of data) acc = asBigInt(pedersen(acc, x));
  return asBigInt(pedersen(acc, BigInt(data.length)));
}

/**
 * Counterfactual Starknet stealth address derivation (CSAP custody,
 * spec/starknet-integration.md §7.1).
 *
 * The address is the deploy-account address of the pinned `StealthAccount`
 * class whose sole signer is the one-time secp256k1 key `P_stealth`. Because
 * the constructor calldata IS `P_stealth` — fresh per payment via CSAP's
 * per-payment ephemeral key — the address is unlinkable across payments
 * regardless of salt. The salt is nonetheless derived deterministically from
 * the announced ephemeral key so the sender (computing where to pay) and the
 * recipient (deploying to spend) arrive at the identical address from public
 * data alone.
 */

// felt("STARKNET_CONTRACT_ADDRESS") — the address-hash domain prefix.
const CONTRACT_ADDRESS_PREFIX =
  0x535441524b4e45545f434f4e54524143545f41444452455353n;
// Starknet addresses live in [0, 2^251 - 256).
const L2_ADDRESS_UPPER_BOUND = 2n ** 251n - 256n;

const U128_MASK = (1n << 128n) - 1n;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/**
 * Serialise a secp256k1 point as the Cairo `Secp256k1Point` (EthPublicKey)
 * constructor calldata: `[x.low, x.high, y.low, y.high]` (each `u256` as
 * little-endian 128-bit limbs).
 */
export function ethPublicKeyCalldata(uncompressedPubKey: Uint8Array): bigint[] {
  if (uncompressedPubKey.length !== 65 || uncompressedPubKey[0] !== 0x04) {
    throw new Error("Expected a 65-byte uncompressed secp256k1 public key (0x04 ‖ x ‖ y)");
  }
  const x = bytesToBigInt(uncompressedPubKey.subarray(1, 33));
  const y = bytesToBigInt(uncompressedPubKey.subarray(33, 65));
  return [x & U128_MASK, x >> 128n, y & U128_MASK, y >> 128n];
}

/**
 * The per-payment salt: `sn_keccak(ephemeral_pubkey)`. Derivable by anyone
 * from the announcement, so sender and recipient agree without interaction.
 */
export function stealthAccountSalt(ephemeralPubKey: Uint8Array): bigint {
  if (ephemeralPubKey.length !== 33) {
    throw new Error("Ephemeral public key must be 33 bytes (compressed secp256k1)");
  }
  let hex = "";
  for (const b of ephemeralPubKey) hex += b.toString(16).padStart(2, "0");
  return starknetKeccak(hex);
}

export interface StarknetStealthAccount {
  /** The counterfactual account address, `0x`-hex felt. */
  address: `0x${string}`;
  /** The salt used (a function of the ephemeral key). */
  salt: bigint;
  /** Constructor calldata: `P_stealth` as `[x.low, x.high, y.low, y.high]`. */
  constructorCalldata: bigint[];
  /** The account class the address is a counterfactual deployment of. */
  classHash: `0x${string}`;
}

/**
 * Compute the Starknet stealth account for a payment.
 *
 * @param stealthPubKeyUncompressed - `P_stealth` (65-byte uncompressed
 *   secp256k1), from `prepareStealthSend(...).stealthPubKey`.
 * @param ephemeralPubKey - the 33-byte compressed ephemeral key `R` from the
 *   same send (drives the salt).
 * @param classHash - the pinned `StealthAccount` class hash (defaults to the
 *   Sepolia deployment).
 */
export function computeStarknetStealthAccount(
  stealthPubKeyUncompressed: Uint8Array,
  ephemeralPubKey: Uint8Array,
  classHash: string = STARKNET_SEPOLIA.stealthAccountClassHash,
): StarknetStealthAccount {
  const constructorCalldata = ethPublicKeyCalldata(stealthPubKeyUncompressed);
  const salt = stealthAccountSalt(ephemeralPubKey);
  const classHashFelt = BigInt(classHash);

  const address =
    pedersenOnElements([
      CONTRACT_ADDRESS_PREFIX,
      0n, // deployer address: 0 for a self-deploying (deploy_account) account
      salt,
      classHashFelt,
      pedersenOnElements(constructorCalldata),
    ]) % L2_ADDRESS_UPPER_BOUND;

  return {
    address: `0x${address.toString(16)}`,
    salt,
    constructorCalldata,
    classHash: `0x${classHashFelt.toString(16)}`,
  };
}
