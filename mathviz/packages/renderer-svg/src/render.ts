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

/** Lenient cartesian_window reader: exactly one well-formed
 *  scene.layoutRules cartesian_window -> window, else null (caller keeps the
 *  legacy autofit/track mapping). The freeze-time E_LAYOUT gate lives in the
 *  function2d domain package; the renderer only paints what a valid window
 *  says (presentation-only world->pixel mapping). */
interface CartesianWindow { xMin: number; xMax: number; yMin: number; yMax: number }
function readCartesianWindow(scene: any): CartesianWindow | null {
  const rules = Array.isArray(scene?.layoutRules) ? scene.layoutRules : [];
  const wins = rules.filter((r: any) => r?.kind === "cartesian_window");
  if (wins.length !== 1) return null;
  const r = wins[0];
  const { x_min, x_max, y_min, y_max } = r ?? {};
  const ok = [x_min, x_max, y_min, y_max].every((n: unknown) => typeof n === "number" && Number.isFinite(n));
  if (!ok || !(x_max > x_min) || !(y_max > y_min)) return null;
  return { xMin: x_min, xMax: x_max, yMin: y_min, yMax: y_max };
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
  const win = readCartesianWindow(sceneIR);
  let sx: (p: P) => P;
  let fitNote = "";
  if (win) {
    // P4 cartesian window: a FIXED graph viewport — stable while curves
    // sweep; world->pixel only, never a function evaluation.
    const innerW = width - margin[1] - margin[3];
    const innerH = height - margin[0] - margin[2];
    const wScale = Math.min(innerW / (win.xMax - win.xMin), innerH / (win.yMax - win.yMin));
    const wOffX = margin[3] + (innerW - (win.xMax - win.xMin) * wScale) / 2;
    const wOffY = margin[0] + (innerH - (win.yMax - win.yMin) * wScale) / 2;
    sx = (p: P) => ({ x: wOffX + (p.x - win.xMin) * wScale, y: wOffY + (win.yMax - p.y) * wScale });
    fitNote = ` data-window="[${win.xMin},${win.yMin}]-[${win.xMax},${win.yMax}]"`;
  } else if (hasGeometry) {
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
      case "number_line": {
        const x1 = margin[3];
        const x2 = width - margin[1];
        const y = height / 2;
        body.push(`<line x1="${x1}" y1="${y.toFixed(3)}" x2="${x2}" y2="${y.toFixed(3)}" stroke="${esc(String(pres.style?.stroke ?? "#6e7681"))}" stroke-width="2" opacity="${opacity}"/>`);
        for (let i = 0; i <= 10; i++) {
          const x = x1 + (x2 - x1) * i / 10;
          body.push(`<line x1="${x.toFixed(3)}" y1="${(y - 5).toFixed(3)}" x2="${x.toFixed(3)}" y2="${(y + 5).toFixed(3)}" stroke="#6e7681" opacity="${opacity}"/>`);
        }
        if (pres.label) body.push(`<text x="${x1}" y="${(y + 28).toFixed(3)}" font-size="13" fill="#8b949e">${esc(pres.label)}</text>`);
        break;
      }
      case "moving_body": {
        if (typeof rb !== "number" || !Number.isFinite(rb)) break;
        const p = sx({ x: Math.min(Math.max(rb, 0), 1), y: 0 });
        const fill = pres.style?.fill ?? (hl ? "#f0883e" : "#58a6ff");
        body.push(`<circle cx="${p.x.toFixed(3)}" cy="${p.y.toFixed(3)}" r="${hl ? 9 : 7}" fill="${esc(String(fill))}" opacity="${opacity}"/>`);
        if (pres.label) body.push(`<text x="${(p.x + 9).toFixed(3)}" y="${(p.y - 10).toFixed(3)}" font-size="13" fill="#c9d1d9">${esc(pres.label)}</text>`);
        break;
      }
      case "marker": {
        const p = posOf(oid) ?? (typeof rb === "number" ? sx({ x: Math.min(Math.max(rb, 0), 1), y: 0 }) : null);
        if (!p) break;
        body.push(`<line x1="${p.x.toFixed(3)}" y1="${(p.y - 18).toFixed(3)}" x2="${p.x.toFixed(3)}" y2="${(p.y + 18).toFixed(3)}" stroke="${esc(String(pres.style?.stroke ?? "#3fb950"))}" stroke-width="2" opacity="${opacity}"/>`);
        if (pres.label) body.push(`<text x="${(p.x + 6).toFixed(3)}" y="${(p.y - 20).toFixed(3)}" font-size="12" fill="#8b949e">${esc(pres.label)}</text>`);
        break;
      }
      case "text": {
        const anchor = posOf(oid) ?? { x: margin[3], y: height / 2 + 34 };
        body.push(`<text x="${anchor.x.toFixed(3)}" y="${anchor.y.toFixed(3)}" font-size="13" fill="#8b949e" opacity="${opacity}">${esc(pres.text ?? "")}</text>`);
        break;
      }
      case "grid": {
        if (!win) break; // grid is only meaningful under a cartesian window
        const stroke = pres.style?.stroke ?? "#21262d";
        const w = pres.style?.stroke_width ?? 1;
        const iMin = Math.ceil(win.xMin), iMax = Math.floor(win.xMax);
        const jMin = Math.ceil(win.yMin), jMax = Math.floor(win.yMax);
        if (iMax - iMin <= 128) {
          for (let i = iMin; i <= iMax; i++) {
            const a = sx({ x: i, y: win.yMin }), b = sx({ x: i, y: win.yMax });
            body.push(`<line x1="${a.x.toFixed(3)}" y1="${a.y.toFixed(3)}" x2="${b.x.toFixed(3)}" y2="${b.y.toFixed(3)}" stroke="${esc(String(stroke))}" stroke-width="${w}" opacity="${opacity}"/>`);
          }
        }
        if (jMax - jMin <= 128) {
          for (let j = jMin; j <= jMax; j++) {
            const a = sx({ x: win.xMin, y: j }), b = sx({ x: win.xMax, y: j });
            body.push(`<line x1="${a.x.toFixed(3)}" y1="${a.y.toFixed(3)}" x2="${b.x.toFixed(3)}" y2="${b.y.toFixed(3)}" stroke="${esc(String(stroke))}" stroke-width="${w}" opacity="${opacity}"/>`);
          }
        }
        break;
      }
      case "axis": {
        if (!win) break;
        const stroke = esc(String(pres.style?.stroke ?? "#8b949e"));
        const w = pres.style?.stroke_width ?? 1.5;
        // axes sit at 0 clamped into the window
        const x0 = Math.min(Math.max(0, win.yMin), win.yMax);
        const y0 = Math.min(Math.max(0, win.xMin), win.xMax);
        const o = sx({ x: y0, y: x0 });
        const xe = sx({ x: win.xMax, y: x0 });
        const xs = sx({ x: win.xMin, y: x0 });
        const ye = sx({ x: y0, y: win.yMax });
        const ys = sx({ x: y0, y: win.yMin });
        body.push(`<line x1="${xs.x.toFixed(3)}" y1="${xs.y.toFixed(3)}" x2="${xe.x.toFixed(3)}" y2="${xe.y.toFixed(3)}" stroke="${stroke}" stroke-width="${w}" opacity="${opacity}"/>`);
        body.push(`<line x1="${ys.x.toFixed(3)}" y1="${ys.y.toFixed(3)}" x2="${ye.x.toFixed(3)}" y2="${ye.y.toFixed(3)}" stroke="${stroke}" stroke-width="${w}" opacity="${opacity}"/>`);
        // arrowheads at the positive ends
        body.push(`<polygon points="${xe.x.toFixed(3)},${xe.y.toFixed(3)} ${(xe.x - 9).toFixed(3)},${(xe.y - 4).toFixed(3)} ${(xe.x - 9).toFixed(3)},${(xe.y + 4).toFixed(3)}" fill="${stroke}" opacity="${opacity}"/>`);
        body.push(`<polygon points="${ye.x.toFixed(3)},${ye.y.toFixed(3)} ${(ye.x - 4).toFixed(3)},${(ye.y + 9).toFixed(3)} ${(ye.x + 4).toFixed(3)},${(ye.y + 9).toFixed(3)}" fill="${stroke}" opacity="${opacity}"/>`);
        // integer ticks + labels (bounded)
        const iMin = Math.ceil(win.xMin), iMax = Math.floor(win.xMax);
        const jMin = Math.ceil(win.yMin), jMax = Math.floor(win.yMax);
        if (iMax - iMin <= 64) {
          for (let i = iMin; i <= iMax; i++) {
            if (i === 0) continue;
            const t1 = sx({ x: i, y: x0 });
            body.push(`<line x1="${t1.x.toFixed(3)}" y1="${t1.y.toFixed(3)}" x2="${t1.x.toFixed(3)}" y2="${(t1.y + (x0 > win.yMin + (win.yMax - win.yMin) / 2 ? -5 : 5)).toFixed(3)}" stroke="${stroke}" stroke-width="${w}" opacity="${opacity}"/>`);
            body.push(`<text x="${(t1.x - 3).toFixed(3)}" y="${(t1.y + (x0 > win.yMin + (win.yMax - win.yMin) / 2 ? -8 : 16)).toFixed(3)}" font-size="10" fill="#8b949e" opacity="${opacity}">${i}</text>`);
          }
        }
        if (jMax - jMin <= 64) {
          for (let j = jMin; j <= jMax; j++) {
            if (j === 0) continue;
            const t1 = sx({ x: y0, y: j });
            body.push(`<line x1="${t1.x.toFixed(3)}" y1="${t1.y.toFixed(3)}" x2="${(t1.x + (y0 > win.xMin + (win.xMax - win.xMin) / 2 ? -5 : 5)).toFixed(3)}" y2="${t1.y.toFixed(3)}" stroke="${stroke}" stroke-width="${w}" opacity="${opacity}"/>`);
            body.push(`<text x="${(t1.x + (y0 > win.xMin + (win.xMax - win.xMin) / 2 ? -22 : 6)).toFixed(3)}" y="${(t1.y + 3).toFixed(3)}" font-size="10" fill="#8b949e" opacity="${opacity}">${j}</text>`);
          }
        }
        body.push(`<text x="${(o.x - 10).toFixed(3)}" y="${(o.y + 14).toFixed(3)}" font-size="10" fill="#8b949e" opacity="${opacity}">0</text>`);
        break;
      }
      case "function_curve": {
        // consumes the DomainSnapshot function_curve entity: polylines with
        // breaks. The renderer NEVER evaluates f(x) — it paints the samples
        // the snapshot already carries.
        if (!rb || typeof rb !== "object" || rb.kind !== "function_curve" || !Array.isArray(rb.segments)) break;
        const stroke = pres.style?.stroke ?? "#ff7b72";
        const w = pres.style?.stroke_width ?? 2.5;
        for (const seg of rb.segments) {
          if (!Array.isArray(seg) || seg.length < 2) continue;
          const pts = seg.map((q: any) => sx({ x: q.x, y: q.y }))
            .map((q: P) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`)
            .join(" ");
          body.push(`<polyline points="${pts}" fill="none" stroke="${esc(String(stroke))}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`);
        }
        if (pres.label && rb.segments.length > 0 && rb.segments[0].length > 0) {
          const last = rb.segments[rb.segments.length - 1];
          const q = last[last.length - 1];
          const p = sx({ x: q.x, y: q.y });
          body.push(`<text x="${(p.x + 6).toFixed(3)}" y="${(p.y - 6).toFixed(3)}" font-size="12" fill="${esc(String(stroke))}" opacity="${opacity}">${esc(pres.label)}</text>`);
        }
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
