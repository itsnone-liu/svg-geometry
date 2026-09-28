// P5.3 single live acceptance launcher (git-blob authority).
// Phase order: offline freeze preflight (no network) -> human key-rotation
// attestation -> provider auth probe (models endpoint, zero benchmark content)
// -> deterministic G17 -> exactly ONE 72-case run from the frozen blobs.
// Any gate row that is not PASS stops this launcher BEFORE G17 / A0 / A1 /
// benchmark cases. No retries, no env-flag shortcuts for rotation evidence.
import { spawnSync } from "node:child_process";
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
const rows = [];
const row = (name, pass, detail = "") => { rows.push({ name, pass, detail }); };
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const run = (label, cmd, args) => {
  console.log(`\n[run-live-v3] === ${label} ===`);
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (res.error) { console.error(`[run-live-v3] ${label} launch failed: ${res.error.message}`); process.exit(1); }
  return res.status ?? 1;
};

// 1) Preregistration pin — read from the HEAD blob, not the worktree.
const prefix = git(["rev-parse", "--show-prefix"]).stdout.trim();
const pinSpec = `HEAD:${prefix}fixtures/parser-bench-v3/live-pin-r2.json`;
let freezeCommit = null;
{
  const p = git(["cat-file", "blob", pinSpec]);
  if (p.status !== 0) row("PREREGISTRATION_PRESENT", false, `pin blob absent at HEAD (${pinSpec})`);
  else {
    try {
      const pin = JSON.parse(p.stdout);
      freezeCommit = typeof pin.freeze_commit === "string" ? pin.freeze_commit : null;
      row("PREREGISTRATION_PRESENT", !!freezeCommit, freezeCommit ? `freeze_commit=${freezeCommit.slice(0, 12)}` : "pin has no freeze_commit");
    } catch (e) { row("PREREGISTRATION_PRESENT", false, `pin unparsable: ${e?.message ?? e}`); }
  }
}

// 2) Offline provider-free freeze preflight at the pinned commit.
if (freezeCommit) {
  const code = run("offline freeze preflight (git-blob authority)", process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "packages/parser-benchmark/src/preflight-v3.ts", "--require-prereg", "--freeze-commit", freezeCommit]);
  let table = null;
  try { table = JSON.parse(fs.readFileSync(path.join(root, "runs", "p53", "preflight-report.json"), "utf8")).table; } catch { table = null; }
  const map = { FREEZE_COMMIT_PINNED: "freeze commit resolves", DATASET_BLOB_HASH: "dataset blob", SCORING_POLICY_BLOB_HASH: "policy blob", MANIFEST_SELF_CHECK: "manifest self-check", WORKTREE_DIRTY: "clean worktree", PREREGISTRATION_PRESENT: "pin+protocol doc" };
  for (const [k, label] of Object.entries(map)) row(k, code === 0 && !!table && table[k] === true, code === 0 && table ? label : `preflight exit ${code}`);
} else {
  for (const k of ["FREEZE_COMMIT_PINNED", "DATASET_BLOB_HASH", "SCORING_POLICY_BLOB_HASH", "MANIFEST_SELF_CHECK", "WORKTREE_DIRTY"]) row(k, false, "skipped: no freeze commit pin");
}

// 3) Key rotation — ONLY the human-created attestation file is evidence.
{
  const attPath = path.join(root, "runs", "p53", "ROTATION_ATTESTATION.md");
  let pass = false, detail = "attestation file runs/p53/ROTATION_ATTESTATION.md missing";
  if (fs.existsSync(attPath)) {
    const text = fs.readFileSync(attPath, "utf8");
    const hasStatement = /^provider-side rotation completed\b/im.test(text);
    const hasDate = /^confirmed-at-utc:\s*\d{4}-\d{2}-\d{2}/im.test(text);
    pass = hasStatement && hasDate;
    detail = pass ? "human attestation present" : `statement=${hasStatement} confirmed-at-utc=${hasDate}`;
  }
  row("KEY_ROTATION_CONFIRMED", pass, `${detail} (env flags are never evidence)`);
}

// 4) Provider auth probe — models endpoint only, zero benchmark content.
{
  const code = run("provider auth probe (GET /models, no benchmark content)", process.execPath, [path.join(root, "scripts", "check-provider-auth.mjs")]);
  row("PROVIDER_AUTH", code === 0, code === 0 ? "models endpoint 2xx" : `probe exit ${code}`);
}

// 5) Verdict table — every row must be PASS.
const W = 26;
console.log("\n[run-live-v3] === LIVE GATES ===");
for (const r of rows) console.log(`${r.name.padEnd(W)} ${r.pass ? "PASS" : "FAIL"}${r.detail ? `  (${r.detail})` : ""}`);
const authorized = rows.every((r) => r.pass);
console.log(`${"LIVE AUTHORIZED".padEnd(W)} ${authorized ? "YES" : "NO"}`);
if (!authorized) { console.error("[run-live-v3] LIVE BLOCKED before G17/A0/A1/benchmark cases; fix the failing gate — no retries under this protocol."); process.exit(2); }

// 6) Deterministic G17, then exactly one 72-case run from the frozen blobs.
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
let code = run("G17 (deterministic, no provider)", process.execPath, [tsx, "packages/parser/src/run-g17.ts"]);
if (code !== 0) process.exit(code);
code = run("single 72-case v3 live acceptance (frozen blobs)", process.execPath, [tsx, "packages/parser-benchmark/src/run-v3.ts", "--require-live", "--freeze-commit", freezeCommit]);
process.exit(code);
