/**
 * ABI fragments for the V2 PSR schema registry, attestation registry, and the stealth announcer.
 * Only the fragments the SDK calls are included. Ported from
 * `ethereum/frontend/src/lib/psr.ts` (behaviour must match the deployed V2 contracts).
 */

import { parseAbiItem, type Abi } from "viem";

/** `OpaqueSchemaRegistry` — register / manage schemas and read schema state. */
export const SCHEMA_REGISTRY_ABI = [
  { type: "function", name: "computeSchemaId", stateMutability: "pure", inputs: [{ name: "authority", type: "address" }, { name: "name", type: "string" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "registerSchema", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "fieldDefinitions", type: "string" }, { name: "revocable", type: "bool" }, { name: "resolver", type: "address" }, { name: "schemaExpiryBlock", type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "addDelegate", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "delegate", type: "address" }], outputs: [] },
  { type: "function", name: "removeDelegate", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "delegate", type: "address" }], outputs: [] },
  { type: "function", name: "updateResolver", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "newResolver", type: "address" }], outputs: [] },
  { type: "function", name: "deprecateSchema", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getSchema", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [{ name: "authority", type: "address" }, { name: "resolver", type: "address" }, { name: "revocable", type: "bool" }, { name: "deprecated", type: "bool" }, { name: "version", type: "uint8" }, { name: "name", type: "string" }, { name: "fieldDefinitions", type: "string" }, { name: "createdAt", type: "uint256" }, { name: "schemaExpiryBlock", type: "uint256" }] },
  { type: "function", name: "getDelegates", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [{ type: "address[]" }] },
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isAuthorizedIssuer", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "candidate", type: "address" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

/** `OpaqueAttestationRegistry` — attest / revoke and read attestation state. */
export const ATTESTATION_ABI = [
  { type: "function", name: "attest", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "stealthAddressHash", type: "bytes32" }, { name: "data", type: "bytes" }, { name: "expirationBlock", type: "uint256" }, { name: "refUid", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [{ name: "uid", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getAttestation", stateMutability: "view", inputs: [{ name: "uid", type: "bytes32" }], outputs: [{ name: "schemaId", type: "bytes32" }, { name: "issuer", type: "address" }, { name: "stealthAddressHash", type: "bytes32" }, { name: "createdAt", type: "uint256" }, { name: "expirationBlock", type: "uint256" }, { name: "revocationBlock", type: "uint256" }, { name: "refUid", type: "bytes32" }, { name: "data", type: "bytes" }] },
  { type: "function", name: "isValid", stateMutability: "view", inputs: [{ name: "uid", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

/** `StealthAddressAnnouncer.announce` — used to publish a V2 attestation announcement. */
export const ANNOUNCER_ABI = [
  {
    type: "function",
    name: "announce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export const SCHEMA_REGISTERED_EVENT = parseAbiItem(
  "event SchemaRegistered(bytes32 indexed schemaId, address indexed authority, string name, bool revocable, address resolver)",
);
export const ATTESTED_EVENT = parseAbiItem(
  "event Attested(bytes32 indexed uid, bytes32 indexed schemaId, address indexed issuer, bytes32 stealthAddressHash, uint256 expirationBlock, bytes32 refUid)",
);
