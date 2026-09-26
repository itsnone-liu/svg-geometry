import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";

export const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCHEMA_DIR = path.join(ROOT, "packages", "contracts", "schemas");

export const SCHEMA_IDS = {
  math: "https://mathviz.dev/schemas/math/v1",
  scene: "https://mathviz.dev/schemas/scene/v1",
  timeline: "https://mathviz.dev/schemas/timeline/v1",
  registry: "https://mathviz.dev/schemas/capability-registry/v1",
  catalog: "https://mathviz.dev/schemas/error-catalog/v1",
  project: "https://mathviz.dev/schemas/project/v1"
} as const;

export type CaseKind = "math" | "scene" | "timeline" | "project";

const ajv = new Ajv2020({ allErrors: true, strict: false });

const SCHEMA_FILES = [
  "common.schema.json",
  "math.schema.json",
  "scene.schema.json",
  "timeline.schema.json",
  "capability-registry.schema.json",
  "error-catalog.schema.json",
  "project.schema.json"
];

for (const f of SCHEMA_FILES) {
  const doc = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));
  ajv.addSchema(doc);
}

export function validatorFor(kind: CaseKind) {
  const v = ajv.getSchema(SCHEMA_IDS[kind]);
  if (!v) throw new Error(`no validator registered for ${kind}`);
  return v;
}

export interface CapabilityEntry {
  id: string;
  domain: string;
  family: string;
  summary: string;
}

export interface ErrorEntry {
  code: string;
  family: string;
  stage: string;
  repairable: boolean;
  summary: string;
}

function readJson(rel: string): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

export const registryDoc = readJson("packages/contracts/registry/capabilities.v1.json");
export const catalogDoc = readJson("packages/contracts/errors/error-catalog.v1.json");

// Self-validation: registry and catalog must satisfy their own schemas, or the
// harness itself is broken. Hard fail loudly.
const regValidator = ajv.getSchema(SCHEMA_IDS.registry)!;
if (!regValidator(registryDoc)) {
  throw new Error("capability registry violates its own schema: " + JSON.stringify(regValidator.errors));
}
const catValidator = ajv.getSchema(SCHEMA_IDS.catalog)!;
if (!catValidator(catalogDoc)) {
  throw new Error("error catalog violates its own schema: " + JSON.stringify(catValidator.errors));
}

export const capabilities = new Map<string, CapabilityEntry>(
  registryDoc.capabilities.map((c: CapabilityEntry) => [c.id, c])
);

export const errorCodes = new Map<string, ErrorEntry>(
  catalogDoc.errors.map((e: ErrorEntry) => [e.code, e])
);

export const catalogFamilies: string[] = catalogDoc.families;

export interface FixtureCase {
  case_id: string;
  kind: CaseKind;
  expect: "pass" | "fail";
  expected_error_codes?: string[];
  doc: any;
}

export function loadCases(): FixtureCase[] {
  const valid = readJson("fixtures/p0_cases.valid.json");
  const invalid = readJson("fixtures/p0_cases.invalid.json");
  return [...valid.cases, ...invalid.cases];
}
