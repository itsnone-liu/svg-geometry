import { defineConfig } from "vite";
import path from "node:path";

const here = __dirname; // examples/p2
const pkgRoot = path.resolve(here, "..", "..");

export default defineConfig({
  root: pkgRoot,
  build: {
    outDir: path.join(here, "dist"),
    emptyOutDir: true,
    target: "es2020",
    lib: {
      entry: path.join(here, "player-entry.ts"),
      name: "MathVizRuntime",
      formats: ["iife"],
      fileName: () => "runtime.bundle.js"
    }
  }
});
