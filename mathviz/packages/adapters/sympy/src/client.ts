// Node-side SymPy oracle client. Spawn-once, persistent JSON Lines session.
// Node-only: this module (and everything in packages/adapters/sympy) must
// NEVER be imported by the browser bundle — the freeze runner is its only
// consumer, enforced by simply not referencing it from any browser entry.

import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { makeRuntimeError } from "../../../runtime/src/errors";
import { PINNED_SYMPY_VERSION, SYMPY_PROTOCOL } from "./version";
import type { SympyResponse, SympyRequest } from "./protocol";

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "python", "worker.py");

const DEFAULT_CANDIDATES = ["python", "python3"];

export class SympyClient {
  private proc: ChildProcess | null = null;
  private pending = new Map<string, { resolve: (r: SympyResponse) => void; reject: (e: Error) => void }>();
  private reqSeq = 0;
  private _version: string | null = null;
  readonly pythonPath: string;

  private constructor(pythonPath: string) {
    this.pythonPath = pythonPath;
  }

  /** Try each candidate interpreter (MATHVIZ_PYTHON wins). Throws on total failure. */
  static async connect(timeoutMs = 20000): Promise<SympyClient> {
    const env = process.env.MATHVIZ_PYTHON;
    const candidates = env ? [env, ...DEFAULT_CANDIDATES] : DEFAULT_CANDIDATES;
    const tried: string[] = [];
    for (const py of candidates) {
      try {
        const c = new SympyClient(py);
        await c.start(timeoutMs);
        const pong = await c.request("ping", {}, timeoutMs);
        if (!pong.ok) {
          tried.push(`${py}: ${pong.error.message}`);
          c.kill();
          continue;
        }
        if (pong.sympy_version !== PINNED_SYMPY_VERSION) {
          // freeze-relevant: worker itself refused or version drift — surface
          // as E_CAPABILITY_UNSUPPORTED so the gate reports INCOMPLETE
          tried.push(`${py}: sympy ${pong.sympy_version} != pinned ${PINNED_SYMPY_VERSION}`);
          c.kill();
          continue;
        }
        c._version = pong.sympy_version;
        return c;
      } catch (e: any) {
        tried.push(`${py}: ${e?.message ?? e}`);
      }
    }
    throw makeRuntimeError(
      "E_CAPABILITY_UNSUPPORTED",
      `no usable python+sympy==${PINNED_SYMPY_VERSION} worker (tried: ${tried.join(" | ")})`
    );
  }

  private start(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, [WORKER_PATH], { stdio: ["pipe", "pipe", "pipe"] });
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        proc.kill();
        this.proc = null;
        reject(new Error(msg));
      };
      proc.on("error", (e) => fail(`spawn '${this.pythonPath}' failed: ${e.message}`));
      proc.on("exit", (code, signal) => {
        const msg = `worker exited (code=${code} signal=${signal})`;
        if (!settled) {
          fail(msg);
          return;
        }
        for (const [, p] of this.pending) p.reject(new Error(msg));
        this.pending.clear();
        this.proc = null;
      });
      proc.on("spawn", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.proc = proc;
        resolve();
      });
      timer = setTimeout(() => fail(`worker startup timeout after ${timeoutMs}ms`), timeoutMs);
      const rl = createInterface({ input: proc.stdout! });
      rl.on("line", (line) => {
        try {
          const resp: SympyResponse = JSON.parse(line);
          const id = resp.request_id ?? null;
          if (id !== null) {
            const p = this.pending.get(id);
            if (p) {
              this.pending.delete(id);
              p.resolve(resp);
            }
          } else if (resp.ok === false && this.pending.size > 0) {
            // version-refusal banner: fail every pending request
            for (const [, p] of this.pending) p.reject(new Error(resp.error?.message ?? "worker refused"));
            this.pending.clear();
          }
        } catch {
          this.kill();
        }
      });
      proc.stderr!.on("data", () => { /* logs are noise; keep stdout clean-only */ });
    });
  }

  get version(): string {
    return this._version ?? PINNED_SYMPY_VERSION;
  }

  request(op: string, payload: Record<string, unknown>, timeoutMs = 30000): Promise<SympyResponse> {
    if (!this.proc || this.proc.killed) {
      return Promise.reject(new Error("sympy worker is not running"));
    }
    const req: SympyRequest = {
      protocol: SYMPY_PROTOCOL,
      request_id: `req-${(++this.reqSeq).toString().padStart(4, "0")}-${randomUUID().slice(0, 8)}`,
      op,
      payload
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.request_id);
        reject(new Error(`op '${op}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(req.request_id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.proc!.stdin!.write(JSON.stringify(req) + "\n", (err) => {
        if (err) {
          this.pending.delete(req.request_id);
          clearTimeout(timer);
          reject(new Error(`write failed: ${err.message}`));
        }
      });
    });
  }

  kill(): void {
    this.proc?.kill();
    this.proc = null;
  }
}
