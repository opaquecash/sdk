/**
 * Shamir viewing-key escrow — spec/conditional-disclosure.md §2.
 *
 * Splits the 32-byte CSAP viewing-key scalar into n shares with threshold m
 * over GF(256) (audited `shamir-secret-sharing`). Each share is wrapped in the
 * versioned envelope `base64(0x01 ‖ m ‖ n ‖ index ‖ raw_share)` so recovery can
 * enforce the threshold and reject mixed share sets — the underlying scheme
 * silently returns garbage when combined below threshold.
 *
 * NORMATIVE WARNING (spec §2): combining m shares reconstructs the FULL viewing
 * key and reveals the owner's entire incoming-payment history to the combiner.
 * This is the recovery backstop, not the disclosure path; active disclosure is
 * the FROST-gated proof flow in prove.ts/tx.ts.
 */
import { split as gf256Split, combine as gf256Combine } from "shamir-secret-sharing";

export const SHARE_SCHEME = "shamir-gf256-v1";
const SHARE_VERSION = 0x01;
const VIEWING_KEY_LENGTH = 32;
/** envelope = version ‖ m ‖ n ‖ index */
const ENVELOPE_HEADER_LENGTH = 4;

export interface ParsedShare {
  /** Envelope version (currently 1). */
  version: number;
  /** Recovery threshold m. */
  threshold: number;
  /** Total shares issued n. */
  total: number;
  /** 1-based custodian index this share was issued to. */
  index: number;
  /** The raw GF(256) share. */
  share: Uint8Array;
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const fromBase64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

/**
 * Split a 32-byte viewing key into `custodians` shares, any `threshold` of
 * which recover it. Returns base64 envelope strings, ordered by custodian
 * index (1-based).
 */
export async function splitViewingKey(
  viewingKey: Uint8Array,
  threshold: number,
  custodians: number,
): Promise<string[]> {
  if (viewingKey.length !== VIEWING_KEY_LENGTH) {
    throw new Error(`viewing key must be ${VIEWING_KEY_LENGTH} bytes, got ${viewingKey.length}`);
  }
  if (!Number.isInteger(threshold) || !Number.isInteger(custodians)) {
    throw new Error("threshold and custodians must be integers");
  }
  if (threshold < 2) throw new Error("threshold must be at least 2 (1 would be no escrow)");
  if (custodians < threshold) throw new Error("custodians must be >= threshold");
  if (custodians > 255) throw new Error("at most 255 custodians");

  const raw = await gf256Split(viewingKey, custodians, threshold);
  return raw.map((share, i) => {
    const envelope = new Uint8Array(ENVELOPE_HEADER_LENGTH + share.length);
    envelope[0] = SHARE_VERSION;
    envelope[1] = threshold;
    envelope[2] = custodians;
    envelope[3] = i + 1;
    envelope.set(share, ENVELOPE_HEADER_LENGTH);
    return toBase64(envelope);
  });
}

/** Decode and validate a single share envelope. */
export function parseShare(encoded: string): ParsedShare {
  const bytes = fromBase64(encoded);
  if (bytes.length <= ENVELOPE_HEADER_LENGTH) throw new Error("share envelope too short");
  const [version, threshold, total, index] = bytes;
  if (version !== SHARE_VERSION) throw new Error(`unsupported share version ${version}`);
  if (threshold < 2 || total < threshold) throw new Error("corrupt share envelope (threshold/total)");
  if (index < 1 || index > total) throw new Error("corrupt share envelope (index)");
  return { version, threshold, total, index, share: bytes.slice(ENVELOPE_HEADER_LENGTH) };
}

/**
 * Recover the viewing key from `>= threshold` envelope shares. Rejects shares
 * from different splits (mismatched m/n), duplicate custodian indices, and
 * share sets below the recorded threshold.
 */
export async function recoverViewingKey(shares: string[]): Promise<Uint8Array> {
  if (shares.length === 0) throw new Error("no shares provided");
  const parsed = shares.map(parseShare);

  const { threshold, total } = parsed[0];
  for (const p of parsed) {
    if (p.threshold !== threshold || p.total !== total) {
      throw new Error("shares are from different splits (threshold/total mismatch)");
    }
  }
  const indices = new Set(parsed.map((p) => p.index));
  if (indices.size !== parsed.length) throw new Error("duplicate share indices");
  if (parsed.length < threshold) {
    throw new Error(`need ${threshold} shares to recover, got ${parsed.length}`);
  }

  const key = await gf256Combine(parsed.map((p) => p.share));
  if (key.length !== VIEWING_KEY_LENGTH) {
    throw new Error(`recovered ${key.length} bytes, expected ${VIEWING_KEY_LENGTH}`);
  }
  return key;
}
