// Live-gate runner: `npm run gates:g19:live`.
//
// WHY THIS EXISTS (2026-09-27):
//   The eval needed to pass MATHVIZ_LLM_* to two child processes. Setting the
//   vars in HKCU\Environment does NOT reach a `node`/`tsx` child on Windows:
//   a fresh process only inherits the parent's env block, and the registry is
//   only consulted for processes spawned via the shell/Explorer. Verified:
//   a new powershell.exe resolved the keys under scope "User" while its own
//   $env:MATHVIZ_LLM_* were empty.
//
//   So this runner reads .env itself, merges it into the child env explicitly,
//   and adds the Node flag that works around undici's IPv6 race against the
//   Aliyun token-plan host (its AAAA records are unreachable here and the
//   half-open race made fetch() die with ETIMEDOUT in ~522 ms).
//
//   Result: `npm run gates:g19:live` reaches live mode from any launch path.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// ---- 1. load .env (real process env wins) ---------------------------------
const env = { ...process.env };
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length > 1 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) val = val.slice(1, -1);
    if (key && env[key] === undefined) env[key] = val;
  }
} else {
  console.error(`[run-live] WARNING: no .env at ${envPath}; live mode will likely be unavailable.`);
}

// ---- 2. node flags: kill the IPv6 happy-eyeballs race ---------------------
const flags = ["--no-network-family-autoselection", "--network-family-autoselection-attempt-timeout=5000"];
env.NODE_OPTIONS = [env.NODE_OPTIONS, ...flags].filter(Boolean).join(" ");

// ---- 3. require real credentials before claiming live evidence ------------
const missing = ["MATHVIZ_LLM_BASE_URL", "MATHVIZ_LLM_API_KEY", "MATHVIZ_LLM_MODEL"].filter((k) => !env[k]);
if (missing.length) {
  console.error(`[run-live] FATAL: missing ${missing.join(", ")} -- refusing to run (replay is not live evidence).`);
  process.exit(2);
}
console.log(`[run-live] provider=${env.MATHVIZ_LLM_MODEL} endpoint=${env.MATHVIZ_LLM_BASE_URL}`);
console.log(`[run-live] NODE_OPTIONS=${env.NODE_OPTIONS}`);

// ---- 4. run the two gates in sequence, streaming output -------------------
const steps = [
  ["tsx", ["packages/parser/src/run-g17.ts"]],
  ["tsx", ["packages/parser-benchmark/src/run.ts", "--require-live"]],
];

for (const [cmd, args] of steps) {
  const shown = `${cmd} ${args.join(" ")}`;
  console.log(`\n[run-live] === ${shown} ===`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32", // tsx is a .cmd shim on Windows
  });
  if (res.error) {
    console.error(`[run-live] failed to launch ${shown}: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`[run-live] ${shown} exited ${res.status} -- stopping.`);
    process.exit(res.status ?? 1);
  }
}

console.log("\n[run-live] all live gates passed.");