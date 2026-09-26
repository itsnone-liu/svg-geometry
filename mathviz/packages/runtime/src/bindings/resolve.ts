// Binding source resolution over the frozen pattern:
//   math:(entity|fact|param|runtime):id(.attr)*
//
// P1 property-path semantics (frozen):
//   - entity: path walks the entity's `props` object (math:entity:A.position
//     -> A.props.position). Entities carry their payload in props by contract.
//   - fact:   path walks the fact object itself (math:fact:meet_pos.value).
//   - param:  path walks the parameter object (math:param:u.default).
//   - runtime: the expression is evaluated in the current environment
//     (reserved symbol `t` = current model time; parameters at their declared
//     values). A further path walks into the evaluated value when it is an
//     object. Outside every mapping window the environment has no `t`, so a
//     `t`-dependent runtime value resolves to null (presentation-only region).
//
// Missing base object or any missing path link -> E_BINDING.

import { makeRuntimeError } from "../errors";
import { Env, evalExpr } from "../expr/evaluate";
import { ratToNumber } from "../expr/exact";

export interface ParsedSource {
  ns: "entity" | "fact" | "param" | "runtime";
  id: string;
  path: string[];
}

const SOURCE_RE = /^math:(entity|fact|param|runtime):([A-Za-z_][A-Za-z0-9_-]*)((?:\.[A-Za-z_][A-Za-z0-9_-]*)*)$/;

export function parseSource(source: string): ParsedSource {
  const m = SOURCE_RE.exec(source ?? "");
  if (!m) throw makeRuntimeError("E_BINDING", `malformed binding source '${source}'`);
  const path = m[3] ? m[3].slice(1).split(".") : [];
  return { ns: m[1] as ParsedSource["ns"], id: m[2], path };
}

function walk(obj: unknown, path: string[], what: string): unknown {
  let cur: any = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== "object" || !(seg in cur)) {
      throw makeRuntimeError("E_BINDING", `${what}: property path '.${path.join(".")}' missing at '${seg}'`);
    }
    cur = cur[seg];
  }
  return cur;
}

function exactToValueNumber(v: any): number | null {
  if (v && typeof v === "object" && v.kind === "int" && typeof v.value === "string") return Number(v.value);
  if (v && typeof v === "object" && v.kind === "rational" && typeof v.p === "string" && typeof v.q === "string") {
    return Number(v.p) / Number(v.q);
  }
  if (typeof v === "number") return v;
  return null;
}

/** Build the evaluation environment for runtime values:
 *  every declared parameter at its default value + reserved symbol t. */
export function buildEnv(math: any, modelTime: number | null): Env {
  const env: Env = {};
  for (const p of math?.parameters ?? []) {
    const dv = exactToValueNumber(p?.default ?? p?.min);
    if (dv !== null) env[p.id] = { kind: "num", v: dv };
  }
  if (modelTime !== null) {
    env.t = { kind: "num", v: modelTime };
  }
  return env;
}

export function resolveSource(math: any, source: string, env: Env): unknown {
  const parsed = parseSource(source);
  switch (parsed.ns) {
    case "entity": {
      const e = (math?.entities ?? []).find((x: any) => x?.id === parsed.id);
      if (!e) throw makeRuntimeError("E_BINDING", `binding references missing entity '${parsed.id}'`);
      return walk(e.props ?? {}, parsed.path, `entity '${parsed.id}'`);
    }
    case "fact": {
      const f = [...(math?.source_facts ?? []), ...(math?.derived_facts ?? [])].find((x: any) => x?.fact_id === parsed.id);
      if (!f) throw makeRuntimeError("E_BINDING", `binding references missing fact '${parsed.id}'`);
      return walk(f, parsed.path, `fact '${parsed.id}'`);
    }
    case "param": {
      const p = (math?.parameters ?? []).find((x: any) => x?.id === parsed.id);
      if (!p) throw makeRuntimeError("E_BINDING", `binding references missing parameter '${parsed.id}'`);
      return walk(p, parsed.path, `param '${parsed.id}'`);
    }
    case "runtime": {
      const r = (math?.runtime_values ?? []).find((x: any) => x?.id === parsed.id);
      if (!r) throw makeRuntimeError("E_BINDING", `binding references missing runtime value '${parsed.id}'`);
      if (env.t === undefined && usesSymbolT(r.expr)) {
        return null; // presentation-only region: t-dependent value is unresolvable
      }
      const v = evalExpr(r.expr, env);
      const flat = v.kind === "exact" ? ratToNumber(v.r) : v.v;
      return parsed.path.length ? walk(flat, parsed.path, `runtime '${parsed.id}'`) : flat;
    }
    default:
      throw makeRuntimeError("E_BINDING", `unsupported binding namespace '${(parsed as any).ns}'`);
  }
}

function usesSymbolT(ast: any): boolean {
  if (!ast || typeof ast !== "object") return false;
  if (ast.t === "sym") return ast.name === "t";
  if (ast.t === "app") return (ast.args ?? []).some(usesSymbolT);
  if (ast.t === "num" && ast.v?.kind === "symbolic") return usesSymbolT(ast.v.expr);
  return false;
}
