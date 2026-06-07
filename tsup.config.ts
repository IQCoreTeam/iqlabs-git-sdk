import { defineConfig } from "tsup";

// One tsup run produces three entries, each under dist/<target>/index.{js,d.ts}.
// browser.ts / node.ts re-export shared + their own platform adapters.
export default defineConfig({
  entry: {
    "shared/index":  "src/index.ts",
    "browser/index": "src/browser.ts",
    "node/index":    "src/node.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  treeshake: true,
  splitting: true,
});
