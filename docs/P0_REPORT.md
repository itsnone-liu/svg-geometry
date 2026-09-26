# MathViz Engine v0.1 — P0 Contracts 交付报告

- 日期：2026-09-26
- 范围：**仅 P0**（合同冻结层）。不含 renderer / domain solver / LLM parser / Geometry DSL。
- 包：`mathviz/`（mathviz-contracts@0.1.0, CJS, Node 24, Ajv 2020-12, tsx, vitest 3, tsc noEmit）
- 状态：**P0 GATES: ALL GREEN**（20/20 valid PASS，20/20 invalid FAIL 且全部命中期望错误码）；vitest 53/53；`tsc --noEmit` 0 错。

## 交付物

| 冻结件 | 版本 | 内容 |
|---|---|---|
| Math IR | mathviz.math/v1 | source_fact / derived_fact / runtime_value 三分；溯源强制（G2） |
| Scene IR | mathviz.scene/v1 | 27 原语；无数学坐标；binding 必填；27 键封闭 style；9 向 label_layout |
| Timeline | mathviz.timeline/v1 | show/hide/highlight/dim/caption/camera/map_model_time；easing:linear |
| Project | mathviz.project/v1 | manifest 版本戳（schema/engine/domain/adapter [+registry/problem]） |
| 能力注册表 | 1.0.0 | 40 项，三域（geometry2d 25 / function2d 8 / motion1d 7）两段式稳定 ID（P0.1 勘误：初版报告误记 39） |
| 错误目录 | 1.0.0 | 10 码 / 9 族；目录外错误码 = harness bug（throw） |
| Gate harness | — | G1 schema（含跨字段）/ G2 provenance / G3 capability / G6 binding / G9 determinism |
| Fixtures | mathviz.fixtures/v1 | 20 valid + 24 invalid（P0.1 增 4 例），覆盖 math/scene/timeline/project 四种 kind |

## 硬验收对照（用户口径）

1. 20 valid 全 PASS ✅（`npm run gates` 表格全部 OK PASS-EXP）
2. 20 invalid 全 FAIL 且命中 expected_error_code ✅（期望错误码必须全部出现在实际发出的错误码中，允许多出额外错误码；P0.1 后为 24 例）
3. serialize→deserialize→serialize 字节稳定 ✅（全部 fixture 逐一断言 + 已知向量）
4. 未知 capability → E_CAPABILITY_UNSUPPORTED ✅（inv-unknown-capability / inv-capability-wrong-domain）
5. source fact 无溯源 → FAIL ✅（inv-source-fact-no-provenance → E_PROVENANCE）
6. Scene 引用缺失 math 绑定 → FAIL ✅（inv-project-scene-dangling-binding → E_BINDING）
   - 加强：math 内部（constraint/assertion subject_refs、event participants、runtime depends_on）悬空引用同样 E_BINDING（inv-assertion-dangling-ref）。

## 门控矩阵（要点）

- **G1_schema**：Ajv 2020-12 全字段校验 + 跨字段检查：重复实体 id、参数 min>max → E_MATH_CONSTRAINT、timeline to≤from、重复 track_id。
- **G2_provenance**：source 必须 problem_text+span(end>start)；derived 必须 derived+注册表 capability+inputs 可解析；违规归 E_PROVENANCE（非 E_SCHEMA，目录语义分离）。
- **G3_capability**：capabilities/constraints/assertions/events 全部两段式、注册表内、domain 段与 math.domain 一致。
- **G6_binding**：scene object binding / attach_to / 顶层 binding.objectId / timeline target+camera.center_on 必须解析；math 内部引用完整性（见上）。
- **G9_determinism**：文档内禁 `Math.random`/`Date.now` 类引用（字符串扫描），输出 canonical digest 供复现比对。

## 关键实现决定（偏差记录）

1. **内部 $id 与合同版本串分离**：Ajv 跨文件 $ref 需要绝对 URI，故 schema 文件内部 `$id/$ref` 用 `https://mathviz.dev/schemas/<name>/v1`；但文档里 `schemaVersion` 常量仍是合同口径 `mathviz.<name>/v1`（与 fixtures/manifest 一致）。两者一一对应，不改用户命名约定。
2. **G6 扩展到 math 内部引用**：原计划只查 scene/timeline；为满足“任何悬空引用 FAIL”的口径，把 math 内部引用也纳入 G6（错误族不变 E_BINDING）。
3. **期望码子集判定**：invalid case 判定采用子集语义——每个期望错误码都必须出现，额外错误码允许（如缺 domain 同时触发 E_SCHEMA 与 E_CAPABILITY_UNSUPPORTED）。
4. **tsc 仅作类型门**：运行走 tsx（dev），构建冻结留给 P1 编译产物阶段（adapter_versions 已预留 pin 位）。

## P0.1 Contract Hardening（审计后追加，基线 b7fd79b 之上）

审计反馈三项，全部落地：

1. **A1 溯源回指原文**：G2 不再只查 span 结构，强制 `statement.slice(span.start, span.end) === span.text`；有 source_facts 但缺 statement 同样 E_PROVENANCE。全部 valid fixture 的 span 已重写为 statement 的真实切片（脚本对齐 + 抽查）。新增 invalid：inv-provenance-text-mismatch / inv-provenance-span-out-of-range / inv-source-fact-without-statement。
2. **A2 capability 声明闭包**：derived provenance / constraints / assertions / events 实际使用的 capability 必须 ∈ math.capabilities（declared-but-unused 仍允许，parser 可预声明）。新增 invalid：inv-used-capability-not-declared；project-minimal fixture 补声明 motion1d.solve_position。
3. **A3 统计勘误**：registry 实为 40 项（geometry2d 25 / function2d 8 / motion1d 7），初版报告的 39 为统计漂移，代码无改动、不删 capability。

P0.1 后：gates 20 valid 全 PASS + 24 invalid 全命中；fixtures 总数 44。

## 复现

```bash
cd mathviz && npm install && npm run gates && npm test && npx tsc --noEmit
# 期望输出尾行：P0 GATES: ALL GREEN；Test Files 1 passed；tsc exit 0
```

报告工件：`mathviz/runs/p0/report.json`（canonical 序列化 + 每案 sha256 digest）。

## 下一步（P1 预览，不在本次范围）

手写编译项目驱动 runtime：`load → stateAt(t) → seek/pause/play → setFrame(n)`，SVG 状态输出；无 LLM、无 Geometry DSL（adapter_versions 已 pin:pending-P2）。
