// Generates examples/p2/index.html from fixtures/p2/square-rotation.compiled.json.
// The inline project is INJECTED from the fixture file (never hand-copied),
// so player and gates can never drift apart. Deterministic output.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "p2", "square-rotation.compiled.json"), "utf8"));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>MathViz P2 Player — square-rotation (verified geometry)</title>
<style>
  body { background: #010409; color: #c9d1d9; font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 16px; }
  #stage svg { display: block; border: 1px solid #21262d; border-radius: 6px; }
  .bar { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 4px 12px; cursor: pointer; }
  button:hover { background: #30363d; }
  input[type=range] { width: 360px; }
  .mono { font-family: ui-monospace, monospace; color: #8b949e; }
</style>
</head>
<body>
<div id="stage"></div>
<div class="bar">
  <button id="btn-play">play</button>
  <button id="btn-pause">pause</button>
  <input id="scrub" type="range" min="0" max="288" step="1" value="0">
  <span class="mono" id="clock">t=0.000</span>
</div>
<script>
window.__MATHVIZ_PROJECT__ = ${JSON.stringify(fixture, null, 2)};
</script>
<script src="./dist/runtime.bundle.js"></script>
<script>
(function () {
  var rt = MathVizRuntime.loadRuntime(window.__MATHVIZ_PROJECT__, { domains: { geometry2d: MathVizRuntime.geometry2dAdapter } });
  var player = rt.createPlayer();
  var stage = document.getElementById("stage");
  var clock = document.getElementById("clock");
  var scrub = document.getElementById("scrub");
  var maxFrame = Math.floor(rt.duration * rt.fps);
  scrub.max = String(maxFrame);

  function render() {
    var state = player.getState(); // ALWAYS via stateAt — pure recompute
    var frame = Math.round(state.presentationTime * rt.fps);
    stage.innerHTML = MathVizRuntime.renderSvg(state, window.__MATHVIZ_PROJECT__.scene);
    clock.textContent = "t=" + state.presentationTime.toFixed(3) + "  model=" +
      (state.modelTime === null ? "null" : state.modelTime.toFixed(4));
    if (document.activeElement !== scrub) scrub.value = String(frame);
    document.body.setAttribute("data-rendered-frame", String(frame));
    document.body.setAttribute("data-state-digest", state.digest);
  }

  window.mathviz = {
    seek: function (s) { player.seek(s); render(); },
    play: function () { player.play(); },
    pause: function () { player.pause(); render(); },
    setFrame: function (n) { player.setFrame(n); render(); },
    getState: function () { return player.getState(); }
  };

  var lastTs = null;
  function loop(ts) {
    if (player.playing) {
      if (lastTs !== null) player.tick(Math.min((ts - lastTs) / 1000, 0.25));
      render();
    }
    lastTs = ts;
    requestAnimationFrame(loop);
  }

  document.getElementById("btn-play").addEventListener("click", function () { window.mathviz.play(); });
  document.getElementById("btn-pause").addEventListener("click", function () { window.mathviz.pause(); });
  scrub.addEventListener("input", function () { player.setFrame(parseInt(scrub.value, 10)); render(); });

  var m = /frame=(\\d+)/.exec(location.search || "");
  if (m) window.mathviz.setFrame(parseInt(m[1], 10));
  else render();
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>
`;

const out = path.join(root, "examples", "p2", "index.html");
fs.writeFileSync(out, html, "utf8");
console.log(`wrote ${out} (${html.length} bytes)`);
