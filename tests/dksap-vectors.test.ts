// Golden-vector regression guard for deriveKeysFromSignature (extension Phase 0).
//
// Vectors were pinned from the PUBLISHED npm tarball @opaquecash/opaque@0.2.12
// (npm install @opaquecash/opaque@0.2.12, 2026-07-18) — not the local tree — so this
// test is independent of local churn. The dApp-root extension (HKDF L 96 -> 128) relies
// on HKDF-Expand's prefix-stream property: okm[0:96] must stay byte-identical, or every
// existing user's viewing/spending/solana keys and meta-address silently rotate.
// Only L may ever change; a salt or info change is NOT prefix-stable and must fail here.
import { describe, expect, it } from "vitest";
import { deriveKeysFromSignature } from "@opaquecash/opaque";

const hex = (u8: Uint8Array) => Buffer.from(u8).toString("hex");

const VECTORS = [
  {
    signature: ("0x" + "11".repeat(65)) as `0x${string}`,
    viewingKey: "dfbc218980ba08986baa5d88aac570f09c48a93a3d96048cfe8f27866feadc7b",
    spendingKey: "51359efa9b99b7e8cb11e9c394b2335ce677a5a498306dc3c223992846669d61",
    solanaSpendingKey: "86d2bbe27490d02efc61cda050ea743fb2a088cbc402f6c5e5d37497bc7be80c",
  },
  {
    signature: ("0x" + "a1b2c3d4e5f60718293a4b5c6d7e8f90".repeat(8) + "1b") as `0x${string}`,
    viewingKey: "f2f616674e7cda7bfd1e7f7d8b87d995df391a2677a0f4df9086f80ee4b2c2aa",
    spendingKey: "3a593405d12854d14d6e8b72725434f96375c1f426686dfa5f7c397d8639de52",
    solanaSpendingKey: "cbfcf744253d4568361ca12ec61dd60873af6111502bf3e7572c80a3233fa050",
  },
  {
    signature: ("0x" + "deadbeefcafef00d".repeat(16) + "1c") as `0x${string}`,
    viewingKey: "73958fa3b999caf493885c980284ee7ee756b365a5171e1f21d9904a03101665",
    spendingKey: "4e5c959b395782a47c5c0c6db9a7b62cb883ac062d05ede89958288ede82ab00",
    solanaSpendingKey: "665f78b319742e01560a11747b87d4133b6a5c2250c548f3fe5342d8f5381928",
  },
];

describe("deriveKeysFromSignature golden vectors (pinned from @opaquecash/opaque@0.2.12)", () => {
  it.each(VECTORS)("okm[0:96] is byte-identical for $signature", (v) => {
    const keys = deriveKeysFromSignature(v.signature);
    expect(hex(keys.viewingKey)).toBe(v.viewingKey);
    expect(hex(keys.spendingKey)).toBe(v.spendingKey);
    expect(hex(keys.solanaSpendingKey)).toBe(v.solanaSpendingKey);
  });
});
