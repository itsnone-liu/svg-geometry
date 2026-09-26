// Browser entry for the P1 player harness. Bundled by vite into
// examples/p1/dist/runtime.bundle.js (iife, global MathVizRuntime).
// This is the SAME runtime source the node-side gates and tests use.

import { loadRuntime } from "../../packages/runtime/src/runtime";
import { renderSvg } from "../../packages/renderer-svg/src/render";

(window as any).MathVizRuntime = { loadRuntime, renderSvg };
