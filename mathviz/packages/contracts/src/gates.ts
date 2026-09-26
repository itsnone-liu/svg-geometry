import { validatorFor, capabilities, errorCodes, type CaseKind, type FixtureCase } from "./load";
import { canonicalSerialize } from "./serialize";

export interface VizError {
  code: string;
  family: string;
  stage: string;
  path?: string;
  message: string;
  repairable: boolean;
  details?: unknown;
}

/** Emitting a code that is not in the frozen catalog is a harness bug: hard throw. */
export function makeError(code: string, message: string, details?: unknown, path?: string): VizError {
  const meta = errorCodes.get(code);
  if (!meta) throw new Error(`internal error: emitted code not in catalog: ${code}`);
  const e: VizError = {
    code,
    family: meta.family,
    stage: meta.stage,
    message,
    repairable: meta.repairable
  };
  if (path !== undefined) e.path = path;
  if (details !== undefined) e.details = details;
  return e;
}

export interface GateStatus {
  gate: string;
  status: "PASS" | "FAIL" | "SKIP";
}

export interface CaseResult {
  case_id: string;
  kind: CaseKind;
  expect: "pass" | "fail";
  expected_error_codes: string[];
  emitted_error_codes: string[];
  errors: VizError[];
  gates: GateStatus[];
  digest: string;
  ok: boolean;
}

// ---------- helpers ----------

function exactToNumber(v: any): number | null {
  if (!v || typeof v !== "object" || typeof v.kind !== "string") return null;
  if (v.kind === "int") return Number(v.value);
  if (v.kind === "rational") return Number(v.p) / Number(v.q);
  return null; // symbolic: not orderable in P0
}

function collectMathIds(math: any) {
  const entities = new Set<string>();
  const facts = new Set<string>();
  const params = new Set<string>();
  const runtime = new Set<string>();
  for (const e of math?.entities ?? []) if (typeof e?.id === "string") entities.add(e.id);
  for (const f of math?.source_facts ?? []) if (typeof f?.fact_id === "string") facts.add(f.fact_id);
  for (const f of math?.derived_facts ?? []) if (typeof f?.fact_id === "string") facts.add(f.fact_id);
  for (const r of math?.runtime_values ?? []) if (typeof r?.id === "string") runtime.add(r.id);
  for (const p of math?.parameters ?? []) if (typeof p?.id === "string") params.add(p.id);
  return { entities, facts, params, runtime };
}

export function resolveMathRef(ref: string, ids: ReturnType<typeof collectMathIds>): boolean {
  const m = /^(entity|fact|param|runtime):([A-Za-z_][A-Za-z0-9_-]*)$/.exec(ref ?? "");
  if (!m) return false;
  switch (m[1]) {
    case "entity": return ids.entities.has(m[2]);
    case "fact": return ids.facts.has(m[2]);
    case "param": return ids.params.has(m[2]);
    case "runtime": return ids.runtime.has(m[2]);
    default: return false;
  }
}

// ---------- G1: schema + structural well-formedness ----------

export function gateSchema(doc: any, kind: CaseKind): VizError[] {
  const errs: VizError[] = [];
  const v = validatorFor(kind);
  if (!v(doc)) {
    for (const e of v.errors ?? []) {
      errs.push(
        makeError(
          "E_SCHEMA",
          `${e.keyword} ${e.message ?? "schema violation"}`,
          { keyword: e.keyword, params: e.params },
          e.instancePath || undefined
        )
      );
    }
  }

  const math = kind === "math" ? doc : kind === "project" ? doc?.math : undefined;
  if (math && typeof math === "object") {
    // duplicate ids across all id namespaces
    const seen = new Set<string>();
    const dup = new Set<string>();
    const groups: string[][] = [
      (math.entities ?? []).map((x: any) => x?.id).filter(Boolean),
      (math.source_facts ?? []).map((x: any) => x?.fact_id).filter(Boolean),
      (math.derived_facts ?? []).map((x: any) => x?.fact_id).filter(Boolean),
      (math.runtime_values ?? []).map((x: any) => x?.id).filter(Boolean),
      (math.parameters ?? []).map((x: any) => x?.id).filter(Boolean)
    ];
    for (const g of groups) for (const id of g) { if (seen.has(id)) dup.add(id); seen.add(id); }
    for (const d of dup) {
      errs.push(makeError("E_SCHEMA", `duplicate id in Math IR: ${d}`, undefined, `/${d}`));
    }
    // parameter ranges
    for (const p of math.parameters ?? []) {
      const min = exactToNumber(p?.min);
      const max = exactToNumber(p?.max);
      if (min !== null && max !== null && max < min) {
        errs.push(makeError("E_MATH_CONSTRAINT", `parameter ${p?.id}: max < min (${max} < ${min})`));
      }
    }
  }

  const timeline = kind === "timeline" ? doc : kind === "project" ? doc?.timeline : undefined;
  if (timeline && typeof timeline === "object") {
    const trackIds = new Set<string>();
    for (const tr of timeline.tracks ?? []) {
      if (typeof tr?.track_id === "string") {
        if (trackIds.has(tr.track_id)) {
          errs.push(makeError("E_SCHEMA", `duplicate timeline track id: ${tr.track_id}`));
        }
        trackIds.add(tr.track_id);
      }
      for (const a of tr?.actions ?? []) {
        if (a?.kind === "map_model_time" && !(a.to > a.from)) {
          errs.push(makeError("E_SCHEMA", `track ${tr?.track_id}: map_model_time requires to > from (got from=${a.from}, to=${a.to})`));
        }
      }
    }
  }

  return errs;
}

// ---------- G2: provenance ----------

export function gateProvenance(math: any): VizError[] {
  const errs: VizError[] = [];
  const ids = collectMathIds(math);

  for (const f of math?.source_facts ?? []) {
    const fid = f?.fact_id ?? "<unnamed>";
    const p = f?.provenance;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      errs.push(makeError("E_PROVENANCE", `source fact '${fid}' has no provenance`, undefined, `/source_facts/${fid}`));
      continue;
    }
    if (p.kind !== "problem_text") {
      errs.push(makeError("E_PROVENANCE", `source fact '${fid}' provenance kind must be 'problem_text' (got '${p.kind}')`, undefined, `/source_facts/${fid}`));
      continue;
    }
    const span = p.span;
    const textOk = span && typeof span.text === "string" && span.text.length > 0;
    const startOk = span && Number.isInteger(span.start) && span.start >= 0;
    const endOk = span && Number.isInteger(span.end) && span.end > 0;
    if (!textOk || !startOk || !endOk || span.end <= span.start) {
      errs.push(makeError("E_PROVENANCE", `source fact '${fid}' has invalid span (need text + start>=0 + end>start)`, span, `/source_facts/${fid}`));
    }
  }

  for (const f of math?.derived_facts ?? []) {
    const fid = f?.fact_id ?? "<unnamed>";
    const p = f?.provenance;
    if (!p || typeof p !== "object" || p.kind !== "derived") {
      errs.push(makeError("E_PROVENANCE", `derived fact '${fid}' provenance kind must be 'derived'`, undefined, `/derived_facts/${fid}`));
      continue;
    }
    const cap = capabilities.get(p.capability_id);
    if (!cap) {
      errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `derived fact '${fid}' cites unknown capability '${p.capability_id}'`));
    }
    const inputs = Array.isArray(p.inputs) ? p.inputs : [];
    if (inputs.length === 0) {
      errs.push(makeError("E_PROVENANCE", `derived fact '${fid}' has no inputs`));
    }
    for (const ref of inputs) {
      if (typeof ref !== "string" || !resolveMathRef(ref, ids)) {
        errs.push(makeError("E_PROVENANCE", `derived fact '${fid}' provenance input does not resolve: '${ref}'`));
      }
    }
  }

  return errs;
}

// ---------- G3: capability registry ----------

export function gateCapability(math: any): VizError[] {
  const errs: VizError[] = [];
  const domain = math?.domain;

  for (const id of math?.capabilities ?? []) {
    const entry = capabilities.get(id);
    if (!entry) {
      errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `capability not in frozen registry: '${id}'`));
    } else if (typeof domain === "string" && entry.domain !== domain) {
      errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `capability '${id}' belongs to ${entry.domain}, spec domain is ${domain}`));
    }
  }

  const used: Array<[string, string]> = [];
  for (const c of math?.constraints ?? []) used.push([c?.capability_id, "constraint"]);
  for (const a of math?.assertions ?? []) used.push([a?.capability_id, "assertion"]);
  for (const ev of math?.events ?? []) used.push([ev?.capability_id, "event"]);
  for (const [id, where] of used) {
    const entry = capabilities.get(id);
    if (!entry) {
      errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `${where} cites capability not in frozen registry: '${id}'`));
    } else if (typeof domain === "string" && entry.domain !== domain) {
      errs.push(makeError("E_CAPABILITY_UNSUPPORTED", `${where} capability '${id}' belongs to ${entry.domain}, spec domain is ${domain}`));
    }
  }

  return errs;
}

// ---------- G6: binding / reference resolution ----------
// Covers scene->math bindings, scene attach_to, top-level binding targets,
// timeline targets, AND math-internal references (constraint/assertion/event
// subjects, runtime depends_on). All dangling references FAIL with E_BINDING.

export function gateBinding(scene: any, math?: any, timeline?: any): VizError[] {
  const errs: VizError[] = [];

  // math-internal reference integrity (independent of scene presence)
  if (math && typeof math === "object") {
    const ids = collectMathIds(math);
    const check = (ref: unknown, where: string): void => {
      if (typeof ref !== "string") return; // shape is a schema concern
      if (!resolveMathRef(ref, ids)) {
        errs.push(makeError("E_BINDING", `${where} references missing math object: '${ref}'`));
      }
    };
    for (const c of math.constraints ?? []) {
      for (const ref of c?.subject_refs ?? []) check(ref, `constraint '${c?.capability_id}'`);
    }
    for (const a of math.assertions ?? []) {
      for (const ref of a?.subject_refs ?? []) check(ref, `assertion '${a?.assertion_id}'`);
    }
    for (const ev of math.events ?? []) {
      for (const ref of ev?.participants ?? []) check(ref, `event '${ev?.event_id}'`);
    }
    for (const r of math.runtime_values ?? []) {
      for (const ref of r?.depends_on ?? []) check(ref, `runtime '${r?.id}' depends_on`);
    }
  }

  if (!scene || typeof scene !== "object") return errs;

  const objectIds = new Set<string>();
  for (const o of scene.objects ?? []) if (typeof o?.objectId === "string") objectIds.add(o.objectId);

  const ids = math ? collectMathIds(math) : undefined;
  const checkSource = (source: unknown, where: string): void => {
    if (typeof source !== "string") return; // schema already flags shape
    const m = /^math:(entity|fact|param|runtime):([A-Za-z_][A-Za-z0-9_-]*)/.exec(source);
    if (!m) return; // malformed source is a schema error, not binding
    if (!ids) return; // no math context (scene-only fixture): cannot resolve
    const ok =
      m[1] === "entity" ? ids.entities.has(m[2]) :
      m[1] === "fact" ? ids.facts.has(m[2]) :
      m[1] === "param" ? ids.params.has(m[2]) :
      ids.runtime.has(m[2]);
    if (!ok) {
      errs.push(makeError("E_BINDING", `${where} references missing math object: '${source}'`, undefined, where));
    }
  };

  for (const o of scene.objects ?? []) {
    const oid = o?.objectId ?? "<unnamed>";
    checkSource(o?.binding?.source, `object '${oid}'.binding`);
    for (const a of o?.attach_to ?? []) {
      if (typeof a === "string" && !objectIds.has(a)) {
        errs.push(makeError("E_BINDING", `object '${oid}' attach_to missing object: '${a}'`));
      }
    }
  }

  for (const b of scene.bindings ?? []) {
    const oid = b?.objectId;
    if (typeof oid === "string" && !objectIds.has(oid)) {
      errs.push(makeError("E_BINDING", `top-level binding targets missing object: '${oid}'`));
    }
    checkSource(b?.source, `binding('${oid ?? "?"}').source`);
  }

  if (timeline && typeof timeline === "object") {
    for (const tr of timeline.tracks ?? []) {
      for (const a of tr?.actions ?? []) {
        if ((a?.kind === "show" || a?.kind === "hide" || a?.kind === "highlight" || a?.kind === "dim") &&
            typeof a?.target === "string" && !objectIds.has(a.target)) {
          errs.push(makeError("E_BINDING", `timeline track '${tr?.track_id}' action targets missing object: '${a.target}'`));
        }
        if (a?.kind === "camera" && typeof a?.center_on === "string" && !a.center_on.startsWith("math:") &&
            !objectIds.has(a.center_on)) {
          errs.push(makeError("E_BINDING", `camera center_on missing object: '${a.center_on}'`));
        }
      }
    }
  }

  return errs;
}

// ---------- G9: determinism (serialization round-trip) ----------

export function gateDeterminism(doc: any): VizError[] {
  try {
    const once = canonicalSerialize(doc);
    const twice = canonicalSerialize(JSON.parse(once));
    if (once !== twice) {
      return [makeError("E_NONDETERMINISTIC", "serialize -> deserialize -> serialize is not byte-stable")];
    }
    return [];
  } catch (e) {
    return [makeError("E_NONDETERMINISTIC", `canonical serialization threw: ${(e as Error).message}`)];
  }
}

// ---------- case runner ----------

export function runCase(c: FixtureCase): CaseResult {
  const errors: VizError[] = [];
  const gates: GateStatus[] = [];
  const push = (name: string, errs: VizError[], applicable: boolean) => {
    if (!applicable) {
      gates.push({ gate: name, status: "SKIP" });
      return;
    }
    errors.push(...errs);
    gates.push({ gate: name, status: errs.length === 0 ? "PASS" : "FAIL" });
  };

  const math = c.kind === "math" ? c.doc : c.kind === "project" ? c.doc?.math : undefined;
  const scene = c.kind === "scene" ? c.doc : c.kind === "project" ? c.doc?.scene : undefined;
  const timeline = c.kind === "timeline" ? c.doc : c.kind === "project" ? c.doc?.timeline : undefined;

  push("G1_schema", gateSchema(c.doc, c.kind), true);
  push("G2_provenance", math ? gateProvenance(math) : [], !!math);
  push("G3_capability", math ? gateCapability(math) : [], !!math);
  const bindingApplicable = !!(scene || math);
  push("G6_binding", bindingApplicable ? gateBinding(scene, math, timeline) : [], bindingApplicable);
  push("G9_determinism", gateDeterminism(c.doc), true);

  const emitted = [...new Set(errors.map(e => e.code))];
  const expected = c.expected_error_codes ?? [];
  let ok: boolean;
  if (c.expect === "pass") {
    ok = errors.length === 0;
  } else {
    ok = errors.length > 0 && expected.every(code => emitted.includes(code));
  }

  return {
    case_id: c.case_id,
    kind: c.kind,
    expect: c.expect,
    expected_error_codes: expected,
    emitted_error_codes: emitted,
    errors,
    gates,
    digest: "",
    ok
  };
}
