import { toField } from "@opaquecash/psr-core";
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
 * `issuerPkX`, `traitDataHash`, and `nonce` come from the real attestation context
 * (the scanner's `merkleLeafPreimage`) and are **required on the production path**.
 * The `nonce` in particular is a random leaf-blinding secret and MUST NOT be
 * derived from public data — a deterministic nonce enables leaf enumeration
 * (OPQ-038). Omitting any of the three is only permitted under `devMode: true`,
 * which derives deterministic zero-hash-tree defaults for local development.
 */
export interface BuildWitnessV2Params {
  /** Numeric trait/schema id — becomes both `schema_id` and the public `attestation_id`. */
  attestationId: number | bigint | string;
  /** 32-byte reconstructed one-time stealth private key. */
  stealthPrivKeyBytes: Uint8Array;
  /** External nullifier as a decimal string (action scope). */
  externalNullifier: string;
  /** Issuer's BabyJubJub x-coordinate as a field element. Required unless `devMode`. */
  issuerPkX?: string | bigint;
  /** Poseidon hash of the attestation data payload. Required unless `devMode`. */
  traitDataHash?: string | bigint;
  /** Random leaf-blinding secret from issuance. Required unless `devMode`. */
  nonce?: string | bigint;
  /**
   * Development-only escape hatch. When `true`, any omitted `issuerPkX` /
   * `traitDataHash` / `nonce` is filled with a deterministic default so the same
   * (holder, schema) pair always rebuilds the same dev leaf/root. NEVER enable on
   * a production path: the deterministic nonce is derivable from public data and
   * weakens unlinkability (OPQ-038).
   */
  devMode?: boolean;
}

/**
 * Build a V2 Merkle witness: the trait's leaf sits at index 0 of an otherwise-empty
 * zero-hash tree, so the resulting `merkle_root` is exactly what the verifier admin
 * registers for this leaf via `update_merkle_root` / `submitMerkleRoot`. Production
 * indexers must build the real announcement tree with the identical leaf formula.
 *
 * Requires the real leaf preimage (`issuerPkX`, `traitDataHash`, `nonce`); pass
 * `devMode: true` to derive deterministic dev defaults for any omitted field.
 *
 * @throws if a preimage field is missing and `devMode` is not enabled.
 */
export async function buildWitnessV2(
  params: BuildWitnessV2Params,
): Promise<CircuitWitness> {
  await ensureBufferPolyfill();
  const circomlib = await import("circomlibjs");
  const poseidon = await circomlib.buildPoseidon();
  const F = poseidon.F;
  const H = (inputs: bigint[]): bigint => F.toObject(poseidon(inputs)) as bigint;

  // Reduce into the BN254 field so the Poseidon preimage, the witness signal, and the
  // on-chain public input all use the identical value — a 256-bit schema_id / external
  // nullifier otherwise commits to `value mod r` in the proof but is submitted un-reduced,
  // and the verifier's checkField rejects it (OPQ-008).
  const schemaId = toField(BigInt(params.attestationId));
  const extNullifier = toField(BigInt(params.externalNullifier));
  const stealthPk = F.toObject(F.e(bytesToBigInt(params.stealthPrivKeyBytes))) as bigint;

  const requirePreimage = (
    name: string,
    explicit: string | bigint | undefined,
    devDefault: () => bigint,
  ): bigint => {
    if (explicit !== undefined) return BigInt(explicit);
    if (!params.devMode) {
      throw new Error(
        `buildWitnessV2: "${name}" is required. Supply the real attestation leaf preimage ` +
          `(issuerPkX/traitDataHash/nonce, e.g. from a DiscoveredTrait's merkleLeafPreimage), ` +
          `or pass devMode: true for local development. The leaf nonce MUST be random and ` +
          `MUST NOT be derived from public data (OPQ-038).`,
      );
    }
    return devDefault();
  };

  const issuerPkX = requirePreimage("issuerPkX", params.issuerPkX, () => H([schemaId, 1n]));
  const traitDataHash = requirePreimage("traitDataHash", params.traitDataHash, () => H([schemaId, 2n]));
  const nonce = requirePreimage("nonce", params.nonce, () => H([stealthPk, schemaId]));

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
