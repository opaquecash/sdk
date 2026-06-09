import { describe, it, expect } from "vitest";
import { hexToBytes, type Address, type Hex } from "viem";
import {
  computeSchemaId,
  parseFieldDefs,
  fieldDefsToString,
  encodeAttestationData,
  decodeAttestationData,
  encodeV2AttestationMetadata,
  computeUid,
  isZeroUid,
  ZERO_BYTES32,
} from "@opaquecash/psr-core";

const AUTH = ("0x" + "11".repeat(20)) as Address;
const ISSUER = ("0x" + "22".repeat(20)) as Address;

describe("PSR V2 schema codecs", () => {
  it("computes a deterministic 32-byte schemaId", () => {
    const a = computeSchemaId(AUTH, "KycPassed", 1);
    expect(a).toBe(computeSchemaId(AUTH, "KycPassed"));
    expect(hexToBytes(a)).toHaveLength(32);
    expect(a).not.toBe(computeSchemaId(AUTH, "Other"));
  });

  it("round-trips field definitions", () => {
    const defs = parseFieldDefs("bool passed, u64 score");
    expect(defs).toEqual([
      { id: "0", name: "passed", type: "bool" },
      { id: "1", name: "score", type: "u64" },
    ]);
    expect(fieldDefsToString(defs)).toBe("bool passed, u64 score");
    expect(parseFieldDefs("")).toEqual([]);
  });
});

describe("PSR V2 attestation data codec", () => {
  const defs = parseFieldDefs("string name, u64 score");

  it("round-trips field values", () => {
    const values = { name: "alice", score: "42" };
    const decoded = decodeAttestationData(encodeAttestationData(values, defs), defs);
    expect(decoded).toEqual(values);
  });

  it("handles empty values", () => {
    const decoded = decodeAttestationData(encodeAttestationData({}, defs), defs);
    expect(decoded).toEqual({ name: "", score: "" });
  });
});

describe("PSR V2 announce metadata", () => {
  it("encodes the 130-byte 0xB2 marker layout", () => {
    const meta = encodeV2AttestationMetadata({
      viewTag: 0x7f,
      schemaId: ("0x" + "aa".repeat(32)) as Hex,
      issuer: ISSUER,
      uid: ("0x" + "bb".repeat(32)) as Hex,
      nonce: ("0x" + "cc".repeat(32)) as Hex,
    });
    const bytes = hexToBytes(meta);
    expect(bytes).toHaveLength(130);
    expect(bytes[0]).toBe(0x7f); // view tag
    expect(bytes[1]).toBe(0xb2); // V2 attestation marker
    // schemaId occupies bytes [2, 34)
    expect([...bytes.slice(2, 34)]).toEqual(Array(32).fill(0xaa));
    // issuer is left-padded to 32 bytes at [34, 66): 12 zero bytes then the 20-byte address
    expect([...bytes.slice(34, 46)]).toEqual(Array(12).fill(0));
    expect([...bytes.slice(46, 66)]).toEqual(Array(20).fill(0x22));
  });
});

describe("PSR V2 uid helpers", () => {
  it("computes a deterministic uid and detects the zero uid", () => {
    const uid = computeUid(("0x" + "aa".repeat(32)) as Hex, ISSUER, ZERO_BYTES32, 100n);
    expect(uid).toBe(computeUid(("0x" + "aa".repeat(32)) as Hex, ISSUER, ZERO_BYTES32, 100n));
    expect(hexToBytes(uid)).toHaveLength(32);
    expect(isZeroUid(ZERO_BYTES32)).toBe(true);
    expect(isZeroUid(uid)).toBe(false);
  });
});
