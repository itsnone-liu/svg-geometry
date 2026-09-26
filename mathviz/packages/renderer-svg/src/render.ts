// Thinnest possible SVG renderer: RuntimeState + SceneIR -> SVG string.
// It MUST NOT: recompute model time, re-parse Math IR, execute the timeline,
// or resolve bindings. Those all live in RuntimeState already — this module
// only paints. Supported primitives in P1: point / segment / text / marker.

import { RuntimeState } from "../../runtime/src/types";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function num(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

function styleToAttrs(style: Record<string, unknown> | undefined): string {
  if (!style) return "";
  const parts: string[] = [];
  for (const k of Object.keys(style).sort()) {
    parts.push(`${esc(k)}="${esc(String(style[k]))}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

export function renderSvg(state: RuntimeState, sceneIR: any): string {
  const vp = sceneIR?.viewport ?? {};
  const width = num(vp.width, 800);
  const height = num(vp.height, 200);
  const margin = Array.isArray(vp.margin) && vp.margin.length === 4 ? (vp.margin as number[]) : [20, 20, 20, 20];
  const innerW = width - margin[1] - margin[3];
  const midY = margin[0] + (height - margin[0] - margin[2]) / 2;

  const body: string[] = [];
  for (const obj of sceneIR?.objects ?? []) {
    const oid = obj?.objectId;
    const st = state.objects[oid];
    if (!st) continue;
    if (!st.visible) continue;
    const pres = st.presentation ?? ({} as any);
    const x01 = typeof st.resolvedBinding === "number" ? Math.min(Math.max(st.resolvedBinding, 0), 1) : 0;
    const x = margin[3] + x01 * innerW;
    const hl = st.highlighted;
    const dim = st.dimmed;
    const opacity = dim ? 0.35 : 1;
    switch (pres.primitive) {
      case "point": {
        body.push(
          `<circle cx="${x.toFixed(3)}" cy="${midY.toFixed(3)}" r="${hl ? 8 : 5}" fill="${hl ? "#f0883e" : "#58a6ff"}" opacity="${opacity}"${styleToAttrs(pres.style)}/>` +
          (pres.label ? `<text x="${(x + 10).toFixed(3)}" y="${(midY - 10).toFixed(3)}" font-size="13" fill="#c9d1d9">${esc(pres.label)}</text>` : "")
        );
        break;
      }
      case "segment": {
        body.push(
          `<line x1="${margin[3]}" y1="${midY.toFixed(3)}" x2="${(margin[3] + innerW).toFixed(3)}" y2="${midY.toFixed(3)}" stroke="#30363d" stroke-width="2" opacity="${opacity}"${styleToAttrs(pres.style)}/>`
        );
        break;
      }
      case "marker": {
        body.push(
          `<rect x="${(x - 4).toFixed(3)}" y="${(midY - 16).toFixed(3)}" width="8" height="32" fill="#3fb950" opacity="${opacity}"/>`
        );
        break;
      }
      case "text": {
        body.push(
          `<text x="${margin[3]}" y="${(midY + 34).toFixed(3)}" font-size="13" fill="#8b949e" opacity="${opacity}">${esc(pres.text ?? "")}</text>`
        );
        break;
      }
      default:
        // unknown primitive in P1: skip deterministically (renderer must not guess)
        break;
    }
  }

  let caption = "";
  if (state.caption) {
    caption = `<text x="${margin[3]}" y="${(height - margin[2] / 2 + 6).toFixed(3)}" font-size="14" fill="#c9d1d9">${esc(state.caption.text)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `data-model-time="${state.modelTime === null ? "null" : state.modelTime}" data-zoom="${state.camera.zoom.toFixed(3)}">` +
    `<rect width="${width}" height="${height}" fill="#0d1117"/>` +
    body.join("") +
    caption +
    `</svg>`
  );
}
