// Wire types for mathviz.sympy/v1 (JSON Lines over the worker's stdio).
// Results are MathViz values ONLY (ExactNumber / ExprAst / FiniteSolutionSet
// / extrema list) — Python repr strings never cross the wire as data.

export type ExactNumberJson =
  | { kind: "int"; value: string }
  | { kind: "rational"; p: string; q: string }
  | { kind: "symbolic"; expr: any };

export interface FiniteSolutionSet {
  kind: "finite_set";
  values: ExactNumberJson[];
}

export interface ExtremaList {
  kind: "extrema_list";
  points: Array<{ x: ExactNumberJson; y: ExactNumberJson; type: "min" | "max" | "flat" }>;
}

export interface SympyRequest {
  protocol: string;
  request_id: string;
  op: string;
  payload: Record<string, unknown>;
}

export interface SympyOk {
  protocol: string;
  request_id: string;
  ok: true;
  sympy_version: string;
  result: unknown;
}

export interface SympyErr {
  protocol?: string;
  request_id?: string | null;
  ok: false;
  error: { code: string; message: string };
}

export type SympyResponse = SympyOk | SympyErr;
