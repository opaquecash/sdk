import { describe, it, expect } from "vitest";
import { recoverTypedDataAddress, recoverAddress, hashTypedData, getAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  signStealthSweepAuthorization,
  signStealthTokenPermit,
  encodeSweepWithPermit,
} from "@opaquecash/stealth-chain";

const FORWARDER = getAddress("0x000000000000000000000000000000000000f0de");
const TOKEN = getAddress("0x73197e8303904862d543f9706e8422f634d713cb");
const DEST = getAddress("0x1111111111111111111111111111111111111111");
const CHAIN_ID = 11155111;

const SWEEP_TYPES = {
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

describe("gasless sweep authorization", () => {
  it("produces an owner signature that recovers to the stealth address", async () => {
    const key = generatePrivateKey();
    const owner = privateKeyToAccount(key).address;

    const { ownerSig, authorization } = await signStealthSweepAuthorization({
      stealthPrivKey: key,
      forwarder: FORWARDER,
      chainId: CHAIN_ID,
      authorization: {
        token: TOKEN,
        destination: DEST,
        value: 1_000_000n,
        fee: 10_000n,
        nonce: 0n,
        deadline: 9_999_999_999n,
      },
    });

    expect(authorization.owner).toBe(owner);
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "OpaqueStealthTokenSweep",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: FORWARDER,
      },
      types: SWEEP_TYPES,
      primaryType: "Sweep",
      message: authorization,
      signature: ownerSig,
    });
    expect(recovered).toBe(owner);
  });

  it("permit signature recovers to the owner and encodes valid calldata", async () => {
    const key = generatePrivateKey();
    const owner = privateKeyToAccount(key).address;
    const deadline = 9_999_999_999n;

    const permit = await signStealthTokenPermit({
      stealthPrivKey: key,
      token: TOKEN,
      chainId: CHAIN_ID,
      spender: FORWARDER,
      value: 1_000_000n,
      nonce: 0n,
      deadline,
      tokenName: "Test USD",
    });

    // Reconstruct the EIP-2612 digest and recover from the split (r,s,v).
    const digest = hashTypedData({
      domain: { name: "Test USD", version: "1", chainId: CHAIN_ID, verifyingContract: TOKEN },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner, spender: FORWARDER, value: 1_000_000n, nonce: 0n, deadline },
    });
    const recovered = await recoverAddress({
      hash: digest,
      signature: { r: permit.r, s: permit.s, v: BigInt(permit.v) },
    });
    expect(recovered).toBe(owner);

    const { authorization, ownerSig } = await signStealthSweepAuthorization({
      stealthPrivKey: key,
      forwarder: FORWARDER,
      chainId: CHAIN_ID,
      authorization: {
        token: TOKEN,
        destination: DEST,
        value: 1_000_000n,
        fee: 0n,
        nonce: 0n,
        deadline,
      },
    });
    const data = encodeSweepWithPermit(authorization, ownerSig, permit);
    // sweepWithPermit selector.
    expect(data.startsWith("0x")).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });
});
