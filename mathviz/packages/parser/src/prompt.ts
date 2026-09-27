// Prompt assembly for the P5.1 semantic parser (frozen policy v1).
//
// Inputs given to the model (P5.1 §14): statement, domain candidates, the
// ProblemSpec JSON Schema, the parser-safe capability subset (Compiler
// Surface — NOT the whole registry), entity-kind prop schemas, a unit
// vocabulary, and one few-shot per domain. Never given: solver outputs,
// answers, derived facts.
//
// The system contract (P5.1 §29) asks for structure only — no
// chain-of-thought, no explanations.

import fs from "node:fs";
import path from "node:path";
import { PROBLEM_SPEC_COMPILER_SURFACE } from "../../contracts/src/spec-validate";

export const PARSER_CONTRACT_VERSION = "mathviz.problemspec/v1+p5.0.1";
export const PROMPT_POLICY_VERSION = "p5.1-policy-v1";

const ROOT = path.resolve(__dirname, "..", "..", "..");

const SPEC_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages", "contracts", "schemas", "problemspec.schema.json"), "utf8")
);

const FEWSHOTS: Record<string, any> = {
  geometry2d: JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "spec", "geometry2d-length.spec.json"), "utf8")),
  motion1d: JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "spec", "motion1d-meeting.spec.json"), "utf8")),
  function2d: JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "spec", "function2d-solve.spec.json"), "utf8"))
};

const DOMAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["domain"],
  properties: { domain: { enum: ["geometry2d", "motion1d", "function2d"] } }
};

export const ENTITY_KIND_GUIDE = `
Entity kinds and their EXACT allowed props (unknown props are rejected):
- geometry2d:
  point:    {x: string-literal, y: string-literal}
  segment:  {a: point-id, b: point-id}
  line:     {a: point-id, b: point-id}
  circle:   {center: point-id, radius: string-literal | ExactNumber}
- motion1d:
  body:     {capability_id: "motion1d.constant_velocity", initial_position: "math:fact:<id>",
             segments: [{start: "math:fact:<id>", velocity: "math:fact:<id>", end?: "math:fact:<id>", start_position?: ExactNumber | "math:fact:<id>"}]}
- function2d:
  function: {capability_id: "function2d.expression_curve", variable, expr: ExprAst, x_domain?, parameter_bindings?}
  equation: {capability_id: "function2d.solve_equation", variable, lhs: ExprAst, rhs: ExprAst}
Coordinates are Geometry-DSL string literals like "2", "-3/4" (rational only).
`;

export const UNIT_VOCABULARY = `
Units (motion1d only): m, km, s, h, m/s, km/h. Prefer SI (m, s, m/s); a speed
given in km/h is a fact whose value keeps km/h as unit ONLY when you cannot
convert exactly — prefer converting 18 km/h -> 5 m/s exactly when the value
divides cleanly. geometry2d/function2d facts carry no unit.
`;

const SYSTEM_CONTRACT = `You are a semantic compiler.

Extract only information explicitly stated or structurally implied by the problem.

Do not solve any requested goal.
Do not infer requested answer values.
Do not output answers, results, derivations, or explanations.
Every source semantic object (entity, fact, constraint) must cite an exact
source span: span.text must equal statement.slice(span.start, span.end).
Use only the provided capability and entity schemas.
Output a single JSON object and nothing else.`;

export function domainRoutingCall(statement: string): { schema: unknown; system: string; input: string } {
  return {
    schema: DOMAIN_SCHEMA,
    system: "Classify the problem into exactly one MathViz domain. Output JSON only.",
    input: `Domains:\n- geometry2d: static plane geometry (points, segments, lengths, circles)\n- motion1d: bodies moving on a line (meeting, overtaking, reaching)\n- function2d: equations and real functions of one variable\n\nProblem:\n${statement}\n\nWhich domain?`
  };
}

export function specCall(statement: string, domain: string): { schema: unknown; system: string; input: string } {
  const fewshot = FEWSHOTS[domain];
  const input = [
    `Target domain: ${domain}`,
    ``,
    `## Allowed goal capabilities for ${domain} (the ONLY ones you may emit):`,
    ...(PROBLEM_SPEC_COMPILER_SURFACE[domain] ?? []).map((c) => `- ${c}`),
    ``,
    ENTITY_KIND_GUIDE.trim(),
    ``,
    UNIT_VOCABULARY.trim(),
    ``,
    `## Example (${domain}, frozen few-shot):`,
    "```json",
    JSON.stringify(fewshot, null, 1),
    "```",
    ``,
    `## Problem:`,
    statement,
    ``,
    `Compile this problem into a ProblemSpec for ${domain}. Emit ONLY the JSON object.`
  ].join("\n");
  return { schema: SPEC_SCHEMA, system: SYSTEM_CONTRACT, input };
}

/** P5.1 §20 repair prompt: patch only, never solve, never add answers. */
export function repairCall(statement: string, domain: string, errors: Array<{ code: string; path?: string; message: string }>): { schema: unknown; system: string; input: string } {
  const input = [
    `Target domain: ${domain}`,
    `Allowed goal capabilities: ${(PROBLEM_SPEC_COMPILER_SURFACE[domain] ?? []).join(", ")}`,
    ``,
    `The previously emitted ProblemSpec for this problem failed validation:`,
    JSON.stringify({ errors }, null, 1),
    ``,
    `Problem:`,
    statement,
    ``,
    `Patch only the invalid ProblemSpec.`,
    `Do not solve the problem.`,
    `Do not add answer fields.`,
    `Return the complete corrected ProblemSpec as one JSON object.`
  ].join("\n");
  return { schema: SPEC_SCHEMA, system: SYSTEM_CONTRACT, input };
}
