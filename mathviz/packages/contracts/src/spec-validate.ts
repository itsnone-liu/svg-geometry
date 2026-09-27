// ProblemSpec v1 semantic validator (P5.0).
// The JSON schema freezes the STRUCTURE (no answer-shaped keys can exist);
// this validator freezes the SEMANTICS on top of a schema-valid document:
//   1. every goal capability exists in the frozen registry
//   2. its domain matches the spec's domain and its family is goal-compatible
//      ("solver" or "event" — presentation/verification families cannot pose
//      as goals)
//   3. every goal input resolves to a declared source entity or fact
//   4. goal ids are unique
//   5. source-fact provenance spans are exact slices of the statement
// All checks are deterministic and total: validate returns a list, never
// throws (structural garbage is caught by the schema first).

import type { VizError } from "./gates";
import { makeError } from "./gates";
import { capabilities } from "./load";

export const GOAL_CAPABILITY_FAMILIES = new Set(["solver", "event"]);

export function validateProblemSpec(doc: any): VizError[] {
  const errs: VizError[] = [];
  if (!doc || typeof doc !== "object") {
    return [makeError("E_SCHEMA", "problemspec must be an object")];
  }

  const entityIds = new Set<string>((doc.entities ?? []).map((e: any) => e?.id).filter((x: any) => typeof x === "string"));
  const factIds = new Set<string>((doc.source_facts ?? []).map((f: any) => f?.fact_id).filter((x: any) => typeof x === "string"));

  const goalIds = new Set<string>();
  for (const g of doc.goals ?? []) {
    const gid = g?.goalId ?? "<missing>";
    if (goalIds.has(gid)) errs.push(makeError("E_SCHEMA", `duplicate goalId '${gid}'`, g));
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

  // Spans: same rule the Math IR gate G2 enforces, applied at the spec layer
  // so a bad parser output never reaches the compiler.
  const statement: string = typeof doc.statement === "string" ? doc.statement : "";
  for (const f of doc.source_facts ?? []) {
    const span = f?.provenance?.span;
    if (!span || typeof span.text !== "string") continue; // schema catches shape
    const start = span.start, end = span.end;
    if (
      typeof start !== "number" || typeof end !== "number" ||
      start < 0 || end > statement.length || start >= end ||
      statement.slice(start, end) !== span.text
    ) {
      errs.push(makeError("E_PROVENANCE", `source fact '${String(f?.fact_id)}': span is not an exact slice of the statement`));
    }
  }

  return errs;
}
