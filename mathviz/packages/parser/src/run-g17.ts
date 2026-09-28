// P5.1 G17_parser_contract — the gate that makes the pipeline safe to attach
// an LLM to. All scenarios run against ScriptedProvider (zero tokens, zero
// network); they exercise the DETERMINISTIC parts, which is exactly what a
// contract gate can honestly guarantee:
//
//   S1 answer-bearing goal   -> refused (schema), repaired -> accepted
//   S2 smuggled derived_facts-> refused (schema), repaired -> accepted
//   S3 fenced JSON           -> fence-stripped, accepted
//   S4 non-JSON garbage      -> JSON_ERROR, repair -> accepted
//   S5 valid-but-unsupported -> ENGINE_UNSUPPORTED (NOT a parser failure)
//   S6 unrepairable output   -> PARSE_FAILED after exactly ONE repair
//   S7 answer leakage        -> leakScan(cleanSpec) === [] on every accepted
//      spec (belt-and-braces over the structural guarantee)
//   S8 deterministic cache   -> second parse of the same statement hits the
//      validated cache (provider call count does not grow)
//
// Plus the frozen invariant: repair never exceeds MAX_REPAIRS = 1.
//
// P5.2 grounding-aware bounded repair:
//   S10 ungrounded span       -> E_PROVENANCE_GROUNDING (with repair_hint),
//      repair prompt carries the frozen anti-corruption constraints,
//      repaired span -> accepted
//   S11 shared repair budget  -> E_SCHEMA spends the one repair; a grounding
//      failure on the repaired candidate REJECTS (no second repair)
//   S12 unrepairable grounding-> PARSE_FAILED after exactly one repair,
//      no spec yielded
//
// P5.3 source semantic fidelity (G20):
//   S13 G20+G19 aggregate     -> both finding sets reach the SINGLE repair
//      prompt (both constraint blocks present); repaired -> accepted
//   S14 repair corruption      -> fixing G19 while adding an irrelevant
//      duplicate entity REJECTS (E_SOURCE_IRRELEVANT), no second repair

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../contracts/src/load";
import { parseProblemSpec, MAX_REPAIRS } from "./parse";
import { ScriptedProvider } from "./provider";
import { leakScan } from "./telemetry";

const OUT_DIR = path.join(ROOT, "runs", "p51");

const loadSpec = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "spec", f), "utf8"));

function expect(cond: boolean, message: string): void {
  if (!cond) throw new Error("G17 assertion failed: " + message);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows: any[] = [];
  const row = (id: string, ok: boolean, detail: unknown = undefined) => {
    rows.push({ case: id, ok, detail });
    console.log(`${ok ? "ok  " : "FAIL"} ${id}`);
  };

  const geoGolden = loadSpec("geometry2d-length.spec.json");
  const fxGolden = loadSpec("function2d-solve.spec.json");
  const ST = "已知点 A(0, 0) 与点 B(6, 8)，求线段 AB 的长度。";

  // ---- S1: goal carries an answer field ----
  {
    const bad = structuredClone(geoGolden);
    (bad.goals[0] as any).value = { kind: "int", value: "10" };
    const good = structuredClone(geoGolden);
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      JSON.stringify(bad),
      JSON.stringify(good)
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s1_answer_field_refused_then_repaired",
      out.status === "PARSER_ACCEPTED" &&
      out.repairUsed === true &&
      out.errors.some((e) => e.category === "SCHEMA_ERROR") &&
      leakScan(out.spec).length === 0,
      { status: out.status, repairUsed: out.repairUsed });
  }

  // ---- S2: smuggled answer layer at the top level ----
  {
    const bad: any = structuredClone(geoGolden);
    bad.derived_facts = [{ fact_id: "ans", name: "answer", value: { kind: "int", value: "10" } }];
    const good = structuredClone(geoGolden);
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      JSON.stringify(bad),
      JSON.stringify(good)
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s2_derived_layer_refused_then_repaired",
      out.status === "PARSER_ACCEPTED" && out.repairUsed === true && leakScan(out.spec).length === 0,
      { status: out.status });
  }

  // ---- S3: fenced JSON is tolerated (fence stripping) ----
  {
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      "```json\n" + JSON.stringify(geoGolden) + "\n```"
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s3_fenced_json_accepted", out.status === "PARSER_ACCEPTED" && out.spec !== null);
  }

  // ---- S4: non-JSON garbage -> JSON_ERROR -> repaired ----
  {
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      "the answer is 10, obviously",
      JSON.stringify(geoGolden)
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s4_garbage_then_repair",
      out.status === "PARSER_ACCEPTED" && out.repairUsed === true &&
      out.errors.some((e) => e.category === "JSON_ERROR"),
      { status: out.status });
  }

  // ---- S5: valid spec outside the engine's capability ----
  {
    // x^2 - 2 = 0: parses cleanly, rational-root certificate refuses it
    const unsupported: any = structuredClone(fxGolden);
    unsupported.entities[0].props.lhs = {
      t: "app", op: "-",
      args: [
        { t: "app", op: "^", args: [{ t: "sym", name: "x" }, { t: "num", v: { kind: "int", value: "2" } }] },
        { t: "num", v: { kind: "int", value: "2" } }
      ]
    };
    unsupported.entities[0].provenance = structuredClone(fxGolden.entities[0].provenance);
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "function2d" }),
      JSON.stringify(unsupported)
    ]);
    const out = await parseProblemSpec(p, "解方程：x^2 - 2 = 0，求它的全部实数解。", { noCache: true });
    row("s5_engine_unsupported_not_parser_failure",
      out.status === "ENGINE_UNSUPPORTED" &&
      out.errors.every((e) => e.category === "COMPILER_UNSUPPORTED") &&
      out.spec !== null,
      { status: out.status });
  }

  // ---- S6: unrepairable output stops after exactly one repair ----
  {
    const bad = "still not json";
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      bad,
      bad
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s6_unrepairable_fails_after_one_repair",
      out.status === "PARSE_FAILED" && out.repairUsed === true && p.calls === 3, // A0 + A1 + 1 repair
      { calls: p.calls, MAX_REPAIRS });
  }

  // ---- S7: frozen invariant ----
  row("s7_max_repairs_is_one", MAX_REPAIRS === 1, { MAX_REPAIRS });

  // ---- S8: deterministic validated-spec cache ----
  {
    // warm the cache through a fresh (uncached) run, then re-parse with a
    // provider that would FAIL if called — the cache must answer instead.
    await parseProblemSpec(new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      JSON.stringify(geoGolden)
    ]), ST); // cache enabled
    const p = new ScriptedProvider([]); // no replies: any call would throw
    const out = await parseProblemSpec(p, ST);
    row("s8_validated_cache_hit", out.status === "PARSER_ACCEPTED" && out.cached === true && p.calls === 0,
      { cached: out.cached, calls: p.calls });
  }

  // ---- domain routing failure surfaces DOMAIN_ERROR ----
  {
    const p = new ScriptedProvider([JSON.stringify({ domain: "chemistry" })]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s9_domain_error_surfaces",
      out.status === "PARSE_FAILED" && out.errors.some((e) => e.category === "DOMAIN_ERROR") && p.calls === 1);
  }

  // ---- S10 (P5.2): ungrounded segment span -> grounding repair -> accepted ----
  {
    const withBadSpan = () => {
      const bad: any = structuredClone(geoGolden);
      bad.entities.find((e: any) => e.kind === "segment").provenance.span = { text: "已知点 A(0, 0)", start: 0, end: 11 };
      return bad;
    };
    const good = structuredClone(geoGolden);
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      JSON.stringify(withBadSpan()),
      JSON.stringify(good)
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    const repairInput = p.requests[2]?.input ?? "";
    row("s10_ungrounded_span_repaired_then_accepted",
      out.status === "PARSER_ACCEPTED" &&
      out.repairUsed === true &&
      out.errors.some((e) => e.code === "E_PROVENANCE_GROUNDING" && e.category === "PROVENANCE_ERROR" && typeof e.repair_hint === "string" && e.repair_hint.length > 0) &&
      repairInput.includes("## Grounding repair constraints") &&
      repairInput.includes("Do not change a mathematical value merely to satisfy grounding.") &&
      repairInput.includes("repair_hint") &&
      leakScan(out.spec).length === 0,
      { status: out.status, repairUsed: out.repairUsed });
  }

  // ---- S11 (P5.2): one shared repair budget across all gates ----
  {
    const schemaBad: any = structuredClone(geoGolden);
    (schemaBad.goals[0] as any).value = { kind: "int", value: "10" }; // E_SCHEMA spends the budget
    const groundingBad: any = structuredClone(geoGolden);
    groundingBad.entities.find((e: any) => e.kind === "segment").provenance.span = { text: "已知点 A(0, 0)", start: 0, end: 11 };
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      JSON.stringify(schemaBad),
      JSON.stringify(groundingBad)
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s11_grounding_after_spent_budget_rejects",
      out.status === "PARSE_FAILED" && out.repairUsed === true && p.calls === 3 &&
      out.errors.some((e) => e.code === "E_SCHEMA") &&
      out.errors.some((e) => e.code === "E_PROVENANCE_GROUNDING"),
      { status: out.status, calls: p.calls });
  }

  // ---- S12 (P5.2): unrepairable grounding stops after exactly one repair ----
  {
    const groundingBad: any = structuredClone(geoGolden);
    groundingBad.entities.find((e: any) => e.kind === "segment").provenance.span = { text: "已知点 A(0, 0)", start: 0, end: 11 };
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "geometry2d" }),
      JSON.stringify(groundingBad),
      JSON.stringify(groundingBad)
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    row("s12_unrepairable_grounding_fails_after_one_repair",
      out.status === "PARSE_FAILED" && out.repairUsed === true && p.calls === 3 && out.spec === null,
      { status: out.status, calls: p.calls });
  }

  // ---- S13 (P5.3): G20 and G19 findings aggregate into the single repair ----
  {
    const fxz = loadSpec("function2d-zeros.spec.json");
    const bad: any = structuredClone(fxz);
    bad.entities = bad.entities.filter((e: any) => e.kind !== "function"); // G20-A
    bad.entities.find((e: any) => e.kind === "equation").provenance.span = { text: "的所有零点", start: 20, end: 25 }; // G19
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "function2d" }),
      JSON.stringify(bad),
      JSON.stringify(fxz)
    ]);
    const out = await parseProblemSpec(p, fxz.statement, { noCache: true });
    const repairInput = p.requests[2]?.input ?? "";
    row("s13_g20_g19_aggregate_single_repair",
      out.status === "PARSER_ACCEPTED" && out.repairUsed === true && p.calls === 3 &&
      repairInput.includes("## Grounding repair constraints") &&
      repairInput.includes("## Source fidelity repair constraints") &&
      repairInput.includes("E_SOURCE_COMPLETENESS") &&
      repairInput.includes("E_PROVENANCE_GROUNDING") &&
      leakScan(out.spec).length === 0,
      { status: out.status, calls: p.calls });
  }

  // ---- S14 (P5.3): repair fixes G19 but adds an irrelevant duplicate -> REJECT ----
  {
    const fxz = loadSpec("function2d-zeros.spec.json");
    const bad: any = structuredClone(fxz);
    bad.entities.find((e: any) => e.kind === "equation").provenance.span = { text: "的所有零点", start: 20, end: 25 }; // G19 only
    const corrupted: any = structuredClone(fxz); // spans fixed ...
    const dup: any = structuredClone(fxz.entities.find((e: any) => e.kind === "function"));
    dup.id = "func_g2";
    corrupted.entities.push(dup); // ... but an unreachable duplicate function appears
    const p = new ScriptedProvider([
      JSON.stringify({ domain: "function2d" }),
      JSON.stringify(bad),
      JSON.stringify(corrupted)
    ]);
    const out = await parseProblemSpec(p, fxz.statement, { noCache: true });
    row("s14_repair_creates_irrelevant_entity_rejects",
      out.status === "PARSE_FAILED" && out.repairUsed === true && p.calls === 3 && out.spec === null &&
      out.errors.some((e) => e.code === "E_SOURCE_IRRELEVANT"),
      { status: out.status, calls: p.calls });
  }

  const ok = rows.every((r) => r.ok);
  const summary = ok ? "PASS" : "FAIL";
  fs.writeFileSync(path.join(OUT_DIR, "g17.json"), JSON.stringify({ gate: "G17_parser_contract", status: summary, rows }, null, 2) + "\n", "utf8");
  console.log(`G17_parser_contract: ${summary}`);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
