// Browser entry for the P2 geometry player harness. Bundled by vite into
// examples/p2/dist/runtime.bundle.js (iife, global MathVizRuntime).
// Same runtime + geometry2d domain source the node gates/tests use — the
// ONLY difference from P1's entry is the registered domain adapter.

import { loadRuntime } from "../../packages/runtime/src/runtime";
import { renderSvg } from "../../packages/renderer-svg/src/render";
import { geometry2dAdapter } from "../../packages/domains/geometry2d/src/adapter";

(window as any).MathVizRuntime = { loadRuntime, renderSvg, geometry2dAdapter };
