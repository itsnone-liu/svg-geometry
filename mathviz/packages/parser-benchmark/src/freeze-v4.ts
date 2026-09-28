// P5.3 benchmark v4 freeze manifest generator/verifier (C2.3).
// FREEZE AUTHORITY = COMMITTED GIT BLOB BYTES (`git cat-file blob <rev>:<path>`).
// The v4 manifest deliberately carries NO self-hash field: its outer identity is
// the freeze commit that carries it (freeze commit + manifest at that commit +
// raw Git blobs referenced by the manifest).
// scripts/generate-v4-fixtures.mjs is CONSTRUCTION PROVENANCE, not authority;
// runs/p53/* artifacts are EVIDENCE, not authority. Live runs never regenerate
// the dataset: generator -> cases.json (FROZEN AUTHORITY) -> audit/scorer.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { readGitBlob, sha256GitBlob, gitText, blobSpec, resolveCommitish, isAncestorOfHead } from "./git-blob";

export const V4_MANIFEST_PATH = "fixtures/parser-bench-v4/freeze-v4.json";
export const V4_DATASET_PATH = "fixtures/parser-bench-v4/cases.json";
/** Base prompt policy version carrier (v4 prompt = this frozen base + the v4 overlay below). */
export const V4_PROMPT_BASE_PATH = "packages/parser/src/prompt.ts";
export const V4_PROMPT_OVERLAY_PATH = "packages/parser/src/prompt-v4.ts";

export const V4_AUTHORITY_GROUPS = [
  { group: "DATA", paths: [V4_DATASET_PATH] },
  { group: "POLICY", paths: ["docs/P5_3_V4_SCORING_POLICY.md"] },
  { group: "SCORER", paths: ["packages/parser-benchmark/src/run-v4-golden.ts", "packages/parser-benchmark/src/normalize-spec.ts", "packages/parser-benchmark/src/grounding.ts"] },
  { group: "V4_PARSER", paths: ["packages/parser/src/parse-v4.ts", V4_PROMPT_OVERLAY_PATH, "packages/parser/src/function-zero-duality.ts", "packages/parser/src/fidelity.ts", "packages/parser/src/grounding.ts"] },
  { group: "DETERMINISTIC_KERNEL", paths: ["packages/spec/src/compile.ts", "packages/contracts/src/spec-validate.ts"] },
  { group: "AUDIT", paths: ["scripts/audit-v4-cases.ts"] },
] as const;

export function gitBlobOid(rev: string, relPath: string): string {
  return gitText(["rev-parse", blobSpec(rev, relPath)]).trim();
}

export interface V4Denominators {
  case_count: number;
  class_counts: { COMPILE_OK: number; ENGINE_UNSUPPORTED: number; KNOWN_LIMITATION_EXPECTED_REJECT: number };
  goal_capability_eligible: number;
  dual_all: number;
  dual_compile_ok: number;
  dual_engine_unsupported: number;
  dual_known_limitation: number;
  bare_equation_controls: number;
}

/** Denominator contract is DERIVED from the dataset blob, never hand-copied. */
export function deriveV4Denominators(dataset: any): { denominators: V4Denominators; ok: boolean } {
  const cases = dataset.cases as any[];
  const isDual = (c: any) => c.domain === "function2d" && !!c.golden?.entities?.some((e: any) => e.kind === "function");
  const classOf = (k: string) => cases.filter((c) => c.expected_class === k).length;
  const denominators: V4Denominators = {
    case_count: cases.length,
    class_counts: {
      COMPILE_OK: classOf("COMPILE_OK"),
      ENGINE_UNSUPPORTED: classOf("ENGINE_UNSUPPORTED"),
      KNOWN_LIMITATION_EXPECTED_REJECT: classOf("KNOWN_LIMITATION_EXPECTED_REJECT"),
    },
    goal_capability_eligible: classOf("COMPILE_OK") + classOf("ENGINE_UNSUPPORTED"),
    dual_all: cases.filter(isDual).length,
    dual_compile_ok: cases.filter((c) => isDual(c) && c.expected_class === "COMPILE_OK").length,
    dual_engine_unsupported: cases.filter((c) => isDual(c) && c.expected_class === "ENGINE_UNSUPPORTED").length,
    dual_known_limitation: cases.filter((c) => isDual(c) && c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length,
    bare_equation_controls: cases.filter((c) => c.domain === "function2d" && !c.golden?.entities?.some((e: any) => e.kind === "function")).length,
  };
  const d: any = denominators;
  const ok = dataset.version === 4
    && d.case_count === 72
    && d.class_counts.COMPILE_OK === 64 && d.class_counts.ENGINE_UNSUPPORTED === 6 && d.class_counts.KNOWN_LIMITATION_EXPECTED_REJECT === 2
    && d.goal_capability_eligible === 70
    && d.dual_all === 15 && d.dual_compile_ok === 11 && d.dual_engine_unsupported === 2 && d.dual_known_limitation === 2
    && d.dual_compile_ok + d.dual_engine_unsupported + d.dual_known_limitation === d.dual_all
    && d.bare_equation_controls === 9;
  return { denominators, ok };
}

export function promptPolicyVersionFromBlob(rev: string): string | null {
  const text = readGitBlob(rev, V4_PROMPT_BASE_PATH).toString("utf8");
  return /PROMPT_POLICY_VERSION\s*=\s*["']([^"']+)["']/.exec(text)?.[1] ?? null;
}

function entryFor(rev: string, rel: string) {
  const bytes = readGitBlob(rev, rel);
  return { path: rel, git_blob_oid: gitBlobOid(rev, rel), sha256_raw_blob_bytes: sha256GitBlob(rev, rel), byte_size: bytes.length };
}

export function buildV4Manifest(rev: string): any {
  const dataset = JSON.parse(readGitBlob(rev, V4_DATASET_PATH).toString("utf8"));
  const { denominators, ok } = deriveV4Denominators(dataset);
  if (!ok) throw new Error(`v4 denominators do not match the frozen contract: ${JSON.stringify(denominators)}`);
  const promptVersion = promptPolicyVersionFromBlob(rev);
  if (promptVersion !== "p5.3-policy-v1") throw new Error(`unexpected base prompt policy version in blob: ${promptVersion}`);
  return {
    benchmark: "mathviz-p53-parser-benchmark",
    benchmark_version: 4,
    hash_authority: "git-blob-bytes",
    generated_from_commit: resolveCommitish(rev === ":" ? "HEAD" : rev),
    generated_at_utc: new Date().toISOString(),
    ...denominators,
    prompt_policy_version: promptVersion,
    prompt_policy_base_path: V4_PROMPT_BASE_PATH,
    prompt_v4_overlay_path: V4_PROMPT_OVERLAY_PATH,
    max_repairs: 1,
    authority: { groups: V4_AUTHORITY_GROUPS.map((g) => ({ group: g.group, files: g.paths.map((p) => entryFor(rev, p)) })) },
    construction_provenance_not_authority: {
      paths: ["scripts/generate-v4-fixtures.mjs"],
      note: "generator -> cases.json (FROZEN AUTHORITY) -> audit/scorer; live never regenerates the dataset",
    },
    evidence_not_authority: { paths: ["runs/p53/v4-c1-audit.json", "runs/p53/v4-golden-replay.json"] },
  };
}

export function verifyFreezeV4(options: { rev?: string } = {}): any {
  const rev = options.rev ?? "HEAD";
  const commit = resolveCommitish(rev === ":" ? "HEAD" : rev);
  const manifest = JSON.parse(readGitBlob(rev, V4_MANIFEST_PATH).toString("utf8"));
  if (manifest.benchmark !== "mathviz-p53-parser-benchmark" || manifest.benchmark_version !== 4 || manifest.hash_authority !== "git-blob-bytes") {
    throw new Error("v4 freeze manifest is not in git-blob-bytes authority form");
  }
  if ("manifest_sha256" in manifest) throw new Error("v4 manifest must NOT self-hash; its outer identity is the freeze commit");
  const dataset = JSON.parse(readGitBlob(rev, V4_DATASET_PATH).toString("utf8"));
  const { denominators, ok } = deriveV4Denominators(dataset);
  if (!ok) throw new Error(`dataset denominators mismatch: ${JSON.stringify(denominators)}`);
  for (const key of ["case_count", "goal_capability_eligible", "dual_all", "dual_compile_ok", "dual_engine_unsupported", "dual_known_limitation", "bare_equation_controls"] as const) {
    if (manifest[key] !== (denominators as any)[key]) throw new Error(`manifest denominator mismatch: ${key} manifest=${manifest[key]} dataset=${(denominators as any)[key]}`);
  }
  for (const [k, v] of Object.entries(denominators.class_counts)) {
    if (manifest.class_counts?.[k] !== v) throw new Error(`manifest class count mismatch: ${k}`);
  }
  if (manifest.max_repairs !== 1) throw new Error("manifest max_repairs must be 1");
  if (manifest.prompt_policy_version !== promptPolicyVersionFromBlob(rev)) throw new Error("manifest prompt_policy_version does not match the base prompt blob");
  if (manifest.prompt_v4_overlay_path !== V4_PROMPT_OVERLAY_PATH) throw new Error("manifest prompt overlay path mismatch");
  const groups = manifest.authority?.groups ?? [];
  const expectedGroups = V4_AUTHORITY_GROUPS.map((g) => g.group);
  if (groups.length !== expectedGroups.length || !groups.every((g: any) => expectedGroups.includes(g.group))) {
    throw new Error(`authority group set mismatch: expected ${expectedGroups.join(",")}`);
  }
  const seen = new Set<string>();
  for (const g of groups) {
    for (const f of g.files ?? []) {
      if (typeof f.path !== "string" || !/^[0-9a-f]{40}$/.test(String(f.git_blob_oid ?? "")) || !/^[0-9a-f]{64}$/.test(String(f.sha256_raw_blob_bytes ?? "")) || typeof f.byte_size !== "number") {
        throw new Error(`malformed authority entry: ${JSON.stringify(f)}`);
      }
      if (seen.has(f.path)) throw new Error(`duplicate authority path: ${f.path}`);
      seen.add(f.path);
      const actual = entryFor(rev, f.path);
      if (JSON.stringify(actual) !== JSON.stringify(f)) throw new Error(`authority blob mismatch at ${f.path}: manifest=${JSON.stringify(f)} actual=${JSON.stringify(actual)}`);
    }
  }
  for (const g of V4_AUTHORITY_GROUPS) for (const p of g.paths) if (!seen.has(p)) throw new Error(`manifest is missing an authority path: ${p}`);
  if (!manifest.construction_provenance_not_authority?.paths?.includes("scripts/generate-v4-fixtures.mjs")) throw new Error("construction provenance (generator) is not declared as non-authority");
  if (!manifest.evidence_not_authority?.paths?.includes("runs/p53/v4-c1-audit.json")) throw new Error("runs evidence is not declared as non-authority");
  const from = manifest.generated_from_commit ? resolveCommitish(String(manifest.generated_from_commit)) : null;
  if (!from || !isAncestorOfHead(from)) throw new Error(`generated_from_commit ${manifest.generated_from_commit} is not HEAD or an ancestor of HEAD`);
  return { ...manifest, verified_rev: rev, verified_commit: commit, authority_file_count: seen.size };
}

if (require.main === module) {
  try {
    if (process.argv.includes("--generate")) {
      const rev = process.argv.includes("--staged") ? ":" : "HEAD";
      const manifest = buildV4Manifest(rev);
      const out = path.join(ROOT, V4_MANIFEST_PATH);
      fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
      console.log(`v4 freeze manifest written: ${V4_MANIFEST_PATH} (authority base commit ${manifest.generated_from_commit}, ${manifest.authority.groups.reduce((n: number, g: any) => n + g.files.length, 0)} blobs)`);
    } else {
      const r = verifyFreezeV4({ rev: process.argv.includes("--staged") ? ":" : process.argv[2] || "HEAD" });
      console.log(`v4 freeze manifest verified at ${r.verified_commit}: ${r.authority_file_count} authority blobs; dataset blob ${r.authority.groups[0].files[0].git_blob_oid}`);
    }
  } catch (e: any) {
    console.error(`V4 FREEZE FAIL: ${e?.message ?? e}`);
    process.exit(1);
  }
}
