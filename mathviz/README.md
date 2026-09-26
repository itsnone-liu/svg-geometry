# mathviz-contracts — MathViz Engine P0/P0.1 (Contracts) + P1 (Runtime Skeleton)

> 范围纪律：P0 只冻结合同；P0.1 审计后硬化；P1 只证明确定性 Runtime。
> 明确不做（P1 为止）：Geometry DSL、SymPy、motion/geometry solver、LLM、Manim、FFmpeg、自动 layout。

## 目录

```
mathviz/
  package.json                 # CJS 包；gates = tsx packages/contracts/src/run.ts；test = vitest
  tsconfig.json                # ES2022 / commonjs / strict / noEmit（tsc 仅做类型门）
  vitest.config.ts
  packages/contracts/
    schemas/                   # JSON Schema draft 2020-12（Ajv 2020-12 编译）
      common.schema.json       # $defs: Identifier / VersionString / CapabilityId / Exact* / ExprAst / SourceSpan / *Provenance
      math.schema.json         # Math IR：source_facts / derived_facts / runtime_values 三分
      scene.schema.json        # Scene IR：无数学坐标，位置只能经 math: 绑定
      timeline.schema.json     # 独立时间轴：presentation_time → model_time 映射
      capability-registry.schema.json
      error-catalog.schema.json
      project.schema.json      # 编译产物：manifest 版本戳 + math/scene/timeline
    registry/capabilities.v1.json   # 40 项能力（geometry2d 25 / function2d 8 / motion1d 7），registry_version 1.0.0
    errors/error-catalog.v1.json    # 10 错误码 / 9 族，catalog_version 1.0.0
    src/load.ts serialize.ts gates.ts run.ts
  fixtures/p0_cases.valid.json     # 20 例必须全 PASS
  fixtures/p0_cases.invalid.json  # 24 例必须 FAIL 且命中 expected_error_codes（P0.1 后）
  fixtures/p1/minimal-motion.compiled.json   # P1 手写合成 compiled project
  packages/runtime/               # P1：纯函数 runtime（零依赖，node/浏览器同源）
    src/{types,errors,load-project,runtime,digest}.ts
    src/expr/{exact,evaluate}.ts          # bigint 精确轨道 + 确定性数值轨道
    src/timeline/{compile,evaluate,model-time}.ts  # 双时间轴语义（E1-E4/F 冻结）
    src/bindings/{resolve,transform}.ts   # 完整 property path + transform 显式未实现
    src/scene/state-at.ts                 # RuntimeState 装配
    src/run-p1.ts                         # G9 加强 + G10 跨输出 gate runner
  packages/renderer-svg/src/render.ts     # 薄渲染层：RuntimeState+SceneIR → SVG
  examples/p1/                    # player harness（window.mathviz + data-* 属性 + ?frame=N）
  tests/p0.test.ts p1.test.ts     # vitest：60 + 30 断言
  runs/p0/ runs/p1/               # gate 运行产物（.gitignore）
```

## 七条钉死的合同规则（P0 实现映射）

1. **Math IR 三分** — `source_facts`（必须带 problem_text 溯源 span）/`derived_facts`（必须带 capability 溯源且 inputs 可解析）/`runtime_values`（表达式 + depends_on）。G2 执行：无溯源即 `E_PROVENANCE`。
2. **Scene 无数学坐标** — VisualObject `additionalProperties:false`，`x/y/cx` 等坐标字段直接 `E_SCHEMA`；只有 style/layout hints 与 `math:` 绑定。
3. **Timeline 独立** — Scene 对象里出现 `timeline` 键即 `E_SCHEMA`；映射只存在于 timeline 合同（`map_model_time`，from/to 为 presentation 秒，model_from/model_to 为 ExprAst）。
4. **注册表稳定 ID** — 恰好两段 `<domain>.<name>`（`geometry2d.rotate_point`、`motion1d.meeting_event`…），绝不出现自然语言能力描述。非注册表 ID → `E_CAPABILITY_UNSUPPORTED`；域不匹配同罪。
5. **错误码 v1 冻结** — 9 族（SCHEMA/PROVENANCE/CAPABILITY/SOLVE/ASSERTION/BINDING/LAYOUT/DETERMINISM/RENDER，≥7 达标）。harness 发出目录外错误码 = harness bug，直接 throw。
6. **编译产物即冻结工件** — project schema 强制 manifest：`schema_version`/`engine_version`/`domain_versions`/`adapter_versions`（可选 `capability_registry_version`/`source_problem`/`problem_id`）。HTML/MP4 只消费。
7. **精确数优先** — 精确值走字符串/AST（`{"exact":"110/3"}`、ExactInt/Rational/Symbolic），纯 JSON number 仅限展示字段（viewport 尺寸、offset_px、duration/fps、at/until…）。

## 规范化序列化（canon）

- 递归按 key 排序（UTF-16 码元序），数组保序，紧凑单行 `JSON.stringify`；
- `serialize → deserialize → serialize` **字节稳定**（全部 44 个 fixture 断言通过）；
- sha256 摘要进 `runs/p0/report.json`，供跨时间复现校验；
- 已知向量：`{"b":1,"a":{"d":[2,1],"c":"x"}}` → `{"a":{"c":"x","d":[2,1]},"b":1}`。

## 错误码一览（v1）

| code | family | 触发示例 |
|---|---|---|
| E_SCHEMA | SCHEMA | 坐标泄入 Scene、缺 binding、span 外任何结构违规、schemaVersion 不匹配 |
| E_PROVENANCE | PROVENANCE | source_fact 无溯源、kind 用错、span end≤start、span 与 statement 切片不一致、有 source_facts 但无 statement、derived inputs 悬空 |
| E_CAPABILITY_UNSUPPORTED | CAPABILITY | 未注册 ID、domain 段与 math.domain 不一致、使用了未在 math.capabilities 声明的 capability |
| E_MATH_CONSTRAINT | SOLVE | 参数 min>max、timeline to≤from、重复 track_id（跨字段检查） |
| E_MATH_ASSERTION | ASSERTION | P1+ 数值验证失败（P0 仅定义） |
| E_BINDING | BINDING | scene/timeline/math 内部引用不存在的实体、事实或对象 |
| E_SCENE_COVERAGE | LAYOUT | P1+ 布局覆盖检查（P0 仅定义） |
| E_NONDETERMINISTIC | DETERMINISM | G9：注入随机函数/时间引用 |
| E_RENDER | RENDER | P1+ 渲染期（P0 仅定义） |

## 运行

```bash
cd mathviz
npm install
npm run build:player   # 浏览器 bundle（examples/p1/dist/runtime.bundle.js）
npm run gates          # p0：44 fixtures → runs/p0/report.json；p1：G9/G10 → runs/p1/
npm test               # vitest 90 断言（p0 60 + p1 30）
npx tsc --noEmit
```

## P1 冻结语义（摘要）

- `stateAt(t)` 纯函数；`setFrame(n) === stateAt(n / fps)` 是唯一帧公式（帧从 0 起，上限 floor(duration×fps)）。
- 映射窗口 `[from, to)` 半开、末窗闭合；重叠 → E_NONDETERMINISTIC；窗口外 modelTime = null。
- 同刻 show+hide / 双 camera / caption 区间相交 → E_NONDETERMINISTIC；at/until/from/to 出界或 until ≤ at → E_SCHEMA。
- 表达式：冻结词表；int/rational 精确（bigint），超越函数确定性数值；缺符号 → E_BINDING；除零/sqrt负/log非正/asin越界 → E_MATH_CONSTRAINT。
- Binding property path：entity 走 props、fact/param 走对象本体、runtime 求值后下钻；缺环 → E_BINDING；未实现 transform → E_CAPABILITY_UNSUPPORTED。
- Renderer 只消费 (RuntimeState, SceneIR)；Math IR / Timeline / binding 一律不碰。
- 浏览器 player：`window.mathviz.{seek,play,pause,setFrame,getState}`；`<body data-rendered-frame data-state-digest>`；headless 入口 `?frame=N`。

## P0 验收口径（全部达成）

- 20 valid 全 PASS / 24 invalid 全 FAIL，且每个期望错误码都出现在实际发出的错误码中（允许额外错误码）；
- serialize→deserialize→serialize 字节稳定（逐 fixture）；
- 未知 capability → E_CAPABILITY_UNSUPPORTED；
- source fact 无溯源 → FAIL（E_PROVENANCE）；
- Scene 引用不存在的 math 绑定 → FAIL（E_BINDING）；math 内部（constraint/assertion/event/runtime depends_on）悬空引用同罪。
