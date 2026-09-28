// P5.3 freeze-r2 regression: FREEZE AUTHORITY IS COMMITTED GIT BLOB BYTES and
// must be invariant to checkout configuration. Provider-free; spawns git only.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { repoPrefix, readGitBlob, sha256GitBlob, FROZEN_PATHS } from "../packages/parser-benchmark/src/git-blob";
import { verifyFreezeV3, manifestDigest } from "../packages/parser-benchmark/src/freeze-v3";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const spec = (rel: string) => `HEAD:${repoPrefix()}${rel}`;

describe("P5.3 freeze-r2 git-blob authority", () => {
  it("blob bytes are invariant to core.autocrlf and core.eol", () => {
    const hashes = new Set<string>();
    for (const cfg of ["true", "false", "input"]) {
      hashes.add(sha(execFileSync("git", ["-c", `core.autocrlf=${cfg}`, "cat-file", "blob", spec(FROZEN_PATHS.policy)], { maxBuffer: 64 * 1024 * 1024 })));
    }
    for (const eol of ["crlf", "lf", "native"]) {
      hashes.add(sha(execFileSync("git", ["-c", `core.eol=${eol}`, "cat-file", "blob", spec(FROZEN_PATHS.policy)], { maxBuffer: 64 * 1024 * 1024 })));
    }
    expect(hashes.size).toBe(1);
    expect(hashes.has(sha256GitBlob("HEAD", FROZEN_PATHS.policy))).toBe(true);
  });

  it("dataset and policy index blobs equal their HEAD blobs (no pending semantic drift)", () => {
    for (const p of [FROZEN_PATHS.dataset, FROZEN_PATHS.policy]) {
      expect(sha256GitBlob(":", p)).toBe(sha256GitBlob("HEAD", p));
    }
  });

  it("manifest self-digest reproduces with the self field blanked", () => {
    const lock = JSON.parse(readGitBlob(":", FROZEN_PATHS.manifest).toString("utf8"));
    expect(lock.manifest_sha256).toBe(manifestDigest(lock));
  });

  it("verifyFreezeV3 validates the r2 manifest from index blobs without touching worktree bytes", () => {
    const lock = verifyFreezeV3({ rev: ":" });
    expect(lock.hash_authority).toBe("git-blob-bytes");
    expect(lock.manifest_revision).toBe(2);
    expect(lock.verified_dataset_blob_sha256).toBe(lock.dataset_sha256);
    expect(lock.verified_scoring_policy_blob_sha256).toBe(lock.scoring_policy_sha256);
  });
});
