// CompiledRuntime + PlayerController.
//
// THE core P1 invariant lives here: stateAt(presentationTime) is a PURE
// function of (frozen project, time). It never reads the wall clock, never
// reads Math.random or the DOM, and never carries state from a previous call.
// seek / play / pause / setFrame are thin wrappers over the same evaluator:
//   setFrame(n) === stateAt(n / fps)   (the ONLY frame formula, frame from 0)
// The player's wall-clock advance only decides WHICH time to evaluate.

import { CompiledRuntime, PlayerController, RuntimeState } from "./types";
import { makeRuntimeError } from "./errors";
import { loadProject, LoadedProject } from "./load-project";
import { stateAt } from "./scene/state-at";

export function loadRuntime(doc: any): CompiledRuntime {
  const p: LoadedProject = loadProject(doc);

  const stateAtTime = (t: number): RuntimeState => {
    const clamped = Math.min(Math.max(t, 0), p.duration); // deterministic clamp
    return stateAt(p.math, p.scene, p.compiled, clamped);
  };

  const maxFrame = Math.floor(p.duration * p.fps);

  const runtime: CompiledRuntime = {
    projectDigest: p.projectDigest,
    duration: p.duration,
    fps: p.fps,
    stateAt: stateAtTime,
    stateAtFrame(frame: number): RuntimeState {
      if (!Number.isInteger(frame) || frame < 0 || frame > maxFrame) {
        throw makeRuntimeError("E_SCHEMA", `frame out of range: ${frame} (valid 0..${maxFrame})`);
      }
      // frozen formula — the ONLY frame evaluator
      return stateAtTime(frame / p.fps);
    },
    createPlayer(): PlayerController {
      let current = 0;
      let playing = false;
      const controller: PlayerController = {
        seek(seconds: number): void {
          current = Math.min(Math.max(seconds, 0), p.duration);
        },
        play(): void {
          playing = true;
        },
        pause(): void {
          playing = false;
        },
        setFrame(frame: number): void {
          if (!Number.isInteger(frame) || frame < 0 || frame > maxFrame) {
            throw makeRuntimeError("E_SCHEMA", `frame out of range: ${frame} (valid 0..${maxFrame})`);
          }
          current = frame / p.fps;
        },
        getState(): RuntimeState {
          return stateAtTime(current); // recompute, never cache
        },
        tick(dt: number): RuntimeState {
          if (playing) current = Math.min(current + dt, p.duration);
          return stateAtTime(current);
        },
        get playing(): boolean {
          return playing;
        },
        get currentTime(): number {
          return current;
        }
      };
      return controller;
    }
  };
  return runtime;
}
