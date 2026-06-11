import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      // Phase 2.7 acceptance: >=80% lines on @opaquecash/opaque + the adapter surface.
      // Tests execute compiled dist; sourcemaps remap the report back to src files.
      include: [
        "packages/opaque/dist/**/*.js",
        "packages/adapter/dist/**/*.js",
        "packages/stealth-chain/dist/adapter.js",
        "packages/stealth-chain-solana/dist/adapter.js",
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});
