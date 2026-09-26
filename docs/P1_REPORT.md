# MathViz Engine v0.1 — P0.1 + P1 Runtime Skeleton 交付报告

- 日期：2026-09-26
- 基线：用户审计反馈（P0.txt），基线提交 `b7fd79b`（远端已核）
- 本轮：P0.1 合同硬化（提交 `a89ba84`）+ P1 Runtime Skeleton（本提交）
- 验收证据：`npm run gates` → **P0 GATES: ALL GREEN + P1 GATES: ALL GREEN**；`npm test` → **90/90**（p0 60 + p1 30）；`npx tsc --noEmit` → 0 错。

## P0.1 合同硬化（三项全部落地）

1. **溯源回指原文**：G2 强制 `statement.slice(span.start, span.end) === span.text`；有 source_facts 但缺 statement 同样 E_PROVENANCE。全部 valid fixture span 已重写为真实切片。新增 3 个 invalid case。
2. **capability 声明闭包**：derived/constraints/assertions/events 实际使用的 capability 必须 ∈ math.capabilities（declared-but-unused 允许）。新增 inv-used-capability-not-declared；fixtures 20 valid + 24 invalid。
3. **统计勘误**：registry 实为 **40 项**（geometry2d 25 / function2d 8 / motion1d 7），文档已修正，registry 本体零改动。

## P1 Runtime Skeleton

### 架构（一句话）

> Frozen Compiled Project → Runtime（纯函数）→ stateAt(presentationTime) → RuntimeState（唯一真相）→ SVG Renderer（只涂不算）

### 关键实现

- **packages/runtime 自包含零依赖**：不 import contracts/Ajv/node 内建，同一份源码在 node（tsx/vitest）与浏览器（vite iife bundle，16.7 kB）跑**同一个求值器**——这是 G10 可信的前提。
- **纯函数核心**：`stateAt(t)` = f(project, t)，无时钟/随机/DOM/前帧状态；`getState()` 每次重算不缓存；play/pause/seek/setFrame 全部只决定"评哪个时刻"。
- **setFrame 唯一公式**：`stateAtFrame(n) === stateAt(n / fps)`，帧从 0 起，合法域 `0 ≤ n ≤ floor(duration × fps)`，无第二套 frame evaluator。
- **双时间轴语义（冻结）**：
  - 映射窗口半开 `[from, to)`，**最后一个窗口闭** `[from, to]`——公共边界只命中一个窗口；
  - 窗口重叠 → E_NONDETERMINISTIC（编译期拒绝，无"后声明覆盖"）；
  - 窗口之外 `modelTime = null`（presentation-only 区间，不偷偷延续）；需要冻结模型时间就显式写 `model_from == model_to`；
  - 线性映射 `u=(t-from)/(to-from)`，端点为 ExprAst 常量（可含 pi）。
- **action 冲突语义（冻结）**：同 target 同刻 show+hide → E_NONDETERMINISTIC；同刻双 camera → E_NONDETERMINISTIC；caption 活动区间相交 → E_NONDETERMINISTIC；highlight/dim 为独立布尔，带 until 窗口 `[at, until)`，无 until 持续生效；E4：at/until/from/to 必须 ∈ [0, duration] 且 until > at，违反 → E_SCHEMA。
- **表达式求值器**：仅冻结词表（+ - * / ^ neg sin cos tan asin acos atan exp ln sqrt abs）；int/rational 走 bigint 精确轨道，超越函数走确定性数值；缺符号 → E_BINDING；除零/sqrt负/log非正/asin越界 → E_MATH_CONSTRAINT；无 eval()。
- **Binding 解析**：完整 property path（entity 走 props、fact/param 走对象本体、runtime 求值后可继续下钻）；缺任一环 → E_BINDING；声明未实现的 transform → E_CAPABILITY_UNSUPPORTED（不静默忽略）。运行时绑定在 mapping 外区解析为 null。
- **renderer-svg**：`renderSvg(state, sceneIR)` 只消费 RuntimeState + Scene IR，支持 point/segment/text/marker 四原语；不读 Math IR、不执行 timeline、不解 binding。
- **Player（examples/p1/index.html）**：`window.mathviz = {seek, play, pause, setFrame, getState}`；body 挂 `data-rendered-frame` / `data-state-digest`；headless 入口 `?frame=N`；内嵌 project 与 fixtures/p1 逐字节一致（vitest 断言防漂移）。视频管线将来只等 `data-rendered-frame == requestedFrame`，不再用 rAF+猜稳定。

### 测试项目（fixtures/p1/minimal-motion.compiled.json）

合成 runtime 项目（不碰几何求解）：参数 u ∈ [0,1]，runtime pos_P = t（保留符号 t 即当前模型时间），场景 point/segment/text，timeline 8s@30fps：0–2s presentation-only，2–6s 映射 model 0→1，6–8s presentation-only。所有数学值手工编译完成，Runtime 只执行不求解。

## Known Vectors（跨版本回归基准，7 帧）

| frame | presentation_time | model_time | state_digest |
|---|---|---|---|
| 0 | 0.0000 | null | 24a9c173a5918780… |
| 60 | 2.0000 | 0.000000 | 94e640b65f81550a… |
| 90 | 3.0000 | 0.250000 | 5703c3b83ae51e1d… |
| 120 | 4.0000 | 0.500000 | 8affc36505d3a4ee… |
| 150 | 5.0000 | 0.750000 | db028047939ff099… |
| 180 | 6.0000 | 1.000000 | 7c1e4b618f88c234… |
| 240 | 8.0000 | null | 34638bbd0057377d… |

完整 64 位 digest 见 `mathviz/runs/p1/digest-vectors.json`；project digest `b65ff6111a2b9934…`。

## 门控结果

- **G9 加强（runtime determinism）**：t = 0 / 1 / mapping 起点 / 中点 / 终点−ε / duration，各重复 100 次 `stateAt`，digest 全一致。PASS。
- **G10（跨输出一致性）**：node `stateAtFrame(n).digest` vs Chrome headless `?frame=n` 页面 `data-state-digest`，7 帧逐位相等，`data-rendered-frame` 同步。PASS。

## 复现

```bash
cd mathviz
npm install
npm run build:player   # 重建 examples/p1/dist/runtime.bundle.js
npm run gates          # p0（44 fixtures）+ p1（G9/G10 + known vectors）
npm test               # 90 断言
npx tsc --noEmit
```

## P1 验收判定（用户定义的这句话，逐条成立）

> 给定同一个 frozen compiled project 和任意 presentation time/frame，MathViz Runtime 在不依赖前一帧、不依赖 wall clock、不调用 LLM、不调用 domain solver 的情况下，产生唯一确定的 RuntimeState；浏览器交互与 frame-addressable 接口消费完全相同的状态机。

- 不依赖前一帧 ✓（stateAt 纯函数，getState 重算，100× digest 一致）
- 不依赖 wall clock ✓（求值器无时间读取；player 的 rAF 只选择时刻）
- 不调用 LLM / domain solver ✓（runtime 零外部调用）
- 唯一确定 ✓（G9）
- 浏览器与 frame 接口同一状态机 ✓（G10，同一份源码两个运行时）

P0 正式冻结（含 P0.1 三项硬化），runtime 基线冻结，可进入 P2 Geometry Adapter。
