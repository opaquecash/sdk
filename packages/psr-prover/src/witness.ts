import { Buffer } from "buffer";

const TREE_DEPTH = 20;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) + BigInt(b);
  return result;
}

/**
 * Ensure `Buffer` exists for `circomlibjs` in browser bundles.
 */
export async function ensureBufferPolyfill(): Promise<void> {
  if (typeof globalThis !== "undefined" && !("Buffer" in globalThis)) {
    const g = globalThis as { Buffer?: typeof Buffer };
    g.Buffer = Buffer;
  }
}

/**
 * Circuit witness matching the **V2** `stealth_reputation` input names
 * (decimal-string field elements; see `circuits/v2/stealth_reputation.circom`).
 */
export interface CircuitWitness {
  stealth_pk: string;
  schema_id: string;
  issuer_pk_x: string;
  trait_data_hash: string;
  nonce: string;
  merkle_path: string[];
  merkle_path_indices: string[];
  merkle_root: string;
  attestation_id: string;
  external_nullifier: string;
  nullifier_hash: string;
}

/**
 * Inputs for {@link buildWitnessV2}. The leaf commits to
 * `Poseidon(stealth_pk, schema_id, issuer_pk_x, trait_data_hash, nonce)`.
 *
 * `issuerPkX`, `traitDataHash`, and `nonce` come from the attestation context.
 * When omitted, deterministic dev-mode values are derived so the same
 * (holder, schema) pair always rebuilds the same leaf — and therefore the same
 * Merkle root, keeping a previously registered dev root valid across sessions.
 */
export interface BuildWitnessV2Params {
  /** Numeric trait/schema id — becomes both `schema_id` and the public `attestation_id`. */
  attestationId: number | bigint | string;
  /** 32-byte reconstructed one-time stealth private key. */
  stealthPrivKeyBytes: Uint8Array;
  /** External nullifier as a decimal string (action scope). */
  externalNullifier: string;
  /** Issuer's BabyJubJub x-coordinate as a field element. Dev default derived from the schema id. */
  issuerPkX?: string | bigint;
  /** Poseidon hash of the attestation data payload. Dev default derived from the schema id. */
  traitDataHash?: string | bigint;
  /** Leaf-blinding secret. Dev default: `Poseidon(stealth_pk, schema_id)` (deterministic). */
  nonce?: string | bigint;
}

/**
 * Build a **dev-mode** V2 Merkle witness: the trait's leaf sits at index 0 of an
 * otherwise-empty zero-hash tree, so the resulting `merkle_root` is exactly what
 * the verifier admin registers for this leaf via `update_merkle_root` /
 * `submitMerkleRoot`. Production indexers must build the real announcement tree
 * with the identical leaf formula.
 */
export async function buildWitnessV2(
  params: BuildWitnessV2Params,
): Promise<CircuitWitness> {
  await ensureBufferPolyfill();
  const circomlib = await import("circomlibjs");
  const poseidon = await circomlib.buildPoseidon();
  const F = poseidon.F;
  const H = (inputs: bigint[]): bigint => F.toObject(poseidon(inputs)) as bigint;

  const schemaId = BigInt(params.attestationId);
  const extNullifier = BigInt(params.externalNullifier);
  const stealthPk = F.toObject(F.e(bytesToBigInt(params.stealthPrivKeyBytes))) as bigint;

  const issuerPkX =
    params.issuerPkX !== undefined ? BigInt(params.issuerPkX) : H([schemaId, 1n]);
  const traitDataHash =
    params.traitDataHash !== undefined ? BigInt(params.traitDataHash) : H([schemaId, 2n]);
  const nonce =
    params.nonce !== undefined ? BigInt(params.nonce) : H([stealthPk, schemaId]);

  // leaf = Poseidon(stealth_pk, schema_id, issuer_pk_x, trait_data_hash, nonce)
  const leaf = H([stealthPk, schemaId, issuerPkX, traitDataHash, nonce]);

  // Zero-hash sibling chain: leaf at index 0 of an otherwise-empty tree.
  const zeroHashes: bigint[] = [H([0n, 0n])];
  for (let i = 1; i < TREE_DEPTH; i++) {
    zeroHashes.push(H([zeroHashes[i - 1], zeroHashes[i - 1]]));
  }

  const merklePath: string[] = [];
  const merklePathIndices: string[] = [];
  let current = leaf;
  for (let i = 0; i < TREE_DEPTH; i++) {
    merklePath.push(zeroHashes[i].toString());
    merklePathIndices.push("0");
    current = H([current, zeroHashes[i]]);
  }

  const nullifierHash = H([stealthPk, extNullifier]);

  return {
    stealth_pk: stealthPk.toString(),
    schema_id: schemaId.toString(),
    issuer_pk_x: issuerPkX.toString(),
    trait_data_hash: traitDataHash.toString(),
    nonce: nonce.toString(),
    merkle_path: merklePath,
    merkle_path_indices: merklePathIndices,
    merkle_root: current.toString(),
    attestation_id: schemaId.toString(),
    external_nullifier: extNullifier.toString(),
    nullifier_hash: nullifierHash.toString(),
  };
}
