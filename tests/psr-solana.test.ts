import { describe, it, expect } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  anchorDiscriminator,
  accountDiscriminator,
  getPsrSolanaPrograms,
  computeSchemaId,
  deriveSchemaPda,
  buildRegisterSchemaInstruction,
  parseSchemaPda,
  deriveAttestationPda,
  buildAttestInstruction,
  encodeGroth16Proof,
  deriveRootHistoryPda,
  deriveNullifierPda,
  buildVerifyReputationInstruction,
  fetchLatestValidMerkleRoot,
  VERIFY_REPUTATION_DISCRIMINATOR,
} from "@opaquecash/psr-chain-solana";

const programs = getPsrSolanaPrograms("devnet");
const authority = Keypair.generate().publicKey;

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

describe("discriminators", () => {
  it("are 8 bytes and deterministic", () => {
    const a = anchorDiscriminator("register_schema");
    expect(a).toHaveLength(8);
    expect([...a]).toEqual([...anchorDiscriminator("register_schema")]);
    expect([...a]).not.toEqual([...anchorDiscriminator("attest")]);
    expect(accountDiscriminator("SchemaPDA")).toHaveLength(8);
  });
});

describe("program ids", () => {
  it("resolves the four PSR program ids from the devnet deployment", () => {
    expect(programs.schemaRegistry.toBase58()).toBe("FbgMJYGWnLKLcrKYS1NxM5uER1ihQkYLMTLs4STuDMWB");
    expect(programs.attestationEngineV2.toBase58()).toBe("4T9kPCVCFGdEuLpEqRJihsPCbEEo2LWWDEPFvUESEqtM");
    expect(programs.reputationVerifier.toBase58()).toBe("BSnkCDoTpgNVN5BbF3aN5L5EJPiaYUkqqj9MHp8kaqWM");
  });
});

describe("schema registry", () => {
  it("computes a 32-byte deterministic schema id", () => {
    const id = computeSchemaId(authority, "KycPassed");
    expect(id).toHaveLength(32);
    expect([...id]).toEqual([...computeSchemaId(authority, "KycPassed")]);
    expect([...id]).not.toEqual([...computeSchemaId(authority, "Other")]);
  });

  it("derives a deterministic schema PDA", () => {
    const id = computeSchemaId(authority, "KycPassed");
    const a = deriveSchemaPda(programs.schemaRegistry, authority, id);
    expect(a.toBase58()).toBe(deriveSchemaPda(programs.schemaRegistry, authority, id).toBase58());
    expect(a).toBeInstanceOf(PublicKey);
  });

  it("builds register_schema with the right discriminator and accounts", () => {
    const id = computeSchemaId(authority, "KycPassed");
    const schemaPda = deriveSchemaPda(programs.schemaRegistry, authority, id);
    const ix = buildRegisterSchemaInstruction({
      schemaRegistryProgramId: programs.schemaRegistry,
      authority,
      schemaPda,
      schemaId: id,
      name: "KycPassed",
      fieldDefinitions: "bool passed",
      revocable: true,
      resolver: null,
      schemaExpirySlot: 0,
    });
    expect(ix.programId.toBase58()).toBe(programs.schemaRegistry.toBase58());
    expect(ix.keys).toHaveLength(3);
    expect(ix.keys[1].isSigner).toBe(true);
    const data = new Uint8Array(ix.data);
    expect([...data.slice(0, 8)]).toEqual([...anchorDiscriminator("register_schema")]);
    expect([...data.slice(8, 40)]).toEqual([...id]);
  });

  it("parses a SchemaPDA account buffer", () => {
    const schemaId = Buffer.alloc(32, 1);
    const name = "MySchema";
    const fd = "bool passed";
    const buf = Buffer.concat([
      accountDiscriminator("SchemaPDA"),
      Buffer.from([255]), // bump
      schemaId,
      authority.toBuffer(),
      PublicKey.default.toBuffer(), // resolver
      Buffer.from([1]), // revocable
      u32(name.length),
      Buffer.from(name),
      u32(fd.length),
      Buffer.from(fd),
      Buffer.from([1]), // version
      u32(0), // delegate count
      u64(100n), // createdAt
      u64(0n), // expiry
      Buffer.from([0]), // deprecated
    ]);
    const parsed = parseSchemaPda(buf);
    expect(parsed).not.toBeNull();
    expect([...parsed!.schemaId]).toEqual([...new Uint8Array(schemaId)]);
    expect(parsed!.authority.toBase58()).toBe(authority.toBase58());
    expect(parsed!.name).toBe(name);
    expect(parsed!.fieldDefinitions).toBe(fd);
    expect(parsed!.version).toBe(1);
    expect(parsed!.delegates).toHaveLength(0);
    expect(parsed!.createdAt).toBe(100n);
    expect(parsed!.deprecated).toBe(false);
    expect(parseSchemaPda(Buffer.alloc(8))).toBeNull();
  });
});

describe("attestation engine", () => {
  it("derives a deterministic attestation PDA and builds attest", () => {
    const schemaId = new Uint8Array(32).fill(2);
    const issuer = Keypair.generate().publicKey;
    const stealthHash = new Uint8Array(32).fill(3);
    const pda = deriveAttestationPda(programs.attestationEngineV2, schemaId, issuer, stealthHash);
    expect(pda.toBase58()).toBe(
      deriveAttestationPda(programs.attestationEngineV2, schemaId, issuer, stealthHash).toBase58(),
    );
    const ix = buildAttestInstruction({
      attestationProgramId: programs.attestationEngineV2,
      issuer,
      schemaPda: deriveSchemaPda(programs.schemaRegistry, issuer, schemaId),
      attestationPda: pda,
      stealthAddressHash: stealthHash,
      data: new Uint8Array([1, 2, 3]),
      expirationSlot: 0,
      refUid: new Uint8Array(32),
    });
    expect(ix.keys).toHaveLength(5); // schema, attestation, issuer, resolver placeholder, system
    expect(ix.keys[3].pubkey.toBase58()).toBe(PublicKey.default.toBase58());
    expect([...new Uint8Array(ix.data).slice(0, 8)]).toEqual([...anchorDiscriminator("attest")]);
  });
});

describe("reputation verifier", () => {
  it("encodes a Groth16 proof into 64/128/64 byte big-endian fields", () => {
    const { proofA, proofB, proofC } = encodeGroth16Proof({
      pi_a: ["1", "2"],
      pi_b: [["3", "4"], ["5", "6"]],
      pi_c: ["7", "8"],
    });
    expect(proofA).toHaveLength(64);
    expect(proofB).toHaveLength(128);
    expect(proofC).toHaveLength(64);
    expect(proofA[31]).toBe(1); // big-endian: last byte of first coordinate
    expect(proofA[63]).toBe(2);
  });

  it("derives PDAs and builds verify_reputation with the fixed dispatch tag", () => {
    expect(deriveRootHistoryPda(programs.reputationVerifier).toBase58()).toBe(
      deriveRootHistoryPda(programs.reputationVerifier).toBase58(),
    );
    const ix = buildVerifyReputationInstruction({
      reputationProgramId: programs.reputationVerifier,
      groth16ProgramId: programs.groth16Verifier,
      configPda: PublicKey.default,
      rootPda: PublicKey.default,
      nullifierPda: deriveNullifierPda(programs.reputationVerifier, new Uint8Array(32).fill(4)),
      payer: authority,
      proofA: new Uint8Array(64),
      proofB: new Uint8Array(128),
      proofC: new Uint8Array(64),
      rootBytes: new Uint8Array(32),
      attestationId: 7,
      externalNullifier: 42n,
      nullifierBytes: new Uint8Array(32).fill(4),
    });
    expect(ix.keys).toHaveLength(6);
    const data = new Uint8Array(ix.data);
    expect(data).toHaveLength(8 + 64 + 128 + 64 + 32 + 8 + 8 + 32);
    expect([...data.slice(0, 8)]).toEqual([...VERIFY_REPUTATION_DISCRIMINATOR]);
  });

  it("reads the latest root from a mocked root history account", async () => {
    const root = new Uint8Array(32).fill(9);
    const buf = Buffer.concat([Buffer.alloc(8), u32(1), Buffer.from(root)]);
    const conn = { getAccountInfo: async () => ({ data: buf }) } as unknown as Connection;
    const got = await fetchLatestValidMerkleRoot(conn, programs.reputationVerifier);
    expect([...got]).toEqual([...root]);
  });
});
