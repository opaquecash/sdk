import { encodeByteArray, toFeltHex } from "./bytearray.js";
import { STARKNET_SEPOLIA, STRK_TOKEN_ADDRESS } from "./deployment.js";

/** A Starknet call in the shape `starknet.js` / `sncast` accept. */
export interface StarknetCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

function u256Calldata(value: bigint): string[] {
  const mask = (1n << 128n) - 1n;
  return [toFeltHex(value & mask), toFeltHex(value >> 128n)];
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

/** Build the `announce` invoke on the CSAP announcer. */
export function buildAnnounceCall(
  params: {
    stealthAddress: string;
    ephemeralPubKey: Uint8Array;
    metadata: Uint8Array;
    schemeId?: bigint;
  },
  announcer: string = STARKNET_SEPOLIA.stealthAnnouncer,
): StarknetCall {
  if (params.ephemeralPubKey.length !== 33) {
    throw new Error("Ephemeral public key must be 33 bytes (compressed secp256k1)");
  }
  if (params.metadata.length === 0) {
    throw new Error("Metadata must be non-empty (metadata[0] is the view tag)");
  }
  const calldata = [
    ...u256Calldata(params.schemeId ?? 1n),
    toFeltHex(hexToBigInt(params.stealthAddress)),
    ...encodeByteArray(params.ephemeralPubKey).map(toFeltHex),
    ...encodeByteArray(params.metadata).map(toFeltHex),
  ];
  return { contractAddress: announcer, entrypoint: "announce", calldata };
}

/**
 * Build an ERC-20 `transfer(recipient, amount)` to a stealth address. The
 * recipient account need not be deployed — a SNIP-2 balance credit does not
 * require the account contract to exist, so the funds wait at the
 * counterfactual address until the recipient deploys it and sweeps.
 */
export function buildStealthTransferCall(params: {
  stealthAddress: string;
  amount: bigint;
  token?: string;
}): StarknetCall {
  if (params.amount <= 0n) {
    throw new Error("Transfer amount must be positive");
  }
  return {
    contractAddress: params.token ?? STRK_TOKEN_ADDRESS,
    entrypoint: "transfer",
    calldata: [
      toFeltHex(hexToBigInt(params.stealthAddress)),
      ...u256Calldata(params.amount),
    ],
  };
}

/** Build the self-service `register_keys` invoke on the CSAP registry. */
export function buildRegisterKeysCall(
  metaAddress: Uint8Array,
  schemeId: bigint = 1n,
  registry: string = STARKNET_SEPOLIA.stealthRegistry,
): StarknetCall {
  if (metaAddress.length !== 66 && metaAddress.length !== 98) {
    throw new Error("Meta-address must be 66 or 98 bytes");
  }
  const calldata = [
    ...u256Calldata(schemeId),
    ...encodeByteArray(metaAddress).map(toFeltHex),
  ];
  return { contractAddress: registry, entrypoint: "register_keys", calldata };
}
