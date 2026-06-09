import { Buffer } from "buffer";
import type { StealthWasmModule } from "@opaquecash/stealth-wasm";
import { generateReputationWitnessJson } from "@opaquecash/stealth-wasm";

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
 * Circuit witness object matching `stealth_attestation` public/private input names (decimal string fields).
 */
export interface CircuitWitness {
  merkle_root: string;
  attestation_id: string;
  external_nullifier: string;
  stealth_private_key: string;
  ephemeral_pubkey: [string, string];
  announcement_attestation_id: string;
  merkle_path_elements: string[];
  merkle_path_indices: number[];
}

/**
 * Build a **placeholder** Merkle witness using zero-hash siblings (matches Opaque wallet dev prover).
 *
 * For production you must align leaves with the same tree the verifier admin commits on-chain.
 *
 * @param traitAttestationId - Public attestation id to prove.
 * @param stealthPrivKeyBytes - 32-byte reconstructed one-time stealth private key.
 * @param externalNullifier - Decimal string or hex-compatible numeric string for the circuit scalar.
 */
export async function buildWitnessCircuitConsistent(
  traitAttestationId: number,
  stealthPrivKeyBytes: Uint8Array,
  externalNullifier: string,
): Promise<CircuitWitness> {
  await ensureBufferPolyfill();
  const circomlib = await import("circomlibjs");
  const poseidon = await circomlib.buildPoseidon();
  const babyjub = await circomlib.buildBabyjub();
  const F = poseidon.F;

  const attestationId = BigInt(traitAttestationId);
  const extNullifier = BigInt(externalNullifier);

  const stealthPriv = F.toObject(F.e(bytesToBigInt(stealthPrivKeyBytes)));
  const ephemeralPriv = F.toObject(F.e(stealthPriv + extNullifier + 1n));
  const stealthPub = babyjub.mulPointEscalar(
    babyjub.Base8,
    stealthPriv,
  ) as [unknown, unknown];
  const ephemeralPub = babyjub.mulPointEscalar(
    babyjub.Base8,
    ephemeralPriv,
  ) as [unknown, unknown];
  const sharedSecret = babyjub.mulPointEscalar(
    ephemeralPub,
    stealthPriv,
  ) as [unknown, unknown];

  const stealthPubX = F.toObject(stealthPub[0]);
  const stealthPubY = F.toObject(stealthPub[1]);
  const ephemeralPubX = F.toObject(ephemeralPub[0]);
  const ephemeralPubY = F.toObject(ephemeralPub[1]);
  const sharedX = F.toObject(sharedSecret[0]);
  const sharedY = F.toObject(sharedSecret[1]);

  const addressCommitment = F.toObject(
    poseidon([sharedX, sharedY, stealthPubX, stealthPubY]),
  );
  const leaf = F.toObject(poseidon([addressCommitment, attestationId]));

  const zeroHashes: bigint[] = [];
  zeroHashes.push(F.toObject(poseidon([0n, 0n])));
  for (let i = 1; i < TREE_DEPTH; i++) {
    zeroHashes.push(F.toObject(poseidon([zeroHashes[i - 1], zeroHashes[i - 1]])));
  }

  const merklePathElements: string[] = [];
  const merklePathIndices: number[] = [];
  let current = leaf;
  for (let i = 0; i < TREE_DEPTH; i++) {
    merklePathElements.push(zeroHashes[i].toString());
    merklePathIndices.push(0);
    current = F.toObject(poseidon([current, zeroHashes[i]]));
  }

  return {
    merkle_root: current.toString(),
    attestation_id: attestationId.toString(),
    external_nullifier: extNullifier.toString(),
    stealth_private_key: stealthPriv.toString(),
    ephemeral_pubkey: [ephemeralPubX.toString(), ephemeralPubY.toString()],
    announcement_attestation_id: attestationId.toString(),
    merkle_path_elements: merklePathElements,
    merkle_path_indices: merklePathIndices,
  };
}

/**
 * Delegate witness construction to Rust WASM (`generate_reputation_witness`) for full Merkle paths.
 *
 * @param wasm - Initialized `@opaquecash/stealth-wasm` module.
 * @param attestationsJson - JSON array string from the scanner.
 * @param targetTraitId - Decimal string attestation id to prove.
 * @param stealthPrivkeyBytes - 32-byte one-time stealth private key.
 * @param externalNullifier - Decimal string (must match {@link buildActionScope} encoding policy).
 */
export function buildWitnessFromWasm(
  wasm: StealthWasmModule,
  attestationsJson: string,
  targetTraitId: string,
  stealthPrivkeyBytes: Uint8Array,
  externalNullifier: string,
): CircuitWitness {
  const json = generateReputationWitnessJson(
    wasm,
    attestationsJson,
    targetTraitId,
    stealthPrivkeyBytes,
    externalNullifier,
  );
  return JSON.parse(json) as CircuitWitness;
}
