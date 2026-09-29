// P5.4 Stage-4 — v5 benchmark freeze manifest generator. Pins SHA-256 of the
// dataset, challenge registry, golden scorer, v5 pipeline modules, and the
// canonical provider-visible packet (all 72 spec-call requests). The freeze
// authority model follows P5.3: committed Git blob bytes are the authority.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ROOT } from "../../contracts/src/load";
import { specCallV5 } from "../../parser/src/prompt-v5";

const DIR = path.join(ROOT, "fixtures", "parser-bench-v5");
const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

const PINNED_FILES = [
  "fixtures/parser-bench-v5/cases.json",
  "fixtures/parser-bench-v5/challenge-registry.json",
  "packages/parser-benchmark/src/run-v5-golden.ts",
  "packages/parser-benchmark/src/preflight-v5.ts",
  "packages/parser-benchmark/src/build-v5.ts",
  "packages/parser/src/parse-v5.ts",
  "packages/parser/src/identity-v5.ts",
  "packages/parser/src/repair-v5.ts",
  "packages/parser/src/grounding-v5.ts",
  "packages/parser/src/prompt-v5.ts",
];

function main() {
  const dataset = JSON.parse(fs.readFileSync(path.join(DIR, "cases.json"), "utf8"));
  const registry = JSON.parse(fs.readFileSync(path.join(DIR, "challenge-registry.json"), "utf8"));

  const files: Record<string, string> = {};
  for (const p of PINNED_FILES) files[p] = sha256(fs.readFileSync(path.join(ROOT, p)));

  // Canonical provider-visible packet hash: all 72 spec-call requests in
  // dataset order, stably serialized (sorted keys, no whitespace).
  const packetParts = dataset.cases.map((c: any) => JSON.stringify(specCallV5(c.statement, c.domain), Object.keys(specCallV5(c.statement, c.domain)).sort()));
  const packetHash = sha256(packetParts.join("\n"));

  const denominators = {
    total: dataset.cases.length,
    compile_ok: dataset.cases.filter((c: any) => c.expected_class === "COMPILE_OK").length,
    engine_unsupported: dataset.cases.filter((c: any) => c.expected_class === "ENGINE_UNSUPPORTED").length,
    known_limitation: dataset.cases.filter((c: any) => c.expected_class === "KNOWN_LIMITATION_EXPECTED_REJECT").length,
    domains: { geometry2d: 24, motion1d: 24, function2d: 24 },
    dual_all: 15, dual_compile_ok: 13, dual_engine_unsupported: 2,
    repair_sensitive_classes: registry.repair_sensitive_coverage.classes.length,
  };
  if (denominators.compile_ok !== 66 || denominators.engine_unsupported !== 6 || denominators.known_limitation !== 0 || denominators.total !== 72) throw new Error("denominator drift — refusing to freeze");

  const manifest = {
    version: "5.0",
    benchmark: "parser-bench-v5",
    built_from_commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    frozen_at: new Date().toISOString(),
    authority: "committed git blob bytes (git cat-file blob <freeze-commit>:<path>); worktree is hygiene only",
    files, packet_hash: packetHash, denominators,
    stage3_baseline: "02a9298",
    live_policy: { provider: "FORBIDDEN until new independent authorization", max_repairs: 1, repair_projection_counts_as_repair: false, v4_verdict: "FAIL @8b10a766 (never rewritten)" },
  };

  const out = path.join(DIR, "freeze-v5.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 1) + "\n", "utf8");
  // self-verify
  const reread = JSON.parse(fs.readFileSync(out, "utf8"));
  for (const p of PINNED_FILES) if (reread.files[p] !== sha256(fs.readFileSync(path.join(ROOT, p)))) throw new Error(`hash drift on ${p}`);
  console.log("freeze-v5.json written; pinned", PINNED_FILES.length, "files; packet_hash", packetHash.slice(0, 16) + "…");
}

main();
