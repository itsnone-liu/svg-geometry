// Generate the interactive P3 Motion1D page from the reviewed fixture.
// The browser player and node gates therefore consume the same frozen project.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/p3/pursuit.compiled.json"), "utf8"));
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>MathViz P3 Motion1D — pursuit</title><style>
body{background:#010409;color:#c9d1d9;font:14px/1.5 system-ui,sans-serif;margin:0;padding:20px}h1{font-size:20px}#stage svg{display:block;border:1px solid #21262d;border-radius:6px;max-width:100%}.bar{margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 12px;cursor:pointer}input[type=range]{width:min(560px,70vw)}.mono{font-family:ui-monospace,monospace;color:#8b949e}
</style></head><body><h1>追及运动：精确求解与任意时间随机寻址</h1><div id="stage"></div><div class="bar"><button id="play">播放</button><button id="pause">暂停</button><input id="scrub" type="range" min="0" max="432" value="0"><span class="mono" id="clock"></span></div><p class="mono">冻结 Math IR facts → compile-once VerifiedMotionProgram → pure MotionSnapshot → generic binding → SVG。无模型调用、无前帧累积。</p>
<script>window.__MATHVIZ_PROJECT__=${JSON.stringify(fixture)};</script><script src="./runtime.bundle.js"></script><script>
(function(){var p=window.__MATHVIZ_PROJECT__,rt=MathVizRuntime.loadRuntime(p,{domains:{motion1d:MathVizRuntime.motion1dAdapter}}),player=rt.createPlayer(),stage=document.getElementById('stage'),scrub=document.getElementById('scrub'),clock=document.getElementById('clock');scrub.max=String(Math.floor(rt.duration*rt.fps));function render(){var s=player.getState(),f=Math.round(s.presentationTime*rt.fps);stage.innerHTML=MathVizRuntime.renderSvg(s,p.scene);clock.textContent='presentation '+s.presentationTime.toFixed(3)+'s · model '+(s.modelTime===null?'—':s.modelTime.toFixed(4)+'s');if(document.activeElement!==scrub)scrub.value=String(f);document.body.setAttribute('data-rendered',String(f));document.body.setAttribute('data-state-digest',s.digest)}window.mathviz={setFrame:function(n){player.setFrame(n);render()},seek:function(t){player.seek(t);render()},getState:function(){return player.getState()}};document.getElementById('play').onclick=function(){player.play()};document.getElementById('pause').onclick=function(){player.pause();render()};scrub.oninput=function(){window.mathviz.setFrame(parseInt(scrub.value,10))};var m=/frame=(\\d+)/.exec(location.search||'');if(m)window.mathviz.setFrame(parseInt(m[1],10));else render();var last=null;function loop(ts){if(player.playing){if(last!==null)player.tick(Math.min((ts-last)/1000,.25));render()}last=ts;requestAnimationFrame(loop)}requestAnimationFrame(loop)})();
</script></body></html>`;
const out = path.join(root, "examples/p3/dist/index.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, "utf8");
console.log(`wrote ${out} (${html.length} bytes)`);
