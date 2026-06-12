/**
 * Deposit / withdraw transaction building for `OpaquePrivacyPool` and the random note
 * generation behind a shielded deposit (spec/privacy-pool.md §5–§6).
 */

import { encodeFunctionData, type Address, type Hex } from "viem";
import { FIELD, type PoolCrypto } from "./crypto.js";
import type { SolidityProof } from "./prove.js";

/** Minimal pool ABI for deposit + withdraw + the reads a client needs. */
export const opaquePrivacyPoolAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [{ name: "precommitment", type: "uint256" }],
    outputs: [{ name: "commitment", type: "bytes32" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "a", type: "uint256[2]" },
      { name: "b", type: "uint256[2][2]" },
      { name: "c", type: "uint256[2]" },
      { name: "withdrawnValue", type: "uint256" },
      { name: "stateRoot", type: "uint256" },
      { name: "nullifierHash", type: "uint256" },
      { name: "newCommitment", type: "uint256" },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "recipient", type: "address" },
          { name: "feeRecipient", type: "address" },
          { name: "fee", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
  { type: "function", name: "scope", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "aspRoot", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "context",
    stateMutability: "view",
    inputs: [{ name: "params", type: "tuple", components: [
      { name: "recipient", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "fee", type: "uint256" },
    ] }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Payout parameters bound into the withdrawal proof's `context`. */
export interface WithdrawalParams {
  recipient: Address;
  feeRecipient: Address;
  fee: bigint;
}

/** A freshly generated deposit note: secret openings the user must keep to withdraw. */
export interface DepositNote {
  nullifier: bigint;
  secret: bigint;
  precommitment: bigint;
}

/** A uniformly random field element from injected randomness. */
function randomField(randomBytes: (n: number) => Uint8Array): bigint {
  let x = 0n;
  for (const byte of randomBytes(32)) x = (x << 8n) | BigInt(byte);
  return x % FIELD;
}

/** Generate fresh `(nullifier, secret)` and the `precommitment` to deposit. */
export function generateDepositNote(
  crypto: PoolCrypto,
  randomBytes: (n: number) => Uint8Array,
): DepositNote {
  const nullifier = randomField(randomBytes);
  const secret = randomField(randomBytes);
  return { nullifier, secret, precommitment: crypto.precommitment(nullifier, secret) };
}

/** EVM transaction request the depositor sends (value = deposit amount). */
export interface EvmTxRequest {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Build the `deposit(precommitment)` call. */
export function buildDepositTx(pool: Address, note: DepositNote, value: bigint): EvmTxRequest {
  return {
    to: pool,
    data: encodeFunctionData({
      abi: opaquePrivacyPoolAbi,
      functionName: "deposit",
      args: [note.precommitment],
    }),
    value,
  };
}

/** Build the `withdraw(...)` calldata from a proof + public values + payout params. */
export function buildWithdrawTx(
  pool: Address,
  proof: SolidityProof,
  publics: {
    withdrawnValue: bigint;
    stateRoot: bigint;
    nullifierHash: bigint;
    newCommitment: bigint;
  },
  params: WithdrawalParams,
): EvmTxRequest {
  return {
    to: pool,
    data: encodeFunctionData({
      abi: opaquePrivacyPoolAbi,
      functionName: "withdraw",
      args: [
        proof.a,
        proof.b,
        proof.c,
        publics.withdrawnValue,
        publics.stateRoot,
        publics.nullifierHash,
        publics.newCommitment,
        params,
      ],
    }),
    value: 0n,
  };
}
