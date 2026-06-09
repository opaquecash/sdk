import type { Abi } from "viem";

const _opaqueReputationVerifierAbi = [
  { type: "error", name: "InvalidProof", inputs: [] },
  { type: "error", name: "NullifierAlreadyUsed", inputs: [] },
  { type: "error", name: "InvalidMerkleRoot", inputs: [] },
  { type: "error", name: "RootExpired", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  {
    type: "function",
    name: "isRootValid",
    inputs: [{ name: "root", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "verifyReputation",
    inputs: [
      {
        name: "proof",
        type: "tuple",
        components: [
          { name: "a", type: "uint256[2]" },
          { name: "b", type: "uint256[2][2]" },
          { name: "c", type: "uint256[2]" },
        ],
      },
      { name: "root", type: "bytes32" },
      { name: "attestationId", type: "uint256" },
      { name: "externalNullifier", type: "uint256" },
      { name: "nullifier", type: "uint256" },
    ],
    outputs: [{ name: "valid", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "verifyReputationView",
    inputs: [
      {
        name: "proof",
        type: "tuple",
        components: [
          { name: "a", type: "uint256[2]" },
          { name: "b", type: "uint256[2][2]" },
          { name: "c", type: "uint256[2]" },
        ],
      },
      { name: "root", type: "bytes32" },
      { name: "attestationId", type: "uint256" },
      { name: "externalNullifier", type: "uint256" },
      { name: "nullifier", type: "uint256" },
    ],
    outputs: [{ name: "valid", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rootHistoryLength",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rootHistory",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

/**
 * Minimal ABI surface for `OpaqueReputationVerifier` + errors (viem `readContract` / `writeContract`).
 */
export const opaqueReputationVerifierAbi =
  _opaqueReputationVerifierAbi as unknown as Abi;
