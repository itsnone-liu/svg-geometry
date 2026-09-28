// Git blob access helpers — the P5.3 r2 freeze AUTHORITY.
//
// r2 lesson (2026-09-28): with system-level core.autocrlf=true, Windows
// worktree bytes are a smudged representation and one checkout path was even
// observed writing CRLF despite eol=lf attributes. Acceptance therefore never
// hashes worktree files: every frozen artifact is read from a committed (or
// staged-index) Git blob via `git cat-file`, whose bytes are invariant to
// core.autocrlf / core.eol. Worktree EOL remains audit-only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ROOT } from "../../contracts/src/load";

export const FROZEN_PATHS = {
  dataset: "fixtures/parser-bench-v3/cases.json",
  policy: "docs/P5_3_SCORING_POLICY.md",
  manifest: "fixtures/parser-bench-v3/freeze-v3.json",
} as const;

export const IDENTITY_PATHS = {
  g19_sha256: "packages/parser/src/grounding.ts",
  g20_sha256: "packages/parser/src/fidelity.ts",
  pipeline_sha256: "packages/parser/src/parse.ts",
} as const;

export const PROMPT_PATH = "packages/parser/src/prompt.ts";
export const PACKAGE_PATH = "package.json";
export const PIN_PATH = "fixtures/parser-bench-v3/live-pin-r2.json";
export const PROTOCOL_DOC_PATH = "docs/P5_3_LIVE_PROTOCOL_BLOB_R2.md";

const MAX = 64 * 1024 * 1024;

function gitRaw(args: string[]): { status: number | null; stdout: Buffer; stderr: string } {
  const r = spawnSync("git", args, { cwd: ROOT, maxBuffer: MAX, windowsHide: true });
  return { status: r.status, stdout: Buffer.from(r.stdout ?? Buffer.alloc(0)), stderr: (r.stderr ?? Buffer.alloc(0)).toString("utf8") };
}

export function gitText(args: string[]): string {
  const r = gitRaw(args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim() || `exit ${r.status}`}`);
  return r.stdout.toString("utf8");
}

export function repoPrefix(): string {
  return gitText(["rev-parse", "--show-prefix"]).trim();
}

/** rev "" or ":" means the staged index; otherwise a commit-ish such as HEAD or a sha. */
export function blobSpec(rev: string, relPath: string): string {
  const prefix = repoPrefix();
  return !rev || rev === ":" ? `:${prefix}${relPath}` : `${rev}:${prefix}${relPath}`;
}

export function readGitBlob(rev: string, relPath: string): Buffer {
  const r = gitRaw(["cat-file", "blob", blobSpec(rev, relPath)]);
  if (r.status !== 0) throw new Error(`cannot read git blob ${blobSpec(rev, relPath)}: ${r.stderr.trim() || `exit ${r.status}`}`);
  return r.stdout;
}

export function blobExists(rev: string, relPath: string): boolean {
  return gitRaw(["cat-file", "-e", blobSpec(rev, relPath)]).status === 0;
}

export function sha256GitBlob(rev: string, relPath: string): string {
  return createHash("sha256").update(readGitBlob(rev, relPath)).digest("hex");
}

export function resolveCommitish(commitish: string): string | null {
  const r = gitRaw(["rev-parse", "--verify", `${commitish}^{commit}`]);
  return r.status === 0 ? r.stdout.toString("utf8").trim() : null;
}

export function worktreeClean(): boolean {
  return gitText(["status", "--porcelain"]).trim() === "";
}

/** true when worktree bytes differ from the staged index for any given path. */
export function hasUnstagedChanges(relPaths: string[]): boolean {
  return gitRaw(["diff", "--quiet", "--", ...relPaths]).status !== 0;
}

export function isAncestorOfHead(commit: string): boolean {
  return gitRaw(["merge-base", "--is-ancestor", commit, "HEAD"]).status === 0;
}
