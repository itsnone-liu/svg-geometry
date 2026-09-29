// P5.4 Stage-4 — v5 benchmark builder (offline, deterministic, zero provider).
// Constructs the 72-case v5 dataset from the frozen v4 blobs:
//   geometry2d 24 (22 COMPILE_OK + 2 ENGINE_UNSUPPORTED) — migrated verbatim
//   motion1d    24 (22 COMPILE_OK + 2 ENGINE_UNSUPPORTED) — migrated verbatim
//   function2d  24 (22 COMPILE_OK + 2 ENGINE_UNSUPPORTED) —
//     v4_f_01/02 (EU dual B) kept; v4_f_03/f_04 reclassified from
//     KNOWN_LIMITATION to COMPILE_OK dual A (equation span corrected to the
//     full-sentence slice; the f_03-class expectation dispute is resolved by
//     the Stage-1 H1 adjudication — v4 stays history); v4_f_05..15 kept
//     (dual A); v4_f_16..22 migrated bare; v4_f_23 rebuilt as the
//     two-solve-goals case; v4_f_24 rebuilt as the AST-equivalent-but-
//     surface-different case.
// Every case carries pre-frozen EXPECTATIONS (Stage-4 principle 1):
// expected class/stage/error, expected capabilities, required entities,
// grounding span authority, protected goal expectations, dual family, and
// repair-sensitive tags. The challenge registry (dual + repair-sensitive
// coverage) is emitted alongside the dataset.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { attemptCompileV5 } from "../../parser/src/parse-v5";
import { readGitBlob } from "./git-blob";
import { V4_DATASET_PATH } from "./freeze-v4";

const FREEZE = "877bf6dd0ee30d4adca62d79cded0eaf657edf64";
const OUT_DIR = path.join(ROOT, "fixtures", "parser-bench-v5");

const num = (n: string) => ({ t: "num", v: { kind: "int", value: n } });
const sym = (name: string) => ({ t: "sym", name });
const app = (op: string, ...args: any[]) => ({ t: "app", op, args });
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const spanOf = (s: string, text: string) => ({ start: s.indexOf(text), end: s.indexOf(text) + text.length, text });

/** Repair-sensitive structural tags per case (Stage-4 principle 2). */
const REPAIR_SENSITIVE: Record<string, string[]> = {
  v5_f_01: ["missing-declaration-label"],
  v5_f_02: ["missing-declaration-label", "non-x-variable"],
  v5_f_03: ["missing-declaration-label", "wrong-entity-label", "span-locally-wrong"],
  v5_f_04: ["missing-declaration-label", "span-locally-wrong"],
  v5_f_05: ["missing-declaration-label", "over-reference-irrelevant-source"],
  v5_f_06: ["missing-declaration-label", "non-x-variable", "variable-mismatch"],
  v5_f_07: ["missing-declaration-label", "non-x-variable"],
  v5_f_08: ["missing-declaration-label", "over-reference-irrelevant-source"],
  v5_f_09: ["missing-declaration-label"], v5_f_10: ["missing-declaration-label"],
  v5_f_11: ["missing-declaration-label"], v5_f_12: ["missing-declaration-label"],
  v5_f_13: ["missing-declaration-label"], v5_f_14: ["missing-declaration-label"],
  v5_f_15: ["missing-declaration-label"],
  v5_f_16: ["goal-local-binding"], v5_f_17: ["goal-local-binding"],
  v5_f_23: ["multiple-solve-goals-partial-break", "goal-local-binding"],
  v5_f_24: ["ast-equivalent-surface-different"],
};

/** Pre-frozen dual expectations (Stage-4 principle 3). Never adjusted by live. */
function dualFamilyOf(golden: any, expectedClass: string): string | null {
  if (golden.domain !== "function2d") return null;
  if (!golden.entities?.some((e: any) => e.kind === "function")) return null;
  return expectedClass === "COMPILE_OK" ? "A_DUAL_COMPILE_OK" : expectedClass === "ENGINE_UNSUPPORTED" ? "B_DUAL_ENGINE_UNSUPPORTED" : null;
}

function extractExpectations(c: any) {
  const golden = c.golden;
  const dual = dualFamilyOf(golden, c.expected_class);
  return {
    expected_class: c.expected_class,
    expected_stage: c.expected_class === "COMPILE_OK" ? null : c.expected_stage,
    expected_error: c.expected_class === "COMPILE_OK" ? null : c.expected_error,
    expectedCapabilities: [...new Set((golden.goals ?? []).map((g: any) => g.capabilityId))],
    requiredEntities: (golden.entities ?? []).map((e: any) => ({ id: e.id, kind: e.kind, label: e.label ?? null })),
    groundingAuthority: (golden.entities ?? []).map((e: any) => ({ path: `/entities/${e.id}/provenance/span`, start: e.provenance?.span?.start, end: e.provenance?.span?.end, text: e.provenance?.span?.text })),
    protectedGoals: (golden.goals ?? []).filter((g: any) => g.capabilityId === "function2d.solve_equation").map((g: any) => ({ goalId: g.goalId, inputs: g.inputs })),
    dualFamily: dual,
    repairSensitive: REPAIR_SENSITIVE[c.id] ?? [],
  };
}

function renumberCase(c: any, newId: string): any {
  const out = clone(c);
  out.id = newId;
  out.golden.problemId = newId;
  return out;
}

function main() {
  const v4 = JSON.parse(readGitBlob(FREEZE, V4_DATASET_PATH).toString("utf8"));
  const byId = new Map(v4.cases.map((c: any) => [c.id, c]));
  const cases: any[] = [];

  // --- geometry2d + motion1d: migrate verbatim (statements + goldens proven
  // by the v4 golden scorer; expectation metadata newly extracted) ---
  for (const dom of ["geometry2d", "motion1d"]) {
    const src = v4.cases.filter((c: any) => c.domain === dom);
    src.forEach((c: any, i: number) => {
      const id = `v5_${dom === "geometry2d" ? "g" : "m"}_${String(i + 1).padStart(2, "0")}`;
      cases.push(renumberCase(c, id));
    });
  }

  // --- function2d 24 ---
  // EU dual B (kept verbatim).
  for (const src of ["v4_f_01", "v4_f_02"]) cases.push(renumberCase(byId.get(src), src.replace("v4_f", "v5_f")));
  // f_03/f_04: reclassified KNOWN -> COMPILE_OK; equation span corrected to
  // the full-sentence slice (the same grounding pattern as the healthy dual
  // goldens); KNOWN tags/expected_* replaced.
  for (const [src, newId] of [["v4_f_03", "v5_f_03"], ["v4_f_04", "v5_f_04"]] as const) {
    const c = clone(byId.get(src));
    c.id = newId; c.golden.problemId = newId;
    c.expected_class = "COMPILE_OK"; c.expected_stage = null; c.expected_error = null;
    c.tags = c.tags.filter((t: string) => t !== "known-limitation" && t !== "g19-grounding");
    c.tags.push("reclassified-from-known-limitation");
    c.challengeType = "expression-term-loss";
    const eq = c.golden.entities.find((e: any) => e.kind === "equation");
    eq.provenance.span = { start: 0, end: c.statement.length, text: c.statement };
    cases.push(c);
  }
  // Dual A (kept verbatim).
  for (let i = 5; i <= 15; i++) {
    const src = `v4_f_${String(i).padStart(2, "0")}`;
    cases.push(renumberCase(byId.get(src), src.replace("v4_f", "v5_f")));
  }
  // Bare migrated.
  for (let i = 16; i <= 22; i++) {
    const src = `v4_f_${String(i).padStart(2, "0")}`;
    cases.push(renumberCase(byId.get(src), src.replace("v4_f", "v5_f")));
  }
  // v5_f_23: two solve goals in one statement (probe-verified golden shape).
  {
    const s = "解方程 24*y - 27 = 0，再解方程 y + 5 = 0。";
    const spanA = "24*y - 27 = 0"; const spanB = "y + 5 = 0";
    cases.push({
      id: "v5_f_23", domain: "function2d", category: "straightforward", challengeType: "multi-goal-binding",
      statement: s, expected_class: "COMPILE_OK", expected_stage: null, expected_error: null,
      tags: ["multi-solve-goal", "repair-sensitive"],
      golden: {
        schemaVersion: "mathviz.problemspec/v1", problemId: "v5_f_23", domain: "function2d", statement: s,
        entities: [
          { id: "eq_23a", kind: "equation", props: { capability_id: "function2d.solve_equation", variable: "y", lhs: app("-", app("*", num("24"), sym("y")), num("27")), rhs: num("0") }, provenance: { kind: "problem_text", span: spanOf(s, spanA) } },
          { id: "eq_23b", kind: "equation", props: { capability_id: "function2d.solve_equation", variable: "y", lhs: app("+", sym("y"), num("5")), rhs: num("0") }, provenance: { kind: "problem_text", span: spanOf(s, spanB) } },
        ],
        source_facts: [],
        goals: [
          { goalId: "solve_23a", capabilityId: "function2d.solve_equation", inputs: ["entity:eq_23a"] },
          { goalId: "solve_23b", capabilityId: "function2d.solve_equation", inputs: ["entity:eq_23b"] },
        ],
      },
    });
  }
  // v5_f_24: AST-equivalent but surface-different equation (probe-verified).
  {
    const s = "解方程 25*m - 4*(m + 7) = 0。";
    const spanT = "25*m - 4*(m + 7) = 0";
    cases.push({
      id: "v5_f_24", domain: "function2d", category: "straightforward", challengeType: "surface-equivalent-ast",
      statement: s, expected_class: "COMPILE_OK", expected_stage: null, expected_error: null,
      tags: ["ast-equivalent-surface-different", "repair-sensitive"],
      golden: {
        schemaVersion: "mathviz.problemspec/v1", problemId: "v5_f_24", domain: "function2d", statement: s,
        entities: [
          { id: "eq_24", kind: "equation", props: { capability_id: "function2d.solve_equation", variable: "m", lhs: app("-", app("*", num("25"), sym("m")), app("*", num("4"), app("+", sym("m"), num("7")))), rhs: num("0") }, provenance: { kind: "problem_text", span: spanOf(s, spanT) } },
        ],
        source_facts: [],
        goals: [{ goalId: "solve_24", capabilityId: "function2d.solve_equation", inputs: ["entity:eq_24"] }],
      },
    });
  }

  // Order: g, m, f by number for stable output.
  cases.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  // Attach expectations (pre-frozen; live may never modify).
  for (const c of cases) c.expectations = extractExpectations(c);

  const dataset = { version: "5.0", benchmark: "parser-bench-v5", cases };

  // Challenge registry (dual + repair-sensitive coverage), pre-frozen.
  const dual = cases.filter((c: any) => c.expectations.dualFamily);
  const registry = {
    version: "5.0",
    dual_registry: {
      principle: "explicit challenge family; pre-registered IDs + expected behavior; never adjusted by live performance",
      counts: { total: dual.length, A_DUAL_COMPILE_OK: dual.filter((c: any) => c.expectations.dualFamily === "A_DUAL_COMPILE_OK").length, B_DUAL_ENGINE_UNSUPPORTED: dual.filter((c: any) => c.expectations.dualFamily === "B_DUAL_ENGINE_UNSUPPORTED").length },
      cases: dual.map((c: any) => ({
        case_id: c.id, family: c.expectations.dualFamily,
        expected: c.expectations.dualFamily === "A_DUAL_COMPILE_OK"
          ? "PARSER_ACCEPTED with core semantic match; function entity carries canonical label; goal inputs exactly [equation]"
          : "ENGINE_UNSUPPORTED with declared expected_error, parser-owned errors = 0, core semantic match",
      })),
    },
    repair_sensitive_coverage: {
      principle: "every owner-listed repair-sensitive class is represented by at least one pre-registered case",
      classes: [
        { class: "missing-declaration-label", cases: cases.filter((c) => c.expectations.repairSensitive.includes("missing-declaration-label")).map((c) => c.id) },
        { class: "wrong-entity-label", cases: ["v5_f_03"] },
        { class: "goal-local-binding", cases: ["v5_f_16", "v5_f_17", "v5_f_23"] },
        { class: "multiple-solve-goals-partial-break", cases: ["v5_f_23"] },
        { class: "equation-function-variable-mismatch", cases: ["v5_f_06"] },
        { class: "non-x-variable", cases: ["v5_f_02", "v5_f_06", "v5_f_07"] },
        { class: "ast-equivalent-surface-different", cases: ["v5_f_24"] },
        { class: "provenance-span-locally-wrong", cases: ["v5_f_03", "v5_f_04"] },
        { class: "over-reference-irrelevant-source", cases: ["v5_f_05", "v5_f_08"] },
      ],
    },
  };

  // Build-time self-check: every golden must pass the v5 gates per its class.
  let coOk = 0, euOk = 0, mismatched: string[] = [];
  for (const c of cases) {
    const att = attemptCompileV5(c.golden, c.statement);
    const good = c.expected_class === "COMPILE_OK" ? att.ok : att.engineUnsupported && att.errors.length === 1 && att.errors[0].code === c.expected_error;
    if (good) { if (c.expected_class === "COMPILE_OK") coOk++; else euOk++; }
    else mismatched.push(`${c.id}:${att.ok ? "OK" : att.engineUnsupported ? "EU:" + att.errors.map((e) => e.code).join("+") : "FAIL:" + att.errors.map((e) => e.code).join("+")}`);
  }

  const dist: Record<string, number> = {};
  for (const c of cases) dist[`${c.domain}|${c.expected_class}`] = (dist[`${c.domain}|${c.expected_class}`] ?? 0) + 1;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "cases.json"), JSON.stringify(dataset, null, 1) + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "challenge-registry.json"), JSON.stringify(registry, null, 1) + "\n", "utf8");
  console.log("v5 dataset written:", cases.length, "cases");
  console.log("distribution:", JSON.stringify(dist));
  console.log("golden self-check: CO", coOk, "/ 66, EU", euOk, "/ 6", mismatched.length ? "MISMATCH: " + mismatched.join(", ") : "(all match)");
  console.log("dual registry:", JSON.stringify(registry.dual_registry.counts));
}

main();
