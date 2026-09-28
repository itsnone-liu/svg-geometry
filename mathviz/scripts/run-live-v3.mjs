// P5.3 single independent live run. Reads local .env like run-live.mjs,
// enforces live credentials, and runs G17 then exactly the frozen v3 runner.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const env = { ...process.env };
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("="); if (eq < 0) continue;
    const key = line.slice(0, eq).trim(); let value = line.slice(eq + 1).trim();
    if (value.length > 1 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) value = value.slice(1, -1);
    if (key && env[key] === undefined) env[key] = value;
  }
}
const missing = ["MATHVIZ_LLM_BASE_URL", "MATHVIZ_LLM_API_KEY", "MATHVIZ_LLM_MODEL"].filter((k) => !env[k]);
if (missing.length) { console.error(`[run-live-v3] LIVE BLOCKED: missing ${missing.join(", ")}; no replay or substitute run.`); process.exit(2); }
if (env.MATHVIZ_LLM_KEY_ROTATED_AFTER_P52_EXPOSURE !== "1") { console.error("[run-live-v3] LIVE BLOCKED: secure credential is present but freshness/rotation after the exposed P5.2 key is not attested; no provider call made."); process.exit(2); }
env.NODE_OPTIONS = [env.NODE_OPTIONS, "--no-network-family-autoselection", "--network-family-autoselection-attempt-timeout=5000"].filter(Boolean).join(" ");
console.log(`[run-live-v3] provider=${env.MATHVIZ_LLM_MODEL} endpoint=${env.MATHVIZ_LLM_BASE_URL}`);
const steps = [["tsx", ["packages/parser/src/run-g17.ts"]], ["tsx", ["packages/parser-benchmark/src/run-v3.ts", "--require-live"]]];
for (const [cmd, args] of steps) {
  console.log(`\n[run-live-v3] === ${cmd} ${args.join(" ")} ===`);
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  if (res.error) { console.error(`[run-live-v3] launch failed: ${res.error.message}`); process.exit(1); }
  if (res.status !== 0) { console.error(`[run-live-v3] step exited ${res.status}; stopping without retries.`); process.exit(res.status ?? 1); }
}
console.log("[run-live-v3] G17 + the one frozen P5.3 v3 live run finished.");
