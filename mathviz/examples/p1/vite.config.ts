import { defineConfig } from "vite";
import path from "node:path";

// config may be invoked from the package root (npm run build:player);
// root stays the package root so TS resolution covers packages/** normally.
const pkgRoot = path.resolve(__dirname, "..", "..");

export default defineConfig({
  root: pkgRoot,
  build: {
    outDir: path.join(pkgRoot, "examples", "p1", "dist"),
    emptyOutDir: true,
    target: "es2020",
    lib: {
      entry: path.join(pkgRoot, "examples", "p1", "player-entry.ts"),
      name: "MathVizRuntime",
      formats: ["iife"],
      fileName: () => "runtime.bundle.js"
    }
  }
});
