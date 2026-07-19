/**
 * Counterfactual Starknet stealth address derivation.
 *
 * The golden address below was cross-validated three ways for CSAP canonical
 * vector 1's one-time key (`0x9d1fcbe…1e2e`):
 *   1. `starknet.js` `hash.calculateContractAddressFromHash` — the ecosystem
 *      reference used by every wallet — produced the identical address.
 *   2. `starknet.js` `EthSigner.getPubKey()` produced the identical (x, y),
 *      confirming the `[x.low, x.high, y.low, y.high]` constructor calldata.
 *   3. The on-chain `StealthAccount` Serde round-trips that same layout
 *      (starknet repo `test_account_reports_its_stealth_public_key`).
 * The computation here is dependency-light (Pedersen from `@scure/starknet`).
 */
import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  computeStarknetStealthAccount,
  ethPublicKeyCalldata,
  STARKNET_SEPOLIA,
  stealthAccountSalt,
} from "@opaquecash/stealth-chain-starknet";

const ONE_TIME_KEY =
  0x9d1fcbe17267729a88091556cadd19b3c11e33029883163d1d7118bc21a61e2en;
const EPHEMERAL = Uint8Array.from(
  Buffer.from(
    "02b95c249d84f417e3e395a127425428b540671cc15881eb828c17b722a53fc599",
    "hex",
  ),
);

function pStealthUncompressed(): Uint8Array {
  return secp256k1.getPublicKey(ONE_TIME_KEY, false);
}

describe("computeStarknetStealthAccount", () => {
  it("matches the starknet.js-validated golden address", () => {
    const acct = computeStarknetStealthAccount(pStealthUncompressed(), EPHEMERAL);
    expect(acct.address).toBe(
      "0x5c12134bc82dc4cf9f56ae036a0ba5ec85948c73304a3a6c1e08aa11e806ca2",
    );
    expect(acct.classHash).toBe(
      `0x${BigInt(STARKNET_SEPOLIA.stealthAccountClassHash).toString(16)}`,
    );
  });

  it("lays out the constructor calldata as [x.low, x.high, y.low, y.high]", () => {
    // The (x, y) starknet.js EthSigner derives for this key.
    const x =
      0xdce27b82cd1ed4232b569e14121f4825a2ef189d14807d43c8d093fa8354f61bn;
    const y =
      0xbe8434ee5844371e291dcd5d93c072ea6e6f3eeab87a5bf42b3c08c52b66f2bcn;
    const mask = (1n << 128n) - 1n;
    expect(ethPublicKeyCalldata(pStealthUncompressed())).toEqual([
      x & mask,
      x >> 128n,
      y & mask,
      y >> 128n,
    ]);
  });

  it("derives the salt from the ephemeral key (announcement-derivable)", () => {
    const acct = computeStarknetStealthAccount(pStealthUncompressed(), EPHEMERAL);
    expect(acct.salt).toBe(stealthAccountSalt(EPHEMERAL));
    // A different ephemeral key gives a different salt (and address).
    const other = Uint8Array.from(EPHEMERAL);
    other[1] ^= 0x01;
    expect(stealthAccountSalt(other)).not.toBe(acct.salt);
  });

  it("rejects malformed inputs", () => {
    expect(() => ethPublicKeyCalldata(new Uint8Array(64))).toThrow(/uncompressed/);
    expect(() => stealthAccountSalt(new Uint8Array(32))).toThrow(/33 bytes/);
  });
});
