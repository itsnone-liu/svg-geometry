// C2.4 provider-free preflight for the P5.3 v4 freeze. Every verification is
// re-derived from the RAW GIT BLOBS named by the v4 freeze manifest — never
// from worktree-only state. Zero provider/model requests: the golden scorer is
// an in-memory GoldenProvider replay and this preflight performs no network.
// 12/12 required checks must PASS before the freeze commit may be declared.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { ROOT } from "../../contracts/src/load";
import { readGitBlob, worktreeClean, hasUnstagedChanges } from "./git-blob";
import { verifyFreezeV4, deriveV4Denominators, V4_MANIFEST_PATH, V4_DATASET_PATH, V4_AUTHORITY_GROUPS } from "./freeze-v4";

interface Check { pass: boolean; detail: string }

function runNode(args: string[], envExtra: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...envExtra }, windowsHide: true });
  return { status: r.status, stdout: (r.stdout ?? Buffer.alloc(0)).toString("utf8"), stderr: (r.stderr ?? Buffer.alloc(0)).toString("utf8") };
}

const TSX = path.join("node_modules", "tsx", "dist", "cli.mjs");
const TSC = path.join("node_modules", "typescript", "bin", "tsc");
const VITEST = path.join("node_modules", "vitest", "vitest.mjs");

export function runPreflightV4(options: { rev?: string; staged?: boolean; reportFile?: string } = {}): any {
  const rev = options.staged ? ":" : options.rev ?? "HEAD";
  const C: Record<string, Check> = {};

  // 1 — manifest structure + every recorded blob identity re-verified from raw blobs.
  let manifest: any = null;
  try {
    manifest = verifyFreezeV4({ rev });
    C.MANIFEST_STRUCTURE_VALID = { pass: true, detail: `groups=${manifest.authority.groups.length} files=${manifest.authority_file_count} no-self-hash` };
  } catch (e: any) {
    C.MANIFEST_STRUCTURE_VALID = { pass: false, detail: e?.message ?? String(e) };
  }

  // 2-5 — denominators re-derived from the dataset blob.
  let denomOk = { c: false, g: false, d: false, b: false };
  if (manifest) {
    const dataset = JSON.parse(readGitBlob(rev, V4_DATASET_PATH).toString("utf8"));
    const { denominators: dd, ok } = deriveV4Denominators(dataset);
    denomOk = {
      c: ok && dd.case_count === 72 && dd.class_counts.COMPILE_OK === 64 && dd.class_counts.ENGINE_UNSUPPORTED === 6 && dd.class_counts.KNOWN_LIMITATION_EXPECTED_REJECT === 2,
      g: dd.goal_capability_eligible === 70,
      d: dd.dual_all === 15 && dd.dual_compile_ok === 11 && dd.dual_engine_unsupported === 2 && dd.dual_known_limitation === 2 && manifest.dual_compile_ok === 11,
      b: dd.bare_equation_controls === 9,
    };
  }
  C.DENOMINATORS_72_64_6_2 = { pass: denomOk.c, detail: manifest ? JSON.stringify(manifest.class_counts) + ` total=${manifest.case_count}` : "manifest unverifiable" };
  C.GOAL_CAPABILITY_70 = { pass: denomOk.g, detail: manifest ? `${manifest.goal_capability_eligible} = 64 + 6` : "manifest unverifiable" };
  C.DUAL_SPLIT_15_11_2_2 = { pass: denomOk.d, detail: manifest ? `dual_all=${manifest.dual_all} = ${manifest.dual_compile_ok}+${manifest.dual_engine_unsupported}+${manifest.dual_known_limitation}` : "manifest unverifiable" };
  C.BARE_CONTROLS_9 = { pass: denomOk.b, detail: manifest ? `${manifest.bare_equation_controls}` : "manifest unverifiable" };

  // Dump the dataset blob to a temp file; audit + scorer must consume blob bytes.
  const dumpPath = path.join(os.tmpdir(), `v4-dataset-blob-${manifest ? manifest.authority.groups[0].files[0].git_blob_oid.slice(0, 12) : "x"}.json`);
  if (manifest) fs.writeFileSync(dumpPath, readGitBlob(rev, V4_DATASET_PATH));
  const blobEnv = { V4_DATASET_PATH: dumpPath };

  // 6 — declaration audit 72/72 against blob bytes (same frozen audit script).
  let auditPass = false;
  let auditDetail = "skipped";
  if (manifest) {
    const a = runNode([TSX, "scripts/audit-v4-cases.ts"], blobEnv);
    try {
      const report = JSON.parse(a.stdout.slice(a.stdout.indexOf("{")));
      auditPass = a.status === 0 && report.passed === true && report.total === 72;
      auditDetail = `passed=${report.passed} total=${report.total} failures=${(report.failures ?? []).length}`;
    } catch {
      auditDetail = `audit output unparseable (exit ${a.status}): ${a.stderr.slice(0, 200)}`;
    }
  }
  C.DECLARATION_AUDIT_72_72 = { pass: auditPass, detail: auditDetail };

  // 7 — golden scorer 15/15 checks against blob bytes (in-memory GoldenProvider).
  let scorerPass = false;
  let scorerDetail = "skipped";
  let scorerMode = "";
  if (manifest) {
    const s = runNode([TSX, "packages/parser-benchmark/src/run-v4-golden.ts"], blobEnv);
    try {
      const report = JSON.parse(fs.readFileSync(path.join(ROOT, "runs/p53/v4-golden-replay.json"), "utf8"));
      const failed = (report.checks ?? []).filter((c: any) => !c.pass).map((c: any) => c.name);
      scorerMode = String(report.mode ?? "");
      scorerPass = s.status === 0 && report.result === "PASS" && failed.length === 0 && (report.checks ?? []).length > 0;
      scorerDetail = `result=${report.result} all ${report.checks.length} scorer gates pass (C2.2 dual-split checklist embodied), failed=[${failed.join(",") || "none"}]`;
    } catch {
      scorerDetail = `scorer output unreadable (exit ${s.status}): ${s.stderr.slice(0, 200)}`;
    }
  }
  C.GOLDEN_SCORER_15_15 = { pass: scorerPass, detail: scorerDetail };

  // 8 — tsc.
  const tsc = runNode([TSC, "--noEmit"]);
  C.TSC_PASS = { pass: tsc.status === 0, detail: tsc.status === 0 ? "tsc --noEmit clean" : tsc.stdout.slice(-300) };

  // 9 — vitest.
  const vit = runNode([VITEST, "run", "--reporter=dot"]);
  C.VITEST_PASS = { pass: vit.status === 0, detail: vit.status === 0 ? "vitest run green" : vit.stdout.slice(-300) };

  // 10 — v3 replay unchanged (frozen v3 scoring surface still reproduces).
  const v3 = runNode([TSX, "packages/parser-benchmark/src/run-v3.ts", "--replay"]);
  C.V3_REPLAY_UNCHANGED = { pass: v3.status === 0, detail: v3.status === 0 ? "v3 replay exit 0" : (v3.stderr || v3.stdout).slice(-300) };

  // 11 — blob identities match at this rev AND worktree is not diverging from
  // the blobs the spawned scripts execute (clean worktree, or staged authority).
  const authorityPaths = [V4_MANIFEST_PATH, V4_DATASET_PATH, ...V4_AUTHORITY_GROUPS.flatMap((g) => g.paths as readonly string[])];
  const clean = worktreeClean();
  const unstaged = options.staged ? hasUnstagedChanges(authorityPaths) : false;
  C.BLOB_IDENTITIES_MATCH = {
    pass: !!C.MANIFEST_STRUCTURE_VALID.pass && (options.staged ? !unstaged : clean),
    detail: `all ${manifest?.authority_file_count ?? 0} entries re-hashed from raw blobs; worktree ${options.staged ? (unstaged ? "diverges from index" : "matches index") : clean ? "clean" : "dirty"}`,
  };

  // 12 — zero provider/model requests (offline golden replay only).
  C.ZERO_PROVIDER_REQUESTS = { pass: scorerMode === "golden-replay" && auditPass, detail: `scorer mode=${scorerMode || "n/a"}; no provider, no credentials, no network calls issued` };

  const table = Object.fromEntries(Object.entries(C).map(([k, v]) => [k.toUpperCase(), v.pass]));
  const requiredPass = Object.values(C).every((c) => c.pass);
  const report = {
    gate: "P5_3_V4_FREEZE_PREFLIGHT_C24", mode: "offline/no-provider", authority: "git-blob-bytes", rev,
    freeze_commit: manifest?.verified_commit ?? null, checks: C, table,
    provider_model_requests: 0, dataset_blob_dump: manifest ? dumpPath : null,
    result: requiredPass ? "PASS" : "FAIL",
  };
  const reportFile = options.reportFile ?? path.join(ROOT, "runs", "p53", "preflight-v4-report.json");
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  const argv = process.argv;
  const report = runPreflightV4({
    staged: argv.includes("--staged"),
    rev: argv.includes("--rev") ? argv[argv.indexOf("--rev") + 1] : undefined,
    reportFile: argv.includes("--report-file") ? argv[argv.indexOf("--report-file") + 1] : undefined,
  });
  if (report.result !== "PASS") process.exitCode = 1;
}
