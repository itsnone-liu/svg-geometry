// ProblemSpec v1 semantic validator (P5.0 + P5.0.1 parser surface hardening).
// The JSON schema freezes the STRUCTURE (allow-listed props per entity kind,
// provenance required on every source semantic object, no answer-shaped keys);
// this validator freezes the SEMANTICS on top of a schema-valid document:
//
//   P5.0:
//     1. goal capabilities exist in the frozen registry, match the spec
//        domain, and are goal-compatible (family solver/event)
//     2. goal inputs resolve to declared source entities/facts
//     3. goal ids are unique
//     4. source-fact spans are exact slices of the statement
//   P5.0.1 (parser surface — closed BEFORE any LLM is attached):
//     5. every goal capability is on the ProblemSpec Compiler Capability
//        Surface (registry existence != parser may emit)
//     6. entity kinds are whitelisted per domain; entity/constraint spans
//        are exact slices of the statement
//     7. entity/fact/parameter ids are unique within their namespace
//     8. all intra-entity references close inside the spec (segment.a/b,
//        circle.center, body fact refs, function parameter_bindings)
//     9. expression symbol closure: function/equation ASTs may only use
//        their own variable, declared parameters, pi and e
//
// All checks are deterministic and total: validate returns a list, never
// throws (structural garbage is caught by the schema first).

import type { VizError } from "./gates";
import { makeError } from "./gates";
import { capabilities } from "./load";

export const GOAL_CAPABILITY_FAMILIES = new Set(["solver", "event"]);

/** P5.1 §17-18: registry existence != the P5 parser/compiler may emit it.
 * This is the frozen ProblemSpec Compiler Capability Surface — the ONLY
 * goal capabilities the deterministic compiler has wired solvers for. The
 * parser prompt exposes exactly this list. */
export const PROBLEM_SPEC_COMPILER_SURFACE: Record<string, string[]> = {
  geometry2d: ["geometry2d.derive_length"],
  motion1d: ["motion1d.meeting_event", "motion1d.overtake_event", "motion1d.reach_event"],
  function2d: ["function2d.solve_equation"]
};

const COMPILER_SURFACE = new Set(Object.values(PROBLEM_SPEC_COMPILER_SURFACE).flat());

/** P5.0.1 §2: entity kinds whitelisted per domain (props themselves are
 * allow-listed by the schema's per-kind branches). */
export const DOMAIN_ENTITY_KINDS: Record<string, Set<string>> = {
  geometry2d: new Set(["point", "segment", "line", "circle"]),
  motion1d: new Set(["body"]),
  function2d: new Set(["function", "equation"])
};

const SYMBOLIC_CONSTANTS = new Set(["pi", "e"]);
const FACT_REF = /^math:fact:([A-Za-z_][A-Za-z0-9_-]*)$/;
const PARAM_REF = /^math:param:([A-Za-z_][A-Za-z0-9_-]*)$/;

/** Collect free symbol names in an ExprAst (frozen vocabulary walk). */
export function collectAstSymbols(ast: any, into = new Set<string>()): Set<string> {
  if (!ast || typeof ast !== "object") return into;
  if (ast.t === "sym" && typeof ast.name === "string") into.add(ast.name);
  if (Array.isArray(ast.args)) for (const a of ast.args) collectAstSymbols(a, into);
  return into;
}

export function validateProblemSpec(doc: any): VizError[] {
  const errs: VizError[] = [];
  if (!doc || typeof doc !== "object") {
    return [makeError("E_SCHEMA", "problemspec must be an object")];
  }

  const entityIds = new Set<string>();
  for (const e of doc.entities ?? []) {
    if (typeof e?.id === "string") {
      if (entityIds.has(e.id)) errs.push(makeError("E_SCHEMA", `duplicate entity id '${e.id}'`));
      entityIds.add(e.id);
    }
  }
  const factIds = new Set<string>();
  for (const f of doc.source_facts ?? []) {
    if (typeof f?.fact_id === "string") {
      if (factIds.has(f.fact_id)) errs.push(makeError("E_SCHEMA", `duplicate fact id '${f.fact_id}'`));
      factIds.add(f.fact_id);
    }
  }
  const parameterIds = new Set<string>();
  for (const p of doc.parameters ?? []) {
    if (typeof p?.id === "string") {
      if (parameterIds.has(p.id)) errs.push(makeError("E_SCHEMA", `duplicate parameter id '${p.id}'`));
      parameterIds.add(p.id);
    }
  }

  // ---- goals: registry, domain, family, compiler surface, input closure ----
  const goalIds = new Set<string>();
  for (const g of doc.goals ?? []) {
    const gid = g?.goalId ?? "<missing>";
    if (goalIds.has(gid)) errs.push(makeError("E_SCHEMA", `duplicate goalId '${gid}'`));
    goalIds.add(gid);

    const cap = capabilities.get(g?.capabilityId);
    if (!cap) {
      errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `goal '${gid}': capability '${String(g?.capabilityId)}' is not in the frozen registry`));
    } else {
      if (cap.domain !== doc.domain) {
        errs.push(makeError("E_SCHEMA", `goal '${gid}': capability '${cap.id}' belongs to domain '${cap.domain}', spec is '${doc.domain}'`));
      }
      if (!GOAL_CAPABILITY_FAMILIES.has(cap.family)) {
        errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `goal '${gid}': capability family '${cap.family}' cannot be a goal (allowed: solver, event)`));
      }
      if (!COMPILER_SURFACE.has(cap.id)) {
        errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `goal '${gid}': capability '${cap.id}' exists in the registry but is not on the ProblemSpec Compiler Capability Surface`));
      }
    }

    for (const ref of g?.inputs ?? []) {
      const m = /^(entity|fact):([A-Za-z_][A-Za-z0-9_-]*)$/.exec(String(ref));
      if (!m) {
        errs.push(makeError("E_SCHEMA", `goal '${gid}': malformed input ref '${String(ref)}'`));
        continue;
      }
      const [, kind, id] = m;
      if (kind === "entity" && !entityIds.has(id)) {
        errs.push(makeError("E_BINDING", `goal '${gid}': input '${ref}' does not resolve to a source entity`));
      }
      if (kind === "fact" && !factIds.has(id)) {
        errs.push(makeError("E_BINDING", `goal '${gid}': input '${ref}' does not resolve to a source fact`));
      }
    }
  }

  // ---- statement spans: facts, entities, constraints (exact slices) ----
  const statement: string = typeof doc.statement === "string" ? doc.statement : "";
  const checkSpan = (owner: string, span: any, errs: VizError[]) => {
    if (!span || typeof span.text !== "string") return; // schema catches shape
    const start = span.start, end = span.end;
    if (
      typeof start !== "number" || typeof end !== "number" ||
      start < 0 || end > statement.length || start >= end ||
      statement.slice(start, end) !== span.text
    ) {
      errs.push(makeError("E_PROVENANCE", `${owner}: span is not an exact slice of the statement`));
    }
  };
  for (const f of doc.source_facts ?? []) checkSpan(`source fact '${String(f?.fact_id)}'`, f?.provenance?.span, errs);
  for (const e of doc.entities ?? []) checkSpan(`source entity '${String(e?.id)}'`, e?.provenance?.span, errs);
  for (const c of doc.constraints ?? []) checkSpan(`constraint '${String(c?.capability_id)}'`, c?.provenance?.span, errs);

  // ---- entity kind whitelist per domain ----
  const allowedKinds = DOMAIN_ENTITY_KINDS[doc.domain];
  if (allowedKinds) {
    for (const e of doc.entities ?? []) {
      if (typeof e?.kind === "string" && !allowedKinds.has(e.kind)) {
        errs.push(makeError("E_SCHEMA", `entity '${String(e?.id)}': kind '${e.kind}' is not a source entity kind of domain '${doc.domain}'`));
      }
    }
  }

  // ---- intra-entity reference closure (P5.0.1 §8) ----
  const requirePoint = (owner: string, ref: unknown) => {
    if (typeof ref !== "string") return; // schema catches shape
    if (!entityIds.has(ref)) errs.push(makeError("E_BINDING", `${owner}: endpoint '${ref}' does not resolve to a point entity`));
    else {
      const target = (doc.entities ?? []).find((x: any) => x?.id === ref);
      if (target && target.kind !== "point") {
        errs.push(makeError("E_BINDING", `${owner}: endpoint '${ref}' is a '${target.kind}', not a point`));
      }
    }
  };
  const requireFact = (owner: string, ref: unknown) => {
    const m = typeof ref === "string" ? FACT_REF.exec(ref) : null;
    if (!m) return; // schema catches shape
    if (!factIds.has(m[1]!)) errs.push(makeError("E_BINDING", `${owner}: '${ref}' does not resolve to a source fact`));
  };
  for (const e of doc.entities ?? []) {
    const owner = `entity '${String(e?.id)}'`;
    const kind = e?.kind, props = e?.props ?? {};
    if (kind === "segment" || kind === "line") {
      requirePoint(`${owner} props.a`, props.a);
      requirePoint(`${owner} props.b`, props.b);
    } else if (kind === "circle") {
      requirePoint(`${owner} props.center`, props.center);
    } else if (kind === "body") {
      requireFact(`${owner} props.initial_position`, props.initial_position);
      for (let i = 0; i < (props.segments ?? []).length; i++) {
        const seg = props.segments[i];
        requireFact(`${owner} segments[${i}].start`, seg?.start);
        requireFact(`${owner} segments[${i}].velocity`, seg?.velocity);
        if (seg?.end !== undefined) requireFact(`${owner} segments[${i}].end`, seg.end);
        if (typeof seg?.start_position === "string") requireFact(`${owner} segments[${i}].start_position`, seg.start_position);
      }
    } else if (kind === "function") {
      for (const [param, binding] of Object.entries(props.parameter_bindings ?? {})) {
        if (!parameterIds.has(param)) {
          errs.push(makeError("E_BINDING", `${owner}: parameter_bindings key '${param}' is not a declared parameter`));
        }
        const m = typeof binding === "string" ? PARAM_REF.exec(binding) : null;
        if (m && !parameterIds.has(m[1]!)) {
          errs.push(makeError("E_BINDING", `${owner}: parameter_bindings['${param}'] references undeclared parameter '${m[1]}'`));
        }
      }
      // symbol closure covers expr
      const allowed = new Set<string>([String(props.variable ?? ""), ...parameterIds, ...SYMBOLIC_CONSTANTS]);
      for (const sym of collectAstSymbols(props.expr)) {
        if (!allowed.has(sym)) {
          errs.push(makeError("E_BINDING", `${owner}: expression uses undeclared symbol '${sym}' (allowed: variable '${String(props.variable)}', declared parameters, pi, e)`));
        }
      }
    } else if (kind === "equation") {
      const allowed = new Set<string>([String(props.variable ?? ""), ...parameterIds, ...SYMBOLIC_CONSTANTS]);
      for (const side of ["lhs", "rhs"] as const) {
        for (const sym of collectAstSymbols(props[side])) {
          if (!allowed.has(sym)) {
            errs.push(makeError("E_BINDING", `${owner} ${side} uses undeclared symbol '${sym}' (allowed: variable '${String(props.variable)}', declared parameters, pi, e)`));
          }
        }
      }
    }
  }

  // ---- constraint subject_refs closure (params are schema-forbidden) ----
  for (const c of doc.constraints ?? []) {
    for (const ref of c?.subject_refs ?? []) {
      const m = /^(entity|fact|param):([A-Za-z_][A-Za-z0-9_-]*)$/.exec(String(ref));
      if (!m) {
        errs.push(makeError("E_SCHEMA", `constraint: malformed subject ref '${String(ref)}'`));
        continue;
      }
      const [, kind, id] = m;
      if (kind === "entity" && !entityIds.has(id)) errs.push(makeError("E_BINDING", `constraint: subject '${ref}' does not resolve to a source entity`));
      if (kind === "fact" && !factIds.has(id)) errs.push(makeError("E_BINDING", `constraint: subject '${ref}' does not resolve to a source fact`));
      if (kind === "param" && !parameterIds.has(id)) errs.push(makeError("E_BINDING", `constraint: subject '${ref}' does not resolve to a declared parameter`));
    }
  }

  return errs;
}
