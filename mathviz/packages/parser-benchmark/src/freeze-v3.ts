// P5.3 benchmark v3/r2 freeze verifier. FREEZE AUTHORITY = COMMITTED GIT BLOB
// BYTES (`git cat-file blob <rev>:<path>`), never worktree files. Worktree
// EOL under core.autocrlf is audit-only. The v2 freeze in ./freeze.ts is
// deliberately untouched historical surface.
import { createHash } from "node:crypto";
import { FROZEN_PATHS, IDENTITY_PATHS, PROMPT_PATH, readGitBlob, sha256GitBlob, resolveCommitish, worktreeClean, isAncestorOfHead } from "./git-blob";

export function manifestDigest(lock: any): string {
  return createHash("sha256").update(JSON.stringify({ ...lock, manifest_sha256: "" }, null, 2) + "\n").digest("hex");
}

export interface FreezeV3Options {
  /** commit-ish whose blobs are authoritative; ":" = staged index. Default HEAD. */
  rev?: string;
  /** additionally require a clean worktree and that the freeze commit is HEAD or an ancestor of HEAD. */
  requireClean?: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function verifyFreezeV3(options: FreezeV3Options = {}): any {
  const rev = options.rev ?? "HEAD";
  const commit = resolveCommitish(rev === ":" ? "HEAD" : rev);
  const lock = JSON.parse(readGitBlob(rev, FROZEN_PATHS.manifest).toString("utf8"));
  const ds = JSON.parse(readGitBlob(rev, FROZEN_PATHS.dataset).toString("utf8"));
  if (lock.hash_authority !== "git-blob-bytes") throw new Error("P5.3 freeze manifest is not in git-blob-bytes authority form");
  if (lock.dataset_version !== 3 || lock.case_count !== 72 || ds.version !== 3 || ds.cases?.length !== 72) throw new Error("P5.3 freeze version/count mismatch");
  if (lock.freeze_revision !== "v3.1" || lock.manifest_revision !== 2) throw new Error("P5.3 freeze manifest revision mismatch");
  const datasetHash = sha256GitBlob(rev, FROZEN_PATHS.dataset);
  const policyHash = sha256GitBlob(rev, FROZEN_PATHS.policy);
  if (lock.dataset_sha256 !== datasetHash) throw new Error(`P5.3 dataset blob freeze mismatch: expected ${lock.dataset_sha256}, got ${datasetHash}`);
  if (lock.scoring_policy_sha256 !== policyHash) throw new Error(`P5.3 scoring policy blob freeze mismatch: expected ${lock.scoring_policy_sha256}, got ${policyHash}`);
  for (const [key, rel] of Object.entries(IDENTITY_PATHS)) {
    const expected = lock.implementation_identities?.[key];
    if (typeof expected !== "string" || !HEX64.test(expected)) throw new Error(`P5.3 implementation identity field malformed: ${key}`);
    const actual = sha256GitBlob(rev, rel);
    if (expected !== actual) throw new Error(`P5.3 implementation identity mismatch: ${key} expected ${expected}, got ${actual}`);
  }
  if (lock.manifest_sha256 !== manifestDigest(lock)) throw new Error("P5.3 manifest self-check mismatch");
  const promptVersion = /PROMPT_POLICY_VERSION\s*=\s*["']([^"']+)["']/.exec(readGitBlob(rev, PROMPT_PATH).toString("utf8"))?.[1] ?? null;
  if (promptVersion !== lock.prompt_policy_version) throw new Error(`P5.3 prompt policy version mismatch: manifest ${lock.prompt_policy_version}, blob ${promptVersion}`);
  if (options.requireClean) {
    if (!worktreeClean()) throw new Error("P5.3 freeze verification requires a clean worktree");
    if (commit && !isAncestorOfHead(commit)) throw new Error(`P5.3 freeze commit ${commit} is not HEAD or an ancestor of HEAD`);
  }
  return { ...lock, verified_rev: rev, verified_freeze_commit: commit, verified_dataset_blob_sha256: datasetHash, verified_scoring_policy_blob_sha256: policyHash };
}

if (require.main === module) {
  const lock = verifyFreezeV3();
  console.log(`P5.3 freeze verified (git-blob authority, rev=${lock.verified_rev}, commit=${lock.verified_freeze_commit}): dataset=${lock.dataset_sha256}; policy=${lock.scoring_policy_sha256}; cases=${lock.case_count}`);
}
