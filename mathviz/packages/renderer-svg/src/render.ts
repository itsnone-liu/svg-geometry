// Thinnest possible SVG renderer: RuntimeState + SceneIR -> SVG string.
// It MUST NOT: recompute model time, re-parse Math IR, execute the timeline,
// or resolve bindings. Those all live in RuntimeState already — this module
// only paints.
//
// P2 geometry support:
//   - resolvedBinding as geometry values: {position} points, {a,b}
//     segment/line, {center,radius} circle — mapped to screen space by a
//     DETERMINISTIC autofit (same state -> same SVG, byte-identical).
//   - autofit covers ALL geometry in the CURRENT state (visible or not), so
//     the same state renders with identical bounds. Bounds can move as geometry
//     moves; a fixed camera/world-window contract is P3 scope.
//   - verified marks (right_angle_mark / equal_tick / parallel_mark /
//     angle_mark): glyph painting only — the CLAIM was proven upstream
//     (G5); the renderer draws what the math asserted, or it never runs.
//
// P1 compatibility: plain-number resolvedBindings keep the P1 track mapping.

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
    const v = style[k];
    if (k === "dash") parts.push(`stroke-dasharray="${esc(String(v))}"`);
    else parts.push(`${esc(k)}="${esc(String(v))}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

interface P { x: number; y: number }
interface Geom {
  points: P[];
  segments: { a: P; b: P }[];
  circles: { c: P; r: number }[];
}

function collectGeometry(state: RuntimeState): Geom {
  const g: Geom = { points: [], segments: [], circles: [] };
  for (const oid of Object.keys(state.objects)) {
    const st = state.objects[oid]!;
    const rb: any = st.resolvedBinding;
    if (!rb || typeof rb !== "object") continue;
    if (rb.kind === "point" && rb.position) { g.points.push(rb.position); continue; }
    if ((rb.kind === "segment" || rb.kind === "line") && rb.a && rb.b) { g.segments.push({ a: rb.a, b: rb.b }); continue; }
    if (rb.kind === "circle" && rb.center && typeof rb.radius === "number") { g.circles.push({ c: rb.center, r: rb.radius }); continue; }
  }
  return g;
}

export function renderSvg(state: RuntimeState, sceneIR: any): string {
  const vp = sceneIR?.viewport ?? {};
  const width = num(vp.width, 800);
  const height = num(vp.height, 200);
  const margin = Array.isArray(vp.margin) && vp.margin.length === 4 ? (vp.margin as number[]) : [20, 20, 20, 20];

  const geom = collectGeometry(state);
  const hasGeometry = geom.points.length + geom.segments.length + geom.circles.length > 0;

  // ---- deterministic world->screen mapping ----
  let sx: (p: P) => P;
  let fitNote = "";
  if (hasGeometry) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const see = (p: P) => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    };
    geom.points.forEach(see);
    geom.segments.forEach((s) => { see(s.a); see(s.b); });
    geom.circles.forEach((c) => {
      see({ x: c.c.x - c.r, y: c.c.y - c.r });
      see({ x: c.c.x + c.r, y: c.c.y + c.r });
    });
    const padX = (maxX - minX) * 0.08 || 1;
    const padY = (maxY - minY) * 0.08 || 1;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    const innerW = width - margin[1] - margin[3];
    const innerH = height - margin[0] - margin[2];
    const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
    const offX = margin[3] + (innerW - (maxX - minX) * scale) / 2;
    const offY = margin[0] + (innerH - (maxY - minY) * scale) / 2;
    // math y-up -> svg y-down
    sx = (p: P) => ({ x: offX + (p.x - minX) * scale, y: offY + (maxY - p.y) * scale });
    fitNote = ` data-world="[${minX.toFixed(4)},${minY.toFixed(4)}]-[${maxX.toFixed(4)},${maxY.toFixed(4)}]"`;
  } else {
    // P1 track mapping (numbers 0..1 on a horizontal line)
    const innerW = width - margin[1] - margin[3];
    const midY = margin[0] + (height - margin[0] - margin[2]) / 2;
    sx = (p: P) => ({ x: margin[3] + Math.min(Math.max(p.x, 0), 1) * innerW, y: midY });
  }

  const body: string[] = [];

  const posOf = (oid: string): P | null => {
    const rb: any = state.objects[oid]?.resolvedBinding;
    if (!rb || typeof rb !== "object") return null;
    if (rb.kind === "point" && rb.position) return sx(rb.position);
    return null;
  };
  const segOf = (oid: string): { a: P; b: P } | null => {
    const rb: any = state.objects[oid]?.resolvedBinding;
    if (!rb || typeof rb !== "object") return null;
    if ((rb.kind === "segment" || rb.kind === "line") && rb.a && rb.b) return { a: sx(rb.a), b: sx(rb.b) };
    return null;
  };

  const objList: any[] = sceneIR?.objects ?? [];

  for (const obj of objList) {
    const oid = obj?.objectId;
    const st = state.objects[oid];
    if (!st) continue;
    if (!st.visible) continue;
    const pres = st.presentation ?? ({} as any);
    const rb: any = st.resolvedBinding;
    const hl = st.highlighted;
    const dim = st.dimmed;
    const opacity = dim ? 0.35 : 1;
    const style = styleToAttrs(pres.style);

    switch (pres.primitive) {
      case "point": {
        let p = posOf(oid);
        if (!p && typeof rb === "number") p = sx({ x: Math.min(Math.max(rb, 0), 1), y: 0 });
        if (!p) break; // unsupported/absent geometry value
        const fill = hl ? "#f0883e" : (pres.style?.fill ?? "#58a6ff");
        body.push(`<circle cx="${p.x.toFixed(3)}" cy="${p.y.toFixed(3)}" r="${hl ? 8 : 5}" fill="${esc(String(fill))}" opacity="${opacity}"${style}/>`);
        if (pres.label) body.push(`<text x="${(p.x + 9).toFixed(3)}" y="${(p.y - 9).toFixed(3)}" font-size="13" fill="#c9d1d9">${esc(pres.label)}</text>`);
        break;
      }
      case "segment":
      case "line": {
        const s = segOf(oid);
        if (!s) {
          if (hasGeometry) break;
          const innerW = width - margin[1] - margin[3];
          const midY = margin[0] + (height - margin[0] - margin[2]) / 2;
          body.push(`<line x1="${margin[3]}" y1="${midY.toFixed(3)}" x2="${(margin[3] + innerW).toFixed(3)}" y2="${midY.toFixed(3)}" stroke="#30363d" stroke-width="2" opacity="${opacity}"${style}/>`);
          break;
        }
        const stroke = pres.style?.stroke ?? (pres.primitive === "line" ? "#6e7681" : "#30363d");
        const w = pres.style?.stroke_width ?? 2;
        body.push(`<line x1="${s.a.x.toFixed(3)}" y1="${s.a.y.toFixed(3)}" x2="${s.b.x.toFixed(3)}" y2="${s.b.y.toFixed(3)}" stroke="${esc(String(stroke))}" stroke-width="${w}" opacity="${opacity}"${style}/>`);
        break;
      }
      case "circle": {
        if (!rb || rb.kind !== "circle") break;
        const c = sx(rb.center);
        const rPx = Math.abs(sx({ x: rb.center.x + rb.radius, y: rb.center.y }).x - c.x);
        const stroke = pres.style?.stroke ?? "#6e7681";
        body.push(`<circle cx="${c.x.toFixed(3)}" cy="${c.y.toFixed(3)}" r="${rPx.toFixed(3)}" fill="none" stroke="${esc(String(stroke))}" opacity="${opacity}"${style}/>`);
        break;
      }
      case "right_angle_mark": {
        const refs: string[] = obj.attach_to ?? [];
        const [p1, v, p2] = refs.map(posOf);
        if (!p1 || !v || !p2) break;
        const d1 = norm2(sub2(p1, v));
        const d2 = norm2(sub2(p2, v));
        const s = hl ? 16 : 12;
        const a = add2(v, mul2(d1, s));
        const b = add2(v, add2(mul2(d1, s), mul2(d2, s)));
        const c = add2(v, mul2(d2, s));
        const stroke = pres.style?.stroke ?? "#58a6ff";
        body.push(`<polyline points="${a.x.toFixed(3)},${a.y.toFixed(3)} ${b.x.toFixed(3)},${b.y.toFixed(3)} ${c.x.toFixed(3)},${c.y.toFixed(3)}" fill="none" stroke="${esc(String(stroke))}" stroke-width="1.5" opacity="${opacity}"/>`);
        break;
      }
      case "equal_tick": {
        const refs: string[] = obj.attach_to ?? [];
        const stroke = pres.style?.stroke ?? "#3fb950";
        const tick = (a: P, b: P) => {
          const mid = mul2(add2(a, b), 0.5);
          const d = norm2(sub2(b, a));
          const n = { x: -d.y, y: d.x };
          const s = 5;
          body.push(`<line x1="${(mid.x - n.x * s).toFixed(3)}" y1="${(mid.y - n.y * s).toFixed(3)}" x2="${(mid.x + n.x * s).toFixed(3)}" y2="${(mid.y + n.y * s).toFixed(3)}" stroke="${esc(String(stroke))}" stroke-width="1.5" opacity="${opacity}"/>`);
        };
        if (refs.length === 4) {
          const pts = refs.map(posOf);
          if (pts[0] && pts[1]) tick(pts[0]!, pts[1]!);
          if (pts[2] && pts[3]) tick(pts[2]!, pts[3]!);
        } else if (refs.length === 2) {
          const s1 = segOf(refs[0]);
          const s2 = segOf(refs[1]);
          if (s1) tick(s1.a, s1.b);
          if (s2) tick(s2.a, s2.b);
        }
        break;
      }
      case "parallel_mark": {
        const refs: string[] = obj.attach_to ?? [];
        const stroke = pres.style?.stroke ?? "#d29922";
        for (const ref of refs) {
          const s1 = segOf(ref);
          if (!s1) continue;
          const mid = mul2(add2(s1.a, s1.b), 0.5);
          const d = norm2(sub2(s1.b, s1.a));
          const n = { x: -d.y, y: d.x };
          const s = 6;
          body.push(`<polyline points="${(mid.x - d.x * s - n.x * s).toFixed(3)},${(mid.y - d.y * s - n.y * s).toFixed(3)} ${(mid.x - d.x * s + n.x * s).toFixed(3)},${(mid.y - d.y * s + n.y * s).toFixed(3)} ${(mid.x + d.x * s + n.x * s * 0.4).toFixed(3)},${(mid.y + d.y * s + n.y * s * 0.4).toFixed(3)}" fill="none" stroke="${esc(String(stroke))}" stroke-width="1.5" opacity="${opacity}"/>`);
        }
        break;
      }
      case "angle_mark": {
        const refs: string[] = obj.attach_to ?? [];
        const [p1, v, p2] = refs.map(posOf);
        if (!p1 || !v || !p2) break;
        const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
        const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
        const r = hl ? 22 : 16;
        let delta = a2 - a1;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        const end = a1 + delta;
        const x1 = (v.x + r * Math.cos(a1)).toFixed(3);
        const y1 = (v.y + r * Math.sin(a1)).toFixed(3);
        const x2 = (v.x + r * Math.cos(end)).toFixed(3);
        const y2 = (v.y + r * Math.sin(end)).toFixed(3);
        const large = Math.abs(delta) > Math.PI ? 1 : 0;
        const sweep = delta > 0 ? 1 : 0;
        const stroke = pres.style?.stroke ?? "#d29922";
        body.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}" fill="none" stroke="${esc(String(stroke))}" stroke-width="1.5" opacity="${opacity}"/>`);
        break;
      }
      case "marker": {
        const p = posOf(oid) ?? (typeof rb === "number" ? sx({ x: Math.min(Math.max(rb, 0), 1), y: 0 }) : null);
        if (!p) break;
        body.push(`<rect x="${(p.x - 4).toFixed(3)}" y="${(p.y - 16).toFixed(3)}" width="8" height="32" fill="#3fb950" opacity="${opacity}"/>`);
        break;
      }
      case "text": {
        const anchor = posOf(oid) ?? { x: margin[3], y: height / 2 + 34 };
        body.push(`<text x="${anchor.x.toFixed(3)}" y="${anchor.y.toFixed(3)}" font-size="13" fill="#8b949e" opacity="${opacity}">${esc(pres.text ?? "")}</text>`);
        break;
      }
      default:
        // unknown primitive: skip deterministically (renderer must not guess)
        break;
    }
  }

  let caption = "";
  if (state.caption) {
    caption = `<text x="${margin[3]}" y="${(height - margin[2] / 2 + 6).toFixed(3)}" font-size="14" fill="#c9d1d9">${esc(state.caption.text)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `data-model-time="${state.modelTime === null ? "null" : state.modelTime}" data-zoom="${state.camera.zoom.toFixed(3)}"${fitNote}>` +
    `<rect width="${width}" height="${height}" fill="#0d1117"/>` +
    body.join("") +
    caption +
    `</svg>`
  );
}

function sub2(a: P, b: P): P { return { x: a.x - b.x, y: a.y - b.y }; }
function add2(a: P, b: P): P { return { x: a.x + b.x, y: a.y + b.y }; }
function mul2(a: P, s: number): P { return { x: a.x * s, y: a.y * s }; }
function norm2(a: P): P {
  const n = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / n, y: a.y / n };
}
