/**
 * Base class for PSR errors surfaced to applications.
 */
export class PsrError extends Error {
  /** Machine-readable tag for logging and UI. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PsrError";
    this.code = code;
  }
}

/** Groth16 or witness pipeline failed. */
export class ProofError extends PsrError {
  constructor(message: string) {
    super("PROOF_ERROR", message);
    this.name = "ProofError";
  }
}

/** Merkle root is missing or past verifier TTL. */
export class RootExpiredError extends PsrError {
  constructor(message = "Merkle root expired or unknown on verifier") {
    super("ROOT_EXPIRED", message);
    this.name = "RootExpiredError";
  }
}

/** On-chain nullifier already consumed. */
export class NullifierUsedError extends PsrError {
  constructor(message = "Nullifier already used for this reputation proof") {
    super("NULLIFIER_USED", message);
    this.name = "NullifierUsedError";
  }
}
