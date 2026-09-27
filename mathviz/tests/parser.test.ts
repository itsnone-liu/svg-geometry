// P5.1 parser unit tests: provider abstraction, parse pipeline, repair cap,
// taxonomy split (parser failure vs engine refusal), leakage scan, cache,
// and the semantic normalizer used by the benchmark.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseProblemSpec, attemptCompile, routeDomain } from "../packages/parser/src/parse";
import { ScriptedProvider, extractJsonText } from "../packages/parser/src/provider";
import { repairCall } from "../packages/parser/src/prompt";
import { leakScan, cacheKey } from "../packages/parser/src/telemetry";
import { semanticEqual, normalizedKey, semanticLayers } from "../packages/parser-benchmark/src/normalize-spec";

const ROOT = path.resolve(__dirname, "..");
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/spec/geometry2d-length.spec.json"), "utf8"));
const ST = geo.statement;

describe("P5.1 structured providers", () => {
  it("strips markdown fences defensively", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it("scripted provider pops replies in order and counts calls", async () => {
    const p = new ScriptedProvider(['{"domain":"geometry2d"}']);
    const out = await routeDomain(p, ST);
    expect(out.domain).toBe("geometry2d");
    expect(p.calls).toBe(1);
  });

  it("domain routing rejects non-domain answers", async () => {
    const p = new ScriptedProvider(['{"domain":"chemistry"}']);
    const out = await routeDomain(p, ST);
    expect(out.domain).toBeNull();
    expect(out.error?.category).toBe("DOMAIN_ERROR");
  });
});

describe("P5.1 parse pipeline", () => {
  it("accepts a clean spec through A0+A1 with zero repairs", async () => {
    const p = new ScriptedProvider(['{"domain":"geometry2d"}', JSON.stringify(geo)]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    expect(out.status).toBe("PARSER_ACCEPTED");
    expect(out.repairUsed).toBe(false);
    expect(out.errors).toEqual([]);
    expect(leakScan(out.spec)).toEqual([]);
  });

  it("classifies valid-but-unsupported as ENGINE_UNSUPPORTED, not a parser failure", async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/spec/function2d-solve.spec.json"), "utf8"));
    const bad = structuredClone(fx);
    bad.entities[0].props.lhs = {
      t: "app", op: "-",
      args: [
        { t: "app", op: "^", args: [{ t: "sym", name: "x" }, { t: "num", v: { kind: "int", value: "2" } }] },
        { t: "num", v: { kind: "int", value: "2" } }
      ]
    };
    const p = new ScriptedProvider(['{"domain":"function2d"}', JSON.stringify(bad)]);
    const out = await parseProblemSpec(p, bad.statement, { noCache: true });
    expect(out.status).toBe("ENGINE_UNSUPPORTED");
    expect(out.spec).not.toBeNull(); // the valid spec stays auditable
    expect(out.errors.every((e) => e.category === "COMPILER_UNSUPPORTED")).toBe(true);
    expect(p.calls).toBe(2); // no repair round for engine refusals
  });

  it("repair prompt includes the complete previous candidate and structured path errors", () => {
    const previous = structuredClone(geo);
    previous.entities[0].props.answer = "smuggled";
    const call = repairCall(ST, "geometry2d", previous, [{ code: "E_SCHEMA", path: "/entities/0/props/answer", message: "additional property" }]);
    expect(call.input).toContain(JSON.stringify(previous, null, 1));
    expect(call.input).toContain("/entities/0/props/answer");
    expect(call.input).toContain("Allowed goal capabilities");
    expect(call.input).toContain("Entity kinds and their EXACT allowed props");
  });

  it("repairs exactly once, then gives up with the prior candidate included", async () => {
    const bad = structuredClone(geo) as any;
    bad.entities[0].props.answer = "smuggled";
    const p = new ScriptedProvider([
      '{"domain":"geometry2d"}',
      JSON.stringify(bad),
      JSON.stringify(geo)
    ]);
    const out = await parseProblemSpec(p, ST, { noCache: true });
    expect(p.requests[2]!.input).toContain(JSON.stringify(bad, null, 1));
    expect(p.requests[2]!.input).toContain("/entities/0/props");
    expect(out.status).toBe("PARSER_ACCEPTED");
    expect(out.repairUsed).toBe(true);
    expect(out.repairDelta).toBeGreaterThan(0);
    expect(p.calls).toBe(3); // A0 + A1 + exactly one repair
  });

  it("categorizes schema errors with instance paths for repair prompts", async () => {
    const bad: any = structuredClone(geo);
    bad.entities[0].props.answer = "10";
    const att = attemptCompile(bad);
    expect(att.ok).toBe(false);
    expect(att.errors[0]!.category).toBe("SCHEMA_ERROR");
    expect(att.errors.some((e) => (e.path ?? "").includes("/entities/0/props"))).toBe(true);
  });

  it("answer leakage scan flags smuggled answer channels", () => {
    expect(leakScan({ goals: [{ goalId: "g" }] })).toEqual([]);
    expect(leakScan({ derived_facts: [] })).toEqual(["derived_facts"]);
    expect(leakScan({ goals: [{ inputs: [{ answer: 3 }] }] })).toEqual(["goals[0].inputs[0].answer"]);
  });

  it("cache key binds contract+policy+provider+statement", () => {
    expect(cacheKey("p1", "a")).not.toBe(cacheKey("p2", "a"));
    expect(cacheKey("p1", "a")).not.toBe(cacheKey("p1", "b"));
    expect(cacheKey("p1", "a")).toBe(cacheKey("p1", "a"));
  });
});

describe("P5.1 benchmark semantic normalizer", () => {
  const renameVariant = () => {
    const v = structuredClone(geo);
    v.entities[0].id = "P1";
    v.entities[1].id = "P2";
    v.entities[2].props = { a: "P1", b: "P2" };
    v.entities[2].id = "S";
    v.goals[0].inputs = ["entity:S"];
    return v;
  };

  it("identity: same spec is semantically equal", () => {
    expect(semanticEqual(geo, structuredClone(geo))).toBe(true);
  });

  it("stable renaming preserves semantics independent of entity array order", () => {
    const renamed = renameVariant();
    renamed.entities.reverse();
    expect(semanticEqual(geo, renamed)).toBe(true);
  });

  it("int and rational q=1 literals normalize together", () => {
    const v = structuredClone(geo);
    v.entities[0].props = { x: "1", y: "1" }; // renamer does not touch DSL strings
    // numeric normalization at fact level:
    v.source_facts = [{ fact_id: "f", name: "n", value: { kind: "int", value: "5" }, provenance: v.entities[0].provenance }];
    const w = structuredClone(v);
    w.source_facts[0].value = { kind: "rational", p: "5", q: "1" };
    expect(semanticEqual(v, w)).toBe(true);
  });

  it("km/h and m/s unit normalization is exact", () => {
    const kmh: any = {
      schemaVersion: "mathviz.problemspec/v1", problemId: "x", domain: "motion1d",
      statement: "s", entities: [], source_facts: [
        { fact_id: "v", name: "v", unit: "km/h", value: { kind: "int", value: "18" }, provenance: { kind: "problem_text", span: { text: "s", start: 0, end: 1 } } }
      ], goals: [{ goalId: "g", capabilityId: "motion1d.meeting_event", inputs: ["fact:v"] }]
    };
    const ms = structuredClone(kmh);
    ms.source_facts[0].unit = "m/s";
    ms.source_facts[0].value = { kind: "rational", p: "5", q: "1" };
    expect(semanticEqual(kmh, ms)).toBe(true);
  });

  it("subtraction and commutative equation sides normalize", () => {
    const a = { t: "sym", name: "x" };
    const b = { t: "sym", name: "y" };
    const left = { t: "app", op: "-", args: [a,b] };
    const right = { t: "app", op: "+", args: [a,{ t: "app", op: "neg", args: [b] }] };
    const x = structuredClone(geo) as any;
    x.entities.push({ id: "Q", kind: "equation", props: { capability_id: "function2d.solve_equation", variable: "x", lhs: left, rhs: { t: "num", v: { kind: "int", value: "0" } } }, provenance: structuredClone(geo.entities[0].provenance) });
    const y = structuredClone(x);
    y.entities[3].props.lhs = right;
    [y.entities[3].props.lhs, y.entities[3].props.rhs] = [y.entities[3].props.rhs, y.entities[3].props.lhs];
    expect(normalizedKey(x)).toBe(normalizedKey(y));
  });

  it("AST neutral terms drop: x + 0 equals x", () => {
    const withZero = structuredClone(geo);
    withZero.entities.push({
      id: "F", kind: "function",
      props: {
        capability_id: "function2d.expression_curve", variable: "t",
        expr: { t: "app", op: "+", args: [{ t: "sym", name: "t" }, { t: "num", v: { kind: "int", value: "0" } }] }
      },
      provenance: structuredClone(geo.entities[0].provenance)
    });
    const without = structuredClone(withZero);
    without.entities[3].props.expr = { t: "sym", name: "t" };
    expect(normalizedKey(withZero)).toBe(normalizedKey(without));
  });

  it("provenance span variation is independent of core semantic equality", () => {
    const alt = structuredClone(geo);
    const text = "已知点 A(0, 0)";
    const start = alt.statement.indexOf(text);
    alt.entities[0].provenance.span = { text, start, end: start + text.length };
    expect(semanticEqual(geo, alt)).toBe(true);
    expect(semanticLayers(geo).provenance).not.toBe(semanticLayers(alt).provenance);
  });

  it("hallucinated facts and wrong capabilities still fail comparison", () => {
    const extra = structuredClone(geo);
    extra.source_facts = [{ fact_id: "hallucinated", name: "h", value: { kind: "int", value: "1" }, provenance: structuredClone(geo.entities[0].provenance) }];
    expect(semanticEqual(geo, extra)).toBe(false);

    const wrongCap = structuredClone(geo);
    wrongCap.goals[0].capabilityId = "geometry2d.derive_midpoint";
    expect(semanticEqual(geo, wrongCap)).toBe(false);
  });
});
