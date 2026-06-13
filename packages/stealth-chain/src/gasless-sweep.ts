/**
 * Owner-side helpers for the gasless ERC-20 sweep forwarder (`StealthTokenSweep`,
 * spec/relayer-market.md fee-in-token). The reconstructed one-time stealth key signs — entirely
 * offline, needing no native gas — an EIP-712 `Sweep` authorization (binding destination, value,
 * and relayer fee) and an EIP-2612 `permit`. A relayer then submits `sweepWithPermit` to the
 * forwarder, pays the gas, and is reimbursed `fee` in the token.
 */

import {
  type Address,
  type Hex,
  encodeFunctionData,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** ABI of the on-chain `StealthTokenSweep` forwarder (sweep entry points only). */
export const stealthTokenSweepAbi = [
  {
    type: "function",
    name: "sweepWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "s",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "owner", type: "address" },
          { name: "destination", type: "address" },
          { name: "value", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "ownerSig", type: "bytes" },
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "value", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sweep",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "s",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "owner", type: "address" },
          { name: "destination", type: "address" },
          { name: "value", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "ownerSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const SWEEP_EIP712_TYPES = {
  Sweep: [
    { name: "token", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "value", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const PERMIT_EIP712_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** A full `Sweep` authorization (the `owner` is filled in from the stealth key). */
export interface StealthSweepAuthorization {
  token: Address;
  owner: Address;
  destination: Address;
  value: bigint;
  fee: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** EIP-2612 permit signature split for the forwarder's `PermitData`. */
export interface StealthPermitSignature {
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

function normalizeKey(stealthPrivKey: Hex | Uint8Array): Hex {
  if (stealthPrivKey instanceof Uint8Array) {
    let s = "0x";
    for (const b of stealthPrivKey) s += b.toString(16).padStart(2, "0");
    return s as Hex;
  }
  return (stealthPrivKey.startsWith("0x") ? stealthPrivKey : `0x${stealthPrivKey}`) as Hex;
}

/**
 * Sign the forwarder `Sweep` authorization with the reconstructed stealth key. `owner` is derived
 * from the key. Returns the 65-byte signature plus the completed authorization.
 */
export async function signStealthSweepAuthorization(params: {
  stealthPrivKey: Hex | Uint8Array;
  forwarder: Address;
  chainId: number;
  authorization: Omit<StealthSweepAuthorization, "owner">;
}): Promise<{ owner: Address; ownerSig: Hex; authorization: StealthSweepAuthorization }> {
  const account = privateKeyToAccount(normalizeKey(params.stealthPrivKey));
  const authorization: StealthSweepAuthorization = {
    ...params.authorization,
    owner: account.address,
  };
  const ownerSig = await account.signTypedData({
    domain: {
      name: "OpaqueStealthTokenSweep",
      version: "1",
      chainId: params.chainId,
      verifyingContract: params.forwarder,
    },
    types: SWEEP_EIP712_TYPES,
    primaryType: "Sweep",
    message: authorization,
  });
  return { owner: account.address, ownerSig, authorization };
}

/**
 * Sign an EIP-2612 `permit` over the token with the reconstructed stealth key, authorizing the
 * forwarder (`spender`) to pull `value`. `tokenName`/`tokenVersion` must match the token's EIP-712
 * domain (read `name()` and, where present, ERC-5267 `eip712Domain()`; many tokens use version "1",
 * but some, e.g. USDC, use "2").
 */
export async function signStealthTokenPermit(params: {
  stealthPrivKey: Hex | Uint8Array;
  token: Address;
  chainId: number;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  tokenName: string;
  tokenVersion?: string;
}): Promise<StealthPermitSignature> {
  const account = privateKeyToAccount(normalizeKey(params.stealthPrivKey));
  const sig = await account.signTypedData({
    domain: {
      name: params.tokenName,
      version: params.tokenVersion ?? "1",
      chainId: params.chainId,
      verifyingContract: params.token,
    },
    types: PERMIT_EIP712_TYPES,
    primaryType: "Permit",
    message: {
      owner: account.address,
      spender: params.spender,
      value: params.value,
      nonce: params.nonce,
      deadline: params.deadline,
    },
  });
  const { r, s, v, yParity } = parseSignature(sig);
  return {
    value: params.value,
    deadline: params.deadline,
    v: Number(v ?? BigInt(yParity) + 27n),
    r,
    s,
  };
}

/** Encode `sweepWithPermit` calldata for a relayer to submit to the forwarder. */
export function encodeSweepWithPermit(
  authorization: StealthSweepAuthorization,
  ownerSig: Hex,
  permit: StealthPermitSignature,
): Hex {
  return encodeFunctionData({
    abi: stealthTokenSweepAbi,
    functionName: "sweepWithPermit",
    args: [
      authorization,
      ownerSig,
      {
        value: permit.value,
        deadline: permit.deadline,
        v: permit.v,
        r: permit.r,
        s: permit.s,
      },
    ],
  });
}

/** Encode `sweep` calldata (allowance already granted; no permit) for relayer submission. */
export function encodeSweep(authorization: StealthSweepAuthorization, ownerSig: Hex): Hex {
  return encodeFunctionData({
    abi: stealthTokenSweepAbi,
    functionName: "sweep",
    args: [authorization, ownerSig],
  });
}
