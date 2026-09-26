import { describe, it, expect } from "vitest";
import { loadCases, registryDoc, catalogDoc, capabilities, catalogFamilies, errorCodes } from "../packages/contracts/src/load";
import { runCase } from "../packages/contracts/src/gates";
import { canonicalSerialize, canonicalDigest, roundTripStable } from "../packages/contracts/src/serialize";

const cases = loadCases();
const valid = cases.filter(c => c.expect === "pass");
const invalid = cases.filter(c => c.expect === "fail");

describe("P0 acceptance: fixture counts", () => {
  it("has exactly 20 valid and 20 invalid fixtures", () => {
    expect(valid.length).toBe(20);
    expect(invalid.length).toBe(20);
  });

  it("covers all four document kinds", () => {
    const kinds = new Set(cases.map(c => c.kind));
    expect([...kinds].sort()).toEqual(["math", "project", "scene", "timeline"]);
  });
});

describe("P0 acceptance: 20 valid fixtures all PASS", () => {
  for (const c of valid) {
    it(`${c.case_id} passes all gates`, () => {
      const r = runCase(c);
      expect(r.errors, JSON.stringify(r.errors, null, 2)).toHaveLength(0);
      expect(r.ok).toBe(true);
    });
  }
});

describe("P0 acceptance: 20 invalid fixtures FAIL on expected error codes", () => {
  for (const c of invalid) {
    it(`${c.case_id} fails with [${c.expected_error_codes?.join(",")}]`, () => {
      const r = runCase(c);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.ok).toBe(true); // expectation matched
      for (const code of c.expected_error_codes ?? []) {
        expect(r.emitted_error_codes).toContain(code);
      }
    });
  }
});

describe("P0 acceptance: serialize -> deserialize -> serialize byte-stable", () => {
  it("round-trips every fixture document", () => {
    for (const c of cases) {
      expect(roundTripStable(c.doc), `case ${c.case_id}`).toBe(true);
    }
  });

  it("canonicalizes key order deterministically (known vector)", () => {
    expect(canonicalSerialize({ b: 1, a: { d: [2, 1], c: "x" } })).toBe('{"a":{"c":"x","d":[2,1]},"b":1}');
  });

  it("digests are stable across recomputation", () => {
    for (const c of cases) {
      expect(canonicalDigest(c.doc)).toBe(canonicalDigest(JSON.parse(canonicalSerialize(c.doc))));
    }
  });
});

describe("P0 acceptance: named hard criteria", () => {
  it("any unknown capability -> E_CAPABILITY_UNSUPPORTED", () => {
    const r = runCase(invalid.find(c => c.case_id === "inv-unknown-capability")!);
    expect(r.emitted_error_codes).toContain("E_CAPABILITY_UNSUPPORTED");
  });

  it("any source fact without provenance -> FAIL (E_PROVENANCE)", () => {
    const r = runCase(invalid.find(c => c.case_id === "inv-source-fact-no-provenance")!);
    expect(r.ok).toBe(true);
    expect(r.emitted_error_codes).toContain("E_PROVENANCE");
  });

  it("any Scene reference to nonexistent math binding -> FAIL (E_BINDING)", () => {
    const r = runCase(invalid.find(c => c.case_id === "inv-project-scene-dangling-binding")!);
    expect(r.ok).toBe(true);
    expect(r.emitted_error_codes).toContain("E_BINDING");
  });
});

describe("P0 acceptance: catalog and registry integrity", () => {
  it("catalog has at least the 7 required families", () => {
    for (const f of ["SCHEMA", "CAPABILITY", "SOLVE", "ASSERTION", "BINDING", "LAYOUT", "RENDER"]) {
      expect(catalogFamilies).toContain(f);
    }
  });

  it("every error references a declared family; codes unique", () => {
    const codes = new Set<string>();
    for (const e of catalogDoc.errors) {
      expect(catalogFamilies).toContain(e.family);
      expect(codes.has(e.code)).toBe(false);
      codes.add(e.code);
    }
  });

  it("registry ids are unique and pattern-stable", () => {
    const ids = registryDoc.capabilities.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^(geometry2d|function2d|motion1d)\.[a-z][a-z0-9_]*$/);
    }
  });

  it("registry contains the user-pinned literal IDs", () => {
    expect(capabilities.has("geometry2d.rotate_point")).toBe(true);
    expect(capabilities.has("motion1d.meeting_event")).toBe(true);
  });

  it("harness never emits codes outside the catalog (spot: all invalid fixtures)", () => {
    for (const c of invalid) {
      const r = runCase(c);
      for (const code of r.emitted_error_codes) {
        expect(errorCodes.has(code), code).toBe(true);
      }
    }
  });
});
