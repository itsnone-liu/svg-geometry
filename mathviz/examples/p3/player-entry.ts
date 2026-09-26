import { loadRuntime } from "../../packages/runtime/src/runtime";
import { renderSvg } from "../../packages/renderer-svg/src/render";
import { motion1dAdapter } from "../../packages/domains/motion1d/src/adapter";

(window as any).MathVizRuntime = { loadRuntime, renderSvg, motion1dAdapter };
