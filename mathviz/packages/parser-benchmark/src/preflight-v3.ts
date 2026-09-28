// Offline P5.3 benchmark v3/r2 provider-free freeze preflight. No network, no
// credentials, no model prompts. FREEZE AUTHORITY = Git blob bytes at the
// pinned freeze commit (default HEAD); `--staged` validates the index blobs
// that Commit A will create; `--require-prereg` additionally demands the
// live pin + protocol doc (live-launcher mode only).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { FROZEN_PATHS, IDENTITY_PATHS, PROMPT_PATH, PACKAGE_PATH, PIN_PATH, PROTOCOL_DOC_PATH, readGitBlob, sha256GitBlob, blobExists, resolveCommitish, worktreeClean, hasUnstagedChanges, isAncestorOfHead } from "./git-blob";
import { verifyFreezeV3, manifestDigest } from "./freeze-v3";
import { PROMPT_POLICY_VERSION } from "../../parser/src/prompt";
import { MAX_REPAIRS, attemptCompile } from "../../parser/src/parse";

const CHALLENGE_TYPES = ["declared-entity-completeness", "irrelevant-grounded-distractor", "expression-term-loss", "multi-finding-one-repair"];
const DOMAINS = ["geometry2d", "motion1d", "function2d"];
const CATEGORY_QUOTAS: Record<string, number> = { straightforward: 8, wording: 4, irrelevant: 4, compositional: 4, unsupported: 2, harder_repair: 2 };
const AUTHORITY_GUARD = [FROZEN_PATHS.dataset, FROZEN_PATHS.policy, PROMPT_PATH, ...Object.values(IDENTITY_PATHS)];

export interface PreflightOptions {
  rev?: string;
  staged?: boolean;
  requirePrereg?: boolean;
  reportFile?: string;
}

interface Check { pass: boolean; required: boolean; detail?: string }

export function runPreflightV3(options: PreflightOptions = {}): any {
  const staged = options.staged === true;
  const rev = staged ? ":" : options.rev && options.rev !== "" ? options.rev : "HEAD";
  const requirePrereg = options.requirePrereg === true;
  const commit = resolveCommitish(rev === ":" ? "HEAD" : rev);
  const lock = JSON.parse(readGitBlob(rev, FROZEN_PATHS.manifest).toString("utf8"));
  const dataset = JSON.parse(readGitBlob(rev, FROZEN_PATHS.dataset).toString("utf8"));
  const policyText = readGitBlob(rev, FROZEN_PATHS.policy).toString("utf8");
  const cases = dataset.cases as any[];
  const pkg = JSON.parse(readGitBlob(rev, PACKAGE_PATH).toString("utf8"));
  const promptBlob = readGitBlob(rev, PROMPT_PATH).toString("utf8");
  const blobPromptVersion = /PROMPT_POLICY_VERSION\s*=\s*["']([^"']+)["']/.exec(promptBlob)?.[1] ?? null;
  const blobMaxRepairs = Number(/export\s+const\s+MAX_REPAIRS\s*=\s*(\d+)\s*;/.exec(readGitBlob(rev, IDENTITY_PATHS.pipeline_sha256).toString("utf8"))?.[1] ?? NaN);

  const counts = {
    domains: Object.fromEntries(DOMAINS.map((d) => [d, cases.filter((c) => c.domain === d).length])),
    challenges: Object.fromEntries(CHALLENGE_TYPES.map((t) => [t, cases.filter((c) => c.challengeType === t).length])),
    statuses: {
      COMPILE_OK: cases.filter((c) => c.expected === "COMPILE_OK").length,
      ENGINE_UNSUPPORTED: cases.filter((c) => c.expected === "ENGINE_UNSUPPORTED").length,
      KNOWN_LIMITATION_EXPECTED_REJECT: cases.filter((c) => c.expected === "KNOWN_LIMITATION_EXPECTED_REJECT").length,
    },
  };
  const goldenAuditPass = cases.length === 72 && cases.every((c: any) => {
    const r = attemptCompile(JSON.parse(JSON.stringify(c.golden)), c.statement);
    return c.expected === "COMPILE_OK" ? r.ok : c.expected === "ENGINE_UNSUPPORTED" ? !r.ok && r.engineUnsupported : c.expected === "KNOWN_LIMITATION_EXPECTED_REJECT" ? !r.ok && !r.engineUnsupported && r.errors.some((e: any) => e.code === "E_PROVENANCE_GROUNDING") : false;
  });
  const identityBlobHashes = Object.fromEntries(Object.entries(IDENTITY_PATHS).map(([k, p]) => [k, sha256GitBlob(rev, p)]));
  const rawBlobHashes = { dataset: sha256GitBlob(rev, FROZEN_PATHS.dataset), policy: sha256GitBlob(rev, FROZEN_PATHS.policy), manifest: sha256GitBlob(rev, FROZEN_PATHS.manifest) };
  const dirty = !worktreeClean();

  let prereg: { present: boolean; freezeCommit: string | null; ancestorsOk: boolean; hashesOk: boolean; docOk: boolean; detail: string };
  {
    const pinPresent = blobExists("HEAD", PIN_PATH);
    let pin: any = null;
    if (pinPresent) { try { pin = JSON.parse(readGitBlob("HEAD", PIN_PATH).toString("utf8")); } catch { pin = null; } }
    const freezeCommit = pin?.freeze_commit ? resolveCommitish(String(pin.freeze_commit)) : null;
    const ancestorsOk = !!(freezeCommit && isAncestorOfHead(freezeCommit));
    const hashesOk = !!(pin && pin.dataset_blob_sha256 === lock.dataset_sha256 && pin.scoring_policy_blob_sha256 === lock.scoring_policy_sha256);
    const docOk = blobExists("HEAD", PROTOCOL_DOC_PATH);
    prereg = { present: !!(pin && freezeCommit && ancestorsOk && hashesOk && docOk), freezeCommit, ancestorsOk, hashesOk, docOk, detail: pinPresent ? `pin@HEAD freeze_commit=${pin?.freeze_commit ?? "invalid"} ancestor=${ancestorsOk} hashes=${hashesOk} protocol_doc=${docOk}` : "pin absent at HEAD" };
  }

  const C: Record<string, Check> = {
    freeze_commit_pinned: { pass: !!commit, required: true, detail: staged ? `index blobs at ${rev} (pre-Commit-A)` : `rev ${rev} -> ${commit}` },
    dataset_blob_hash: { pass: rawBlobHashes.dataset === lock.dataset_sha256, required: true, detail: rawBlobHashes.dataset },
    scoring_policy_blob_hash: { pass: rawBlobHashes.policy === lock.scoring_policy_sha256, required: true, detail: rawBlobHashes.policy },
    manifest_self_check: { pass: lock.manifest_sha256 === manifestDigest(lock), required: true, detail: lock.manifest_sha256 },
    worktree_dirty: { pass: staged ? true : !dirty, required: !staged, detail: staged ? "not applicable pre-commit (staged mode)" : dirty ? "worktree has uncommitted changes" : "clean" },
    preregistration_present: { pass: prereg.present, required: requirePrereg, detail: prereg.detail },
    dataset_v3_72: { pass: dataset.version === 3 && cases.length === 72 && lock.dataset_version === 3 && lock.case_count === 72, required: true },
    case_schema: { pass: cases.every((c) => c && typeof c.id === "string" && typeof c.domain === "string" && typeof c.category === "string" && typeof c.statement === "string" && typeof c.expected === "string" && c.golden && typeof c.golden === "object"), required: true },
    unique_case_ids: { pass: new Set(cases.map((c) => c.id)).size === 72, required: true },
    domains_24_each: { pass: Object.values(counts.domains).every((n) => n === 24), required: true, detail: counts.domains },
    category_quotas: { pass: DOMAINS.every((d) => Object.entries(CATEGORY_QUOTAS).every(([cat, n]) => cases.filter((c) => c.domain === d && c.category === cat).length === n)), required: true },
    unique_challenge_tags_six_each: { pass: CHALLENGE_TYPES.every((t) => counts.challenges[t] === 6) && JSON.stringify(lock.challenge_counts) === JSON.stringify(counts.challenges), required: true, detail: counts.challenges },
    expected_status_64_6_2: { pass: counts.statuses.COMPILE_OK === 64 && counts.statuses.ENGINE_UNSUPPORTED === 6 && counts.statuses.KNOWN_LIMITATION_EXPECTED_REJECT === 2, required: true, detail: counts.statuses },
    manifest_expected_outcomes: { pass: lock.expected_counts?.COMPILE_OK === 64 && lock.expected_counts?.ENGINE_UNSUPPORTED === 6 && lock.expected_counts?.KNOWN_LIMITATION_EXPECTED_REJECT === 2, required: true },
    prompt_policy_version: { pass: blobPromptVersion === "p5.3-policy-v1" && lock.prompt_policy_version === blobPromptVersion && PROMPT_POLICY_VERSION === blobPromptVersion, required: true, detail: blobPromptVersion },
    g19_g20_pipeline_identity: { pass: JSON.stringify(identityBlobHashes) === JSON.stringify(lock.implementation_identities), required: true, detail: identityBlobHashes },
    max_repairs_one: { pass: blobMaxRepairs === 1 && MAX_REPAIRS === 1, required: true, detail: `${blobMaxRepairs} (blob) / ${MAX_REPAIRS} (module)` },
    golden_audit_72_pass: { pass: lock.golden_audit?.passed === 72 && lock.golden_audit?.failed === 0 && goldenAuditPass, required: true },
    scoring_thresholds_unchanged: { pass: ["≥ 98%", "≥ 95%", "≥ 90%", "≥ 98.5%", "exactly 0"].every((x) => policyText.includes(x)), required: true },
    staged_worktree_matches_index: { pass: staged ? !hasUnstagedChanges(AUTHORITY_GUARD) : true, required: staged, detail: staged ? "authority files staged and worktree-identical" : "not applicable" },
    preflight_scripts_defined: {
      pass: pkg.scripts?.["gates:p53:freeze-preflight"] === "tsx packages/parser-benchmark/src/preflight-v3.ts" && pkg.scripts?.["gates:p53:freeze-preflight:staged"] === "tsx packages/parser-benchmark/src/preflight-v3.ts --staged" && pkg.scripts?.["p53:provider-auth-check"] === "node scripts/check-provider-auth.mjs",
      required: true,
    },
  };

  const requiredPass = Object.values(C).filter((c) => c.required).every((c) => c.pass);
  const report: any = {
    gate: "P5.3_FREEZE_PREFLIGHT", mode: "offline/no-provider", authority: "git-blob-bytes",
    staged_mode: staged, require_prereg: requirePrereg, rev, freeze_commit: commit ?? null,
    raw_blob_hashes: rawBlobHashes, counts, prompt_policy_version: blobPromptVersion,
    implementation_identities: identityBlobHashes, max_repairs: MAX_REPAIRS,
    table: {
      FREEZE_COMMIT_PINNED: C.freeze_commit_pinned.pass,
      DATASET_BLOB_HASH: C.dataset_blob_hash.pass,
      SCORING_POLICY_BLOB_HASH: C.scoring_policy_blob_hash.pass,
      MANIFEST_SELF_CHECK: C.manifest_self_check.pass,
      WORKTREE_DIRTY: C.worktree_dirty.pass,
      PREREGISTRATION_PRESENT: prereg.present,
    },
    checks: Object.fromEntries(Object.entries(C).map(([k, v]) => [k, { pass: v.pass, required: v.required, detail: v.detail }])),
    advisory: {
      v2_freeze_surface: (() => { try { require("./freeze").verifyFreeze(); return true; } catch { return false; } })(),
      worktree_lf_only: [FROZEN_PATHS.dataset, FROZEN_PATHS.policy, FROZEN_PATHS.manifest].every((p) => !fs.readFileSync(path.join(ROOT, p)).includes(Buffer.from("\r\n"))),
    },
    result: requiredPass ? "PASS" : "FAIL",
  };
  const reportFile = options.reportFile ?? path.join(ROOT, "runs", "p53", staged ? "preflight-report-staged.json" : "preflight-report.json");
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.error(`report: ${path.relative(ROOT, reportFile)}`);
  return report;
}

if (require.main === module) {
  try {
    const argv = process.argv;
    const idx = argv.indexOf("--freeze-commit");
    const reportIdx = argv.indexOf("--report-file");
    const report = runPreflightV3({
      staged: argv.includes("--staged"),
      requirePrereg: argv.includes("--require-prereg"),
      rev: idx >= 0 ? argv[idx + 1] : undefined,
      reportFile: reportIdx >= 0 ? argv[reportIdx + 1] : undefined,
    });
    if (report.result !== "PASS") process.exitCode = 1;
  } catch (e: any) {
    console.error(`P5.3 FREEZE PREFLIGHT FAIL: ${e?.message ?? e}`);
    process.exitCode = 1;
  }
}
