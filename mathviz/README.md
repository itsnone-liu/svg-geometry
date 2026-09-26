# MathViz Engine — P0.1 Contracts + P1 Runtime + P2 Geometry2D Adapter

> P0/P0.1 冻结并硬化合同；P1 以 G9/G10、30 项测试证明纯函数 Runtime；P2 以 G4-G11、23 项测试验证 Geometry Program 脱离题目专用 JS。
> Geometry DSL V0.4.0 仅作为 pinned compile-time kernel/oracle，不接管 timeline、Scene IR、动画、player、正式 SVG renderer，也不进入逐帧调用。

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
  fixtures/p2/{square-rotation,static-construction,invalid-geometry}.json
  packages/runtime/               # P1/P2 纯函数 runtime（零 node/Ajv/DSL 依赖）
    src/{types,errors,load-project,runtime,digest,domain}.ts
    src/expr/{exact,evaluate}.ts
    src/timeline/{compile,evaluate,model-time}.ts
    src/bindings/{resolve,transform}.ts
    src/scene/{state-at,verify-marks}.ts
    src/run-p1.ts / run-p2.ts      # G9/G10 + G4/G5/G11 runners
  packages/domains/geometry2d/    # P2 Math IR -> VerifiedGeometryProgram -> GeometrySnapshot
    src/{types,constants,validate,compile,evaluate,assertions,adapter}.ts
    src/constructions/ops.ts      # MathViz-owned math (independent of upstream oracle)
  packages/adapters/geometry-dsl/ # node-only bridge/oracle; upstream types quarantined here
    src/{bridge,oracle,errors,version}.ts
    vendor/geometry-dsl/           # pinned kernel subset + MIT LICENSE + PINNED_COMMIT
  packages/renderer-svg/src/render.ts  # RuntimeState+SceneIR -> SVG (P1/P2 paint-only)
  examples/p1/                     # P1 harness
  examples/p2/                     # generated inline fixture + interactive player + bundle
  scripts/gen-p2-html.mjs          # deterministic player generation from square fixture
  tests/{p0,p1,p2}.test.ts        # vitest: 60 + 30 + 23 test cases
  runs/{p0,p1,p2}/                 # gate products (gitignored)
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
npm run build:player            # P1 bundle
npm run build:player:p2         # 由 fixture 生成 examples/p2/index.html + P2 bundle
npm run gates                   # P0 (44 fixtures) + P1 (G9/G10) + P2 (G1-11)
npm test                        # vitest 113 断言（P0 60 + P1 30 + P2 23）
npx tsc --noEmit
```

P2 G11 使用 adapter 包内固定 vendor 源码，**不要求联网、不要求额外 npm 依赖**。上游身份：`shand001/geometry-dsl@c7ee10030c175acad792ba82b53af540f2b578f8`，V0.4.0，MIT；保留许可证、`PINNED_COMMIT` 元数据和规范化源码 `UPSTREAM_SHA256SUMS`，G11 在启动时验证 pin 与所有 vendored 源码 hash。完整仓库的临时开发 checkout（`vendor/geometry-dsl/`）被 gitignore，不参与运行。

## P2 冻结语义

- **参数与模型时间不合并**：`t` 永久是 Runtime 的 model time；`theta/u/a/k` 是显式数学参数。动态量必须写 `theta_at_t = f(t)`，滑块输入走 `param:theta`。
- **DomainAdapter 扩展点**：`loadRuntime(doc,{domains:{geometry2d: geometry2dAdapter}})` 在 load 时 compile 一次；G4 的两个有效 fixture 均能编译，五类非法输入各自命中指定错误；每次 `stateAt` 只 pure-evaluate program。含 compiled constructions 却未注册 provider → `E_CAPABILITY_UNSUPPORTED`，动态 entity 不得静态 props fallback。
- **entity binding 真相**：先查 `DomainSnapshot.entities[id]`，不存在时才回退真正静态 Math entity 的 `props`；geometry2d 不在 Runtime 中写特判。
- **Assertion-backed marks**：right_angle_mark→perpendicular，equal_tick→equal_length，parallel_mark→parallel，angle_mark→angle_mark（角度值用 `params.value` 度）。G5 的有效/缺失 assertion/错 fact/forbidden 四类输入分别确认通过或命中 `E_MATH_ASSERTION`。Mark 必须绑定 `math:fact:F`，attach_to 实体集合须与同 subjects 的 PASS assertion 完全一致。
- **P2 numeric policy**：唯一 `GEOMETRY_EPS=1e-9`，normalized predicate comparisons；Math IR 保持 exact/string/ExprAst，数值化仅在 geometry2d 域。上游 DSL 有自己的 kernel epsilon；G11 跨实现比较统一用 MathViz 的 `GEOMETRY_EPS`。
- **Autofit**：P2 renderer 对当前 RuntimeState 中全部几何（含隐藏实体）确定性 world→screen 映射；同一 state 重复渲染像素坐标不变，但不同 model time 的 geometry bounds 会移动。P3 再冻结固定 camera/world-window 合同。
- **Capabilities**：P2 实装清单是建议核心集（point/segment/line/circle、midpoint/intersection/projection、rotate/translate/reflect、parallel/perpendicular/equal_length/collinear/on_circle 与 marks），加 `distance_equal` 用于执行验证 BD=6、BP=1 等绝对长度事实。Registry 仍保留未实现 ID（ray/arc/polygon/locus/derive_length 等）；例如 `geometry2d.locus` 在 registry 存在但 `supports()` 为 false，compile 明确拒绝。
- Scene IR 已含 right_angle_mark/equal_tick/parallel_mark/angle_mark 和 attach_to 字段；未改 P0 schema。spec 的 equal_mark 语义在 Scene primitive 中对应既有枚举 `equal_tick`，registry ID 仍是 `geometry2d.equal_mark`。

## P1 冻结语义（摘要）

- `stateAt(t)` 纯函数；`setFrame(n) === stateAt(n / fps)` 是唯一帧公式（帧从 0 起，上限 floor(duration×fps)）。
- 映射窗口 `[from, to)` 半开、末窗闭合；重叠 → E_NONDETERMINISTIC；窗口外 modelTime = null。
- 同刻 show+hide / 双 camera / caption 区间相交 → E_NONDETERMINISTIC；at/until/from/to 出界或 until ≤ at → E_SCHEMA。
- 表达式 int/rational 精确（bigint），超越函数确定性数值；缺符号 → E_BINDING；数学定义域错误 → E_MATH_CONSTRAINT。
- `t` 永久是保留的 model time；数学参数不隐式等于 t；动态量需显式 `runtime:theta_at_t=f(t)`。
- P1 browser/node 使用同一份 Runtime 源码；G9/G10 保持 P1 确定性与跨输出检查。

## P0 验收口径（全部达成）

- 20 valid 全 PASS / 24 invalid 全 FAIL，且每个期望错误码都出现在实际发出的错误码中（允许额外错误码）；
- serialize→deserialize→serialize 字节稳定（逐 fixture）；
- 未知 capability → E_CAPABILITY_UNSUPPORTED；
- source fact 无溯源 → FAIL（E_PROVENANCE）；
- Scene 引用不存在的 math 绑定 → FAIL（E_BINDING）；math 内部（constraint/assertion/event/runtime depends_on）悬空引用同罪。
