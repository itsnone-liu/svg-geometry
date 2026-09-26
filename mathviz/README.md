# mathviz-contracts — MathViz Engine P0 (Contracts Layer)

> 范围纪律：**只做 P0**。不实现 renderer、domain solver、LLM parser、Geometry DSL 集成（那是 P1+）。
> P0 交付：三份冻结合同（Math IR / Scene IR / Timeline）、能力注册表、错误目录、fixtures 与 Gate harness。

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
    registry/capabilities.v1.json   # 39 项能力，registry_version 1.0.0
    errors/error-catalog.v1.json    # 10 错误码 / 9 族，catalog_version 1.0.0
    src/load.ts serialize.ts gates.ts run.ts
  fixtures/p0_cases.valid.json     # 20 例必须全 PASS
  fixtures/p0_cases.invalid.json  # 20 例必须 FAIL 且命中 expected_error_codes
  tests/p0.test.ts                 # vitest：硬验收 + 目录/注册表完整性 + 规范化向量
  runs/p0/report.json              # gate 运行产物（.gitignore）
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
- `serialize → deserialize → serialize` **字节稳定**（全部 40 个 fixture 断言通过）；
- sha256 摘要进 `runs/p0/report.json`，供跨时间复现校验；
- 已知向量：`{"b":1,"a":{"d":[2,1],"c":"x"}}` → `{"a":{"c":"x","d":[2,1]},"b":1}`。

## 错误码一览（v1）

| code | family | 触发示例 |
|---|---|---|
| E_SCHEMA | SCHEMA | 坐标泄入 Scene、缺 binding、span 外任何结构违规、schemaVersion 不匹配 |
| E_PROVENANCE | PROVENANCE | source_fact 无溯源、kind 用错、span end≤start、derived inputs 悬空 |
| E_CAPABILITY_UNSUPPORTED | CAPABILITY | 未注册 ID、domain 段与 math.domain 不一致 |
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
npm run gates   # 40 fixtures → runs/p0/report.json，全绿打印 P0 GATES: ALL GREEN，exit 0
npm test        # vitest 53 断言（硬验收 + 完整性）
npx tsc --noEmit
```

## P0 验收口径（全部达成）

- 20 valid 全 PASS / 20 invalid 全 FAIL，且每个期望错误码都出现在实际发出的错误码中（允许额外错误码）；
- serialize→deserialize→serialize 字节稳定（逐 fixture）；
- 未知 capability → E_CAPABILITY_UNSUPPORTED；
- source fact 无溯源 → FAIL（E_PROVENANCE）；
- Scene 引用不存在的 math 绑定 → FAIL（E_BINDING）；math 内部（constraint/assertion/event/runtime depends_on）悬空引用同罪。
