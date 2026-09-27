// Minimal, dependency-free .env loader for the mathviz live harness.
//
// Loaded automatically by every node entry point via NODE_OPTIONS=--import
// (see package.json -> scripts.llmEnv). Exists because Windows does not
// populate a new process env from HKCU\Environment unless the process is
// spawned through the shell -- so registry-only config is invisible to
// `node`/`tsx` children (verified 2026-09-27).
//
// Rules: real process env always wins (so an operator can override a single
// value inline); this file only fills in what is missing. No expansion, no
// quoting games -- keep it boring.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "..", ".env");

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // strip one layer of matching quotes, if any
    if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}