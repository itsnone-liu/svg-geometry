// P5.3 v4 freeze blob-authority regression. The manifest never self-hashes;
// its outer identity is the freeze commit. Authority = committed Git blob
// bytes read via `git cat-file`, invariant to core.autocrlf / core.eol.
import { describe, it, expect } from "vitest";
import { verifyFreezeV4, buildV4Manifest, deriveV4Denominators, gitBlobOid, V4_AUTHORITY_GROUPS, V4_MANIFEST_PATH, V4_DATASET_PATH } from "../packages/parser-benchmark/src/freeze-v4";
import { readGitBlob } from "../packages/parser-benchmark/src/git-blob";

const REV = process.env.V4_FREEZE_TEST_REV ?? ":";
const datasetBlobOid = gitBlobOid(REV, V4_DATASET_PATH);
const manifestBlob = readGitBlob(REV, V4_MANIFEST_PATH).toString("utf8");

describe("P5.3 v4 freeze blob authority", () => {
  it("manifest exists, is blob-readable, and never self-hashes", () => {
    const manifest = JSON.parse(manifestBlob);
    expect(manifest.hash_authority).toBe("git-blob-bytes");
    expect(manifest.benchmark_version).toBe(4);
    expect("manifest_sha256" in manifest).toBe(false);
    expect(manifest.max_repairs).toBe(1);
  });

  it("dataset blob OID is the remote-audited fce7be001c72079b22b62bf6f066a3ccf35d3c56", () => {
    expect(datasetBlobOid).toBe("fce7be001c72079b22b62bf6f066a3ccf35d3c56");
  });

  it("verifyFreezeV4 re-derives every recorded blob identity from raw git blobs", () => {
    const verified = verifyFreezeV4({ rev: REV });
    expect(verified.authority_file_count).toBe(V4_AUTHORITY_GROUPS.reduce((n, g) => n + g.paths.length, 0));
  }, 120_000);

  it("denominators derive from the dataset blob as 72 / 64+6+2 / 70 / 15=11+2+2 / 9", () => {
    const dataset = JSON.parse(readGitBlob(REV, V4_DATASET_PATH).toString("utf8"));
    const { denominators, ok } = deriveV4Denominators(dataset);
    expect(ok).toBe(true);
    expect(denominators.case_count).toBe(72);
    expect(denominators.class_counts).toEqual({ COMPILE_OK: 64, ENGINE_UNSUPPORTED: 6, KNOWN_LIMITATION_EXPECTED_REJECT: 2 });
    expect(denominators.goal_capability_eligible).toBe(70);
    expect(denominators.dual_all).toBe(15);
    expect(denominators.dual_compile_ok).toBe(11);
    expect(denominators.dual_engine_unsupported).toBe(2);
    expect(denominators.dual_known_limitation).toBe(2);
    expect(denominators.bare_equation_controls).toBe(9);
  });

  it("prompt policy is frozen base p5.3-policy-v1 plus the v4 overlay blob", () => {
    const manifest = JSON.parse(manifestBlob);
    expect(manifest.prompt_policy_version).toBe("p5.3-policy-v1");
    const overlayEntry = manifest.authority.groups.find((g: any) => g.group === "V4_PARSER").files.find((f: any) => f.path === manifest.prompt_v4_overlay_path);
    expect(overlayEntry?.git_blob_oid).toMatch(/^[0-9a-f]{40}$/);
  });

  it("generator output is reproducible against the committed manifest authority", () => {
    const committed = JSON.parse(manifestBlob);
    const rebuilt = buildV4Manifest(REV);
    expect(JSON.stringify(rebuilt.authority)).toBe(JSON.stringify(committed.authority));
    expect(rebuilt.construction_provenance_not_authority.paths).toContain("scripts/generate-v4-fixtures.mjs");
    expect(rebuilt.evidence_not_authority.paths).toContain("runs/p53/v4-c1-audit.json");
  }, 120_000);
});
