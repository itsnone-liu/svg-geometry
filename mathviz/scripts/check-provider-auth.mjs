// P5.3 provider AUTH PROBE — the ONLY provider call allowed before the single
// authorized live run. GET {MATHVIZ_LLM_BASE_URL}/models with the injected key:
// sends zero benchmark statements/prompts, never prints the key, one attempt,
// no retries. Exit 0 only on HTTP 2xx.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const base = env.MATHVIZ_LLM_BASE_URL, key = env.MATHVIZ_LLM_API_KEY, model = env.MATHVIZ_LLM_MODEL;
if (!base || !key || !model) { console.error("PROVIDER_AUTH FAIL: MATHVIZ_LLM_BASE_URL / MATHVIZ_LLM_API_KEY / MATHVIZ_LLM_MODEL not all set"); process.exit(2); }
const url = `${base.replace(/\/+$/, "")}/models`;
try {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  let listed = null;
  try { const body = await res.json(); const ids = (body?.data ?? body?.models ?? []).map((m) => m?.id).filter(Boolean); listed = ids.includes(model); } catch { listed = null; }
  const ok = res.status >= 200 && res.status < 300;
  console.log(`PROVIDER_AUTH ${ok ? "PASS" : "FAIL"} http=${res.status} endpoint=${base.replace(/\/+$/, "")} model=${model} listed=${listed === null ? "unknown" : listed ? "yes" : "no"} benchmark_content_sent=0`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error(`PROVIDER_AUTH FAIL: ${e?.message ?? e} (benchmark_content_sent=0)`);
  process.exit(1);
}
