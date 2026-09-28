// P5.3 freeze-manifest r2 generator — GIT-BLOB AUTHORITY.
// Hashes are computed over the STAGED INDEX blobs (`git cat-file blob :<path>`)
// of the exact content Commit A will create — never over smudged worktree
// bytes. Refuses to run if authority files have unstaged worktree drift.
// Semantic dataset/scoring contents are unchanged from r1; only the
// byte-authority contract is revised.
import { FROZEN_PATHS, IDENTITY_PATHS, PROMPT_PATH, readGitBlob, sha256GitBlob, hasUnstagedChanges } from "../packages/parser-benchmark/src/git-blob";
import { manifestDigest } from "../packages/parser-benchmark/src/freeze-v3";
import { attemptCompile } from "../packages/parser/src/parse";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../packages/contracts/src/load";

const guard = [FROZEN_PATHS.dataset, FROZEN_PATHS.policy, PROMPT_PATH, ...Object.values(IDENTITY_PATHS)];
if (hasUnstagedChanges(guard)) throw new Error(`refusing: unstaged worktree drift in authority files; stage the final content first: ${guard.join(", ")}`);

const r1 = JSON.parse(readGitBlob("HEAD", FROZEN_PATHS.manifest).toString("utf8"));
const dataset = JSON.parse(readGitBlob(":", FROZEN_PATHS.dataset).toString("utf8"));
const cases: any[] = dataset.cases;
if (dataset.version !== 3 || cases.length !== 72) throw new Error("staged dataset is not v3/72");
const DOMAINS = ["geometry2d", "motion1d", "function2d"];
const CHALLENGES = ["declared-entity-completeness", "irrelevant-grounded-distractor", "expression-term-loss", "multi-finding-one-repair"];
for (const d of DOMAINS) if (cases.filter((c) => c.domain === d).length !== 24) throw new Error(`${d} != 24 cases`);
for (const k of CHALLENGES) if (cases.filter((c) => c.challengeType === k).length !== 6) throw new Error(`${k} != 6 challenges`);
if (cases.filter((c) => c.expected === "COMPILE_OK").length !== 64 || cases.filter((c) => c.expected === "ENGINE_UNSUPPORTED").length !== 6 || cases.filter((c) => c.expected === "KNOWN_LIMITATION_EXPECTED_REJECT").length !== 2) throw new Error("staged dataset status distribution != 64/6/2");

const outcomes = cases.map((c) => {
  const r = attemptCompile(JSON.parse(JSON.stringify(c.golden)), c.statement);
  const outcome = r.ok ? "accepted" : r.engineUnsupported ? "engine_unsupported" : "rejected";
  const expectedOutcome = c.expected === "COMPILE_OK" ? "accepted" : c.expected === "ENGINE_UNSUPPORTED" ? "engine_unsupported" : "rejected";
  return { id: c.id, expected: c.expected, outcome, ok: outcome === expectedOutcome };
});
const passed = outcomes.filter((o) => o.ok).length;
if (passed !== 72) throw new Error(`golden audit over staged dataset failed: ${passed}/72`);

const promptVersion = /PROMPT_POLICY_VERSION\s*=\s*["']([^"']+)["']/.exec(readGitBlob(":", PROMPT_PATH).toString("utf8"))?.[1] ?? null;

const lock: any = {
  benchmark: "mathviz-parser-benchmark/v3",
  dataset_version: 3,
  case_count: 72,
  hash_authority: "git-blob-bytes",
  dataset_sha256: sha256GitBlob(":", FROZEN_PATHS.dataset),
  scoring_policy_sha256: sha256GitBlob(":", FROZEN_PATHS.policy),
  prompt_policy_version: promptVersion,
  frozen_at_utc: r1.frozen_at_utc,
  revised_at_utc: new Date().toISOString(),
  expected_counts: { COMPILE_OK: 64, ENGINE_UNSUPPORTED: 6, KNOWN_LIMITATION_EXPECTED_REJECT: 2 },
  challenge_counts: Object.fromEntries(CHALLENGES.map((k) => [k, cases.filter((c) => c.challengeType === k).length])),
  golden_audit: { passed: 72, failed: 0, outcomes: outcomes.map(({ id, expected, outcome }) => ({ id, expected, outcome })) },
  implementation_identities: Object.fromEntries(Object.entries(IDENTITY_PATHS).map(([k, p]) => [k, sha256GitBlob(":", p)])),
  freeze_revision: "v3.1",
  manifest_revision: 2,
  freeze_reason: "r1 was blocked before provider requests because Windows smudged LF policy blobs to CRLF in the worktree; r2 moves freeze authority to committed git blob bytes (invariant to core.autocrlf/core.eol) while leaving v3 dataset/scoring semantics unchanged.",
  freeze_rule: "Any correction after this freeze requires a new benchmark version and new preregistered run. r2 revises only the byte-authority contract, not benchmark semantics.",
  manifest_sha256: "",
};
lock.manifest_sha256 = manifestDigest(lock);
const lockPath = path.join(ROOT, FROZEN_PATHS.manifest);
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ freeze_revision: lock.freeze_revision, manifest_revision: lock.manifest_revision, hash_authority: lock.hash_authority, dataset_blob_sha256: lock.dataset_sha256, scoring_policy_blob_sha256: lock.scoring_policy_sha256, manifest_self_sha256: lock.manifest_sha256, prompt_policy_version: lock.prompt_policy_version, implementation_identities: lock.implementation_identities, golden_audit: `${passed}/72`, next: "git add the manifest, then run gates:p53:freeze-preflight:staged" }, null, 2));
