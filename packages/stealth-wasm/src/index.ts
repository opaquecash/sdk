/**
 * `@opaquecash/stealth-wasm` — load and call the Opaque Rust/WASM cryptography module (wasm-pack `--target web`).
 *
 * Point {@link InitStealthWasmOptions.moduleUrl} at your deployed `cryptography.js` (or bundle it).
 * The same module backs stealth scanning, key reconstruction, and PSR witness helpers.
 *
 * @packageDocumentation
 */

import type { StealthWasmEntry, StealthWasmModule } from "./types.js";

export type { StealthWasmEntry, StealthWasmModule } from "./types.js";

let cached: StealthWasmModule | null = null;
let debugLoggedScan = false;

function shouldDebug(): boolean {
  try {
    // Opt-in flag for docs playground / debugging sessions.
    return (globalThis as any)?.__OPAQUE_DEBUG === true;
  } catch {
    return false;
  }
}

function debugByteLenFromHex(hex: unknown): number | null {
  if (typeof hex !== "string") return null;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length === 0) return 0;
  if (h.length % 2 !== 0) return null;
  return h.length / 2;
}

/**
 * Options for {@link initStealthWasm}.
 */
export interface InitStealthWasmOptions {
  /**
   * URL or import path to the wasm-pack JS glue (e.g. `/pkg/cryptography.js`).
   * If omitted, {@link initStealthWasm} uses `moduleSpecifier` or throws.
   */
  moduleUrl?: string | URL;
  /**
   * Dynamic `import()` string for bundlers (e.g. `new URL('./cryptography.js', import.meta.url).href`).
   */
  moduleSpecifier?: string;
  /**
   * Optional explicit wasm binary URL if the glue does not embed it.
   */
  wasmBinaryUrl?: string | URL;
}

/**
 * Load the cryptography WASM module and return the API singleton.
 *
 * Idempotent: subsequent calls resolve the same initialized instance when `forceReload` is false.
 *
 * @param options - How to resolve the wasm-pack JavaScript entry; or pass a pre-imported module.
 * @returns Initialized {@link StealthWasmModule}.
 *
 * @example
 * ```ts
 * const wasm = await initStealthWasm({
 *   moduleSpecifier: new URL("/pkg/cryptography.js", import.meta.url).href,
 * });
 * const key = wasm.reconstruct_signing_key_wasm(spend, view, ephemeral);
 * ```
 */
export async function initStealthWasm(
  options?: InitStealthWasmOptions & { forceReload?: boolean },
): Promise<StealthWasmModule> {
  if (cached && !options?.forceReload) return cached;

  const spec = options?.moduleSpecifier ?? options?.moduleUrl?.toString();
  if (!spec) {
    throw new Error(
      "initStealthWasm: provide `moduleSpecifier` or `moduleUrl` to your cryptography.js entry",
    );
  }

  const mod = (await import(/* webpackIgnore: true */ spec)) as StealthWasmEntry;
  const initFn = mod.default ?? mod.init;
  if (typeof initFn === "function") {
    await initFn(
      options?.wasmBinaryUrl !== undefined
        ? { module_or_path: options.wasmBinaryUrl }
        : undefined,
    );
  } else if (typeof mod.init === "function") {
    mod.init();
  }

  cached = mod as StealthWasmModule;
  return cached;
}

/**
 * Reset the cached WASM instance (mainly for tests or hot reload).
 */
export function resetStealthWasmCache(): void {
  cached = null;
}

/**
 * Cheap filter: compare announcement view tag to recipient viewing key + ephemeral pubkey.
 *
 * @param wasm - Initialized module from {@link initStealthWasm}.
 * @param viewTag - First metadata byte from the announcement.
 * @param viewPrivkeyBytes - 32-byte viewing private key.
 * @param ephemeralPubkeyBytes - 33-byte compressed ephemeral public key.
 * @returns `"PossibleMatch"` if the tag might match; `"NoMatch"` to skip full ECDH.
 */
export function checkAnnouncementViewTag(
  wasm: StealthWasmModule,
  viewTag: number,
  viewPrivkeyBytes: Uint8Array,
  ephemeralPubkeyBytes: Uint8Array,
): string {
  return wasm.check_announcement_view_tag_wasm(
    viewTag,
    viewPrivkeyBytes,
    ephemeralPubkeyBytes,
  );
}

/**
 * Verify that an announcement belongs to this recipient (full check).
 */
export function checkAnnouncement(
  wasm: StealthWasmModule,
  announcementStealthAddress: string,
  viewTag: number,
  viewPrivkeyBytes: Uint8Array,
  spendPubkeyBytes: Uint8Array,
  ephemeralPubkeyBytes: Uint8Array,
): boolean {
  return wasm.check_announcement_wasm(
    announcementStealthAddress,
    viewTag,
    viewPrivkeyBytes,
    spendPubkeyBytes,
    ephemeralPubkeyBytes,
  );
}

/**
 * Reconstruct the 32-byte one-time stealth private key for the given announcement keys.
 */
export function reconstructSigningKey(
  wasm: StealthWasmModule,
  masterSpendPrivBytes: Uint8Array,
  masterViewPrivBytes: Uint8Array,
  ephemeralPubkeyBytes: Uint8Array,
): Uint8Array {
  return wasm.reconstruct_signing_key_wasm(
    masterSpendPrivBytes,
    masterViewPrivBytes,
    ephemeralPubkeyBytes,
  );
}

/**
 * Derive stealth address + view tag using WASM (sender flow).
 */
export function deriveStealthAddress(
  wasm: StealthWasmModule,
  viewPrivkeyBytes: Uint8Array,
  spendPubkeyBytes: Uint8Array,
  ephemeralPubkeyBytes: Uint8Array,
): { stealthAddress: string; viewTag: number } {
  return wasm.derive_stealth_address_wasm(
    viewPrivkeyBytes,
    spendPubkeyBytes,
    ephemeralPubkeyBytes,
  );
}

/**
 * Encode announcement metadata for a PSR attestation (view tag byte + attestation id).
 */
export function encodeAttestationMetadata(
  wasm: StealthWasmModule,
  viewTag: number,
  attestationId: bigint,
): string {
  return wasm.encode_attestation_metadata_wasm(viewTag, attestationId);
}

/**
 * Run WASM witness generation for the reputation circuit from a JSON attestation list.
 */
export function generateReputationWitnessJson(
  wasm: StealthWasmModule,
  attestationsJson: string,
  targetTraitId: string,
  stealthPrivkeyBytes: Uint8Array,
  externalNullifier: string,
): string {
  return wasm.generate_reputation_witness(
    attestationsJson,
    targetTraitId,
    stealthPrivkeyBytes,
    externalNullifier,
  );
}

/**
 * Scan announcements JSON and return JSON string of matching stealth attestations.
 */
export function scanAttestationsJson(
  wasm: StealthWasmModule,
  announcementsJson: string,
  viewPrivkeyBytes: Uint8Array,
  spendPubkeyBytes: Uint8Array,
): string {
  if (shouldDebug() && !debugLoggedScan) {
    debugLoggedScan = true;
    try {
      const parsed = JSON.parse(announcementsJson) as any[];
      const first = Array.isArray(parsed) ? parsed[0] : undefined;
      console.groupCollapsed("[opaque.debug] scanAttestationsJson input");
      console.log("records:", Array.isArray(parsed) ? parsed.length : "non-array");
      console.log("first.ephemeralPubKey type:", typeof first?.ephemeralPubKey);
      console.log("first.metadata type:", typeof first?.metadata);
      console.log("first.ephemeralPubKey byteLen (hex):", debugByteLenFromHex(first?.ephemeralPubKey));
      console.log("first.metadata byteLen (hex):", debugByteLenFromHex(first?.metadata));
      console.groupEnd();
    } catch (e) {
      console.warn("[opaque.debug] scanAttestationsJson JSON.parse failed", e);
    }
  }

  const coerced = coerceAnnouncementsJsonForWasm(announcementsJson);
  if (shouldDebug()) {
    try {
      const parsed = JSON.parse(coerced) as any[];
      const first = Array.isArray(parsed) ? parsed[0] : undefined;
      console.groupCollapsed("[opaque.debug] scanAttestationsJson coerced");
      console.log("coercedChanged:", coerced !== announcementsJson);
      console.log("first.ephemeralPubKey type:", typeof first?.ephemeralPubKey);
      console.log("first.metadata type:", typeof first?.metadata);
      console.log(
        "first.ephemeralPubKey byteLen (hex):",
        debugByteLenFromHex(first?.ephemeralPubKey),
      );
      console.log("first.metadata byteLen (hex):", debugByteLenFromHex(first?.metadata));
      console.log(
        "first.ephemeralPubKey prefix:",
        typeof first?.ephemeralPubKey === "string" ? first.ephemeralPubKey.slice(0, 6) : null,
      );
      console.groupEnd();
    } catch (e) {
      console.warn("[opaque.debug] scanAttestationsJson coerced JSON.parse failed", e);
    }
  }

  return wasm.scan_attestations_wasm(
    coerced,
    viewPrivkeyBytes,
    spendPubkeyBytes,
  );
}

function coerceAnnouncementsJsonForWasm(input: string): string {
  // The Rust/WASM scanner expects `ephemeralPubKey` and `metadata` as hex strings (0x...),
  // but several SDK call sites historically produced JSON with number arrays. Convert
  // array forms to hex string form for compatibility.
  try {
    const v = JSON.parse(input) as unknown;
    if (!Array.isArray(v)) return input;
    let changed = false;
    const out = v.map((row) => {
      if (!row || typeof row !== "object") return row;
      const r = row as Record<string, unknown>;
      const next: Record<string, unknown> = { ...r };

      const eph = r["ephemeralPubKey"];
      if (Array.isArray(eph)) {
        next["ephemeralPubKey"] = bytesArrayToHex(eph);
        changed = true;
      }

      const meta = r["metadata"];
      if (Array.isArray(meta)) {
        next["metadata"] = bytesArrayToHex(meta);
        changed = true;
      }

      return next;
    });
    return changed ? JSON.stringify(out) : input;
  } catch {
    return input;
  }
}

function bytesArrayToHex(value: unknown[]): string {
  let hex = "0x";
  for (let i = 0; i < value.length; i++) {
    const n = value[i];
    const b =
      typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255
        ? n
        : null;
    if (b === null) {
      // If it isn't a clean byte array, preserve original shape by returning empty hex.
      // WASM will error with a useful message.
      return "0x";
    }
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}
