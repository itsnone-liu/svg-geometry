import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    lib: { entry: path.resolve(__dirname, "player-entry.ts"), name: "MathVizRuntime", formats: ["iife"], fileName: () => "runtime.bundle.js" }
  }
});
