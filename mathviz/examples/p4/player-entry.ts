import { loadRuntime } from "../../packages/runtime/src/runtime";
import { renderSvg } from "../../packages/renderer-svg/src/render";
import { function2dAdapter } from "../../packages/domains/function2d/src/adapter";

(window as any).MathVizRuntime = { loadRuntime, renderSvg, function2dAdapter };
