// initStealthWasm `wasmModule` option (extension Phase 0.5): a pre-imported glue module
// must be used as-is — no dynamic import() — since MV3 service workers forbid dynamic
// import and the extension background SW statically bundles the glue.
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initStealthWasm,
  resetStealthWasmCache,
  type StealthWasmEntry,
} from "@opaquecash/stealth-wasm";

const ROOT = new URL("../..", import.meta.url).pathname;
const WASM_JS = `${ROOT}app/public/pkg/cryptography.js`;
const WASM_BIN = `${ROOT}app/public/pkg/cryptography_bg.wasm`;
const wasmPresent = existsSync(WASM_JS) && existsSync(WASM_BIN);

afterEach(() => resetStealthWasmCache());

describe("initStealthWasm({ wasmModule })", () => {
  it("uses the pre-imported module and never dynamic-imports", async () => {
    const init = vi.fn(async () => stub);
    const stub = { default: init } as unknown as StealthWasmEntry;
    const mod = await initStealthWasm({
      wasmModule: stub,
      // Would throw ERR_MODULE_NOT_FOUND if the dynamic-import path ran.
      moduleSpecifier: "file:///nonexistent/cryptography.js",
      wasmBinaryUrl: "chrome-extension://abc/pkg/cryptography_bg.wasm",
    });
    expect(mod).toBe(stub);
    expect(init).toHaveBeenCalledWith({
      module_or_path: "chrome-extension://abc/pkg/cryptography_bg.wasm",
    });
  });

  it("still requires some module source", async () => {
    await expect(initStealthWasm()).rejects.toThrow(/wasmModule/);
  });

  it.skipIf(!wasmPresent)("initializes the real glue passed as a module", async () => {
    const glue = (await import(pathToFileURL(WASM_JS).href)) as StealthWasmEntry;
    const mod = await initStealthWasm({
      wasmModule: glue,
      // Node cannot fetch(file://); hand the glue the wasm bytes directly.
      wasmBinaryUrl: readFileSync(WASM_BIN) as unknown as string,
      forceReload: true,
    });
    expect(typeof mod.check_announcement_view_tag_wasm).toBe("function");
  });
});
