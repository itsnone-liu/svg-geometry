// P5.3 v4 single live acceptance launcher (git-blob authority).
// Phase order: offline prereg preflight (13 checks, no network) -> single-run
// authority lock -> explicit credential policy/risk acknowledgement
// (DISPOSABLE_ACCEPTED) -> provider auth probe (models endpoint, zero benchmark
// content) -> deterministic G17 -> exactly ONE 72-case v4 live run from the
// frozen blobs. Any gate row that is not PASS stops this launcher BEFORE G17 /
// A1 / benchmark cases. No retries, no env-flag shortcuts for credential
// evidence. The first benchmark A1 request consumes the single authorization.
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
const row = (name, pass, detail = "") => rows.push({ name, pass, detail });
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const run = (label, cmd, args) => {
  console.log(`\n[run-live-v4] === ${label} ===`);
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (res.error) { console.error(`[run-live-v4] ${label} launch failed: ${res.error.message}`); process.exit(1); }
  return res.status ?? 1;
};

// 1) Preregistration pin — read from the HEAD blob, not the worktree.
const prefix = git(["rev-parse", "--show-prefix"]).stdout.trim();
const pinSpec = `HEAD:${prefix}fixtures/parser-bench-v4/live-pin-v4.json`;
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

// 2) Offline prereg freeze preflight at HEAD (13 checks; hashes anchored to the
//    freeze commit; zero provider requests).
if (freezeCommit) {
  const code = run("offline prereg preflight (git-blob authority)", process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "packages/parser-benchmark/src/preflight-v4.ts", "--require-prereg"]);
  let table = null;
  try { table = JSON.parse(fs.readFileSync(path.join(root, "runs", "p53", "preflight-v4-report.json"), "utf8")).table; } catch { table = null; }
  const need = ["MANIFEST_STRUCTURE_VALID", "DENOMINATORS_72_64_6_2", "GOAL_CAPABILITY_70", "DUAL_SPLIT_15_11_2_2", "BARE_CONTROLS_9", "DECLARATION_AUDIT_72_72", "GOLDEN_SCORER_15_15", "TSC_PASS", "VITEST_PASS", "V3_REPLAY_UNCHANGED", "BLOB_IDENTITIES_MATCH", "ZERO_PROVIDER_REQUESTS", "PREREGISTRATION_PRESENT"];
  for (const k of need) row(k, code === 0 && !!table && table[k] === true, code === 0 && table ? "preflight ok" : `preflight exit ${code}`);
} else {
  for (const k of ["MANIFEST_STRUCTURE_VALID", "DENOMINATORS_72_64_6_2", "GOAL_CAPABILITY_70", "DUAL_SPLIT_15_11_2_2", "BARE_CONTROLS_9", "DECLARATION_AUDIT_72_72", "GOLDEN_SCORER_15_15", "TSC_PASS", "VITEST_PASS", "V3_REPLAY_UNCHANGED", "BLOB_IDENTITIES_MATCH", "ZERO_PROVIDER_REQUESTS", "PREREGISTRATION_PRESENT"]) row(k, false, "skipped: no freeze commit from pin");
}

// 3) Single-run authority: the v4 live result report and the consumption
//    marker must both be absent, otherwise the one authorization is gone.
const reportPath = path.join(root, "docs", "P5_3_V4_LIVE_RESULT.md");
const markerPath = path.join(root, "runs", "p53", "v4-live-consumed.json");
const alreadyConsumed = fs.existsSync(reportPath) || fs.existsSync(markerPath);
row("SINGLE_RUN_AUTHORITY", !alreadyConsumed, alreadyConsumed ? "live already consumed (report or marker present); a second batch is FORBIDDEN" : "no prior v4 live report/marker");

// 4) Credential policy/risk acknowledgement (gitignored attestation; env
//    flags are never evidence).
let credentialOk = false;
try {
  const { evaluateCredentialGate } = await import("./credential-policy.mjs");
  const g = evaluateCredentialGate({
    policyText: fs.readFileSync(path.join(root, "runs", "p53", "CREDENTIAL_POLICY_ACK.md"), "utf8"),
    rotationText: fs.existsSync(path.join(root, "runs", "p53", "ROTATION_ACK.md")) ? fs.readFileSync(path.join(root, "runs", "p53", "ROTATION_ACK.md"), "utf8") : "",
    env,
  });
  credentialOk = g.authorizedBeforeProvider;
  row("CREDENTIAL_POLICY", g.authorizedBeforeProvider, `${g.details.policy} riskAck=${g.details.riskAck} credentialPresent=${g.details.credentialPresent}`);
} catch (e) { row("CREDENTIAL_POLICY", false, e?.message ?? String(e)); }

// 5) Provider auth probe (single GET /models, zero benchmark content) — only
//    after the credential gate passed.
if (credentialOk) {
  const code = run("provider auth probe (models endpoint only)", process.execPath, [path.join(root, "scripts", "check-provider-auth.mjs")]);
  row("PROVIDER_AUTH", code === 0, code === 0 ? "GET /models 2xx" : `probe exit ${code}`);
} else row("PROVIDER_AUTH", false, "skipped: credential gate failed");

const W = 26;
console.log(`\n[run-live-v4] === ${"GATE TABLE"} ===`);
for (const r of rows) console.log(`${r.name.padEnd(W)} ${r.pass ? "PASS" : "FAIL"}${r.detail ? `  (${r.detail})` : ""}`);
const authorized = rows.every((r) => r.pass);
console.log(`${"LIVE AUTHORIZED".padEnd(W)} ${authorized ? "YES" : "NO"}`);
if (!authorized) { console.error("[run-live-v4] LIVE BLOCKED before G17/A1/benchmark cases; fix the failing gate — no retries under this protocol."); process.exit(2); }

// 6) Deterministic G17, then exactly one 72-case v4 live run from the frozen blobs.
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
let code = run("G17 (deterministic, no provider)", process.execPath, [tsx, "packages/parser/src/run-g17.ts"]);
if (code !== 0) process.exit(code);
code = run("single 72-case v4 live acceptance (frozen blobs)", process.execPath, [tsx, "packages/parser-benchmark/src/run-v4-live.ts", "--require-live", "--freeze-commit", freezeCommit]);
process.exit(code);
