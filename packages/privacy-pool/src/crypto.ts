/**
 * Privacy-pool commitments and Poseidon Merkle trees (spec/privacy-pool.md §1–§3),
 * byte-identical to `withdrawal.circom` and `OpaquePrivacyPool` / `MerkleTreeWithHistory`.
 * All hashing is circomlib Poseidon over BN254; the empty leaf is 0 and
 * `zeros[i] = Poseidon(zeros[i-1], zeros[i-1])`.
 */

// @ts-expect-error untyped
import { buildPoseidon } from "circomlibjs";

export const POOL_LEVELS = 20;
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface PoolCrypto {
  /** Poseidon over field elements; returns a bigint. */
  hash(inputs: bigint[]): bigint;
  /** precommitment = Poseidon(nullifier, secret). */
  precommitment(nullifier: bigint, secret: bigint): bigint;
  /** commitment = Poseidon(value, label, precommitment). */
  commitment(value: bigint, label: bigint, precommitment: bigint): bigint;
  /** label = Poseidon(scope, depositIndex). */
  label(scope: bigint, depositIndex: bigint): bigint;
  /** nullifierHash = Poseidon(nullifier). */
  nullifierHash(nullifier: bigint): bigint;
  /** Zero-subtree roots, `zeros[0..LEVELS]`. */
  zeros: bigint[];
}

/** Build the Poseidon-backed pool crypto (async: circomlibjs loads a wasm). */
export async function buildPoolCrypto(): Promise<PoolCrypto> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash = (inputs: bigint[]): bigint => F.toObject(poseidon(inputs)) as bigint;

  const zeros: bigint[] = [0n];
  for (let i = 1; i <= POOL_LEVELS; i++) zeros.push(hash([zeros[i - 1], zeros[i - 1]]));

  return {
    hash,
    zeros,
    precommitment: (nullifier, secret) => hash([nullifier, secret]),
    commitment: (value, label, precommitment) => hash([value, label, precommitment]),
    label: (scope, depositIndex) => hash([scope, depositIndex]),
    nullifierHash: (nullifier) => hash([nullifier]),
  };
}

/**
 * An append-only Poseidon Merkle tree mirroring `MerkleTreeWithHistory`. Build it from
 * the pool's ordered leaves (deposit/remainder commitments for the state tree, approved
 * labels for the association tree) to derive inclusion paths for the withdrawal witness.
 */
export class PoolMerkleTree {
  private layers: bigint[][];

  constructor(
    private readonly crypto: PoolCrypto,
    leaves: bigint[],
    private readonly levels = POOL_LEVELS,
  ) {
    this.layers = [leaves.slice()];
    for (let level = 0; level < levels; level++) {
      const cur = this.layers[level];
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const left = cur[i];
        const right = i + 1 < cur.length ? cur[i + 1] : crypto.zeros[level];
        next.push(crypto.hash([left, right]));
      }
      this.layers.push(next);
    }
  }

  /** The current root (matches the contract after inserting the same leaves in order). */
  root(): bigint {
    const top = this.layers[this.levels];
    return top.length > 0 ? top[0] : this.crypto.zeros[this.levels];
  }

  /** Inclusion path for the leaf at `index`: siblings + direction bits (0=left). */
  proof(index: number): { siblings: bigint[]; pathIndices: number[] } {
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const layer = this.layers[level];
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      siblings.push(siblingIdx < layer.length ? layer[siblingIdx] : this.crypto.zeros[level]);
      pathIndices.push(isRight ? 1 : 0);
      idx = Math.floor(idx / 2);
    }
    return { siblings, pathIndices };
  }
}
