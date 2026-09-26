# MathViz P2 — Geometry2D Adapter / Verified Geometry Model

- 日期：2026-09-26
- 基线：P0.1 `a89ba84`；P1 `0e7ff06`
- Geometry DSL：`shand001/geometry-dsl` V0.4.0，pin `c7ee10030c175acad792ba82b53af540f2b578f8`（MIT）
- 验收结果：`npm run gates` → **P0/P1/P2 ALL GREEN**；`npm test` → **113/113**；`npx tsc --noEmit` → 0 错。

## 一句话架构

> Geometry Math IR → compile-once Geometry Compiler → `VerifiedGeometryProgram` → pure `evaluate(modelTime)` → `GeometrySnapshot` → snapshot-first entity binding → `RuntimeState` → paint-only SVG renderer。

P2 实际移除了逐帧/题目专用几何 JavaScript：`examples/p2/index.html` 仅提供通用播放器；页面不计算旋转、不解析 `.geom`、不补坐标。compiled fixture 完全由 player 生成器内嵌，测试逐对象比较页面项目和 fixture。

## 架构边界

### DomainAdapter 扩展点

`packages/runtime/src/domain.ts` 定义与具体域无关的 Provider 合同：

- `compile(math)` 在 `loadRuntime` 时执行一次；G4 以两个有效 fixture 和五种负向变异确认 program digest 稳定及错误分类正确；
- `evaluate(program, {modelTime, env, resolveBinding})` 对每个状态纯求值；
- `assert(program, snapshot)` 返回带 expectation 的断言结果；
- adapter 未注册而 Math IR 有 compiled construction → `E_CAPABILITY_UNSUPPORTED`；dynamic entity 不得回退到静态 props。

Runtime 不 import geometry2d 或 Geometry DSL。DomainSnapshot 是 runtime 按结构消费的实体字典和 digest。entity binding 优先 `DomainSnapshot.entities[id]`；仅当该 id 不由 DomainSnapshot 产出时才回退静态 `MathIR.entities[].props`。P1 motion1d 调用路径不变，原 P1 digest 仍由 G10 复验。

### VerifiedGeometryProgram 与构造

`packages/domains/geometry2d/` 将点/线/圆、依赖引用、construction capability、静态 ExprAst/精确字符串、assertions 编译为冻结 program，构造依赖做拓扑排序并检测 cycle。支持：

- primitive：point / segment / line / circle；
- constructions：midpoint / intersection_point / projection_point / rotate_point / translate_point / reflect_point；
- predicates：parallel / perpendicular / equal_length / collinear / on_circle / distance_equal / angle_mark；
- G4 稳定失败：cycle → E_SCHEMA；悬空实体 → E_BINDING；静态坐标暗用 `t` → E_SCHEMA；注册表中存在但 adapter 未实现（如 locus）→ E_CAPABILITY_UNSUPPORTED。

快照形状固定：point `{kind:"point",position:{x,y}}`；segment/line `{kind,a,b}`；circle `{kind:"circle",center,radius}`。数值化只发生于 geometry2d domain，Math IR 的 rational/string/ExprAst 不被浮点结果回写。

### t 与参数（按用户裁定）

`t` 永久保留为当前 model time。`theta/u/a/k` 等数学参数独立；P2 fixture 显式写 `theta_at_t = 2π·t`，M/N 旋转构造引用 `runtime:theta_at_t`。runtime env 中参数默认值与保留 `t` 分开，不做隐式别名。滑块未来走 `param:theta`，不复用 model time。

### 标记是断言，不是装饰

G5 先验证所有约束/断言 expectation；违反即 `E_MATH_ASSERTION`，不产生 RuntimeState 给 renderer。每个 Scene mark 还须：

1. binding 指向 `math:fact:F`（被视觉化的数学声明）；
2. `attach_to` 可解析为实体集合；
3. 当前时间存在与该集合完全对应的 PASS assertion。

冻结映射：right_angle_mark → perpendicular；Scene 的既有 `equal_tick` → equal_length（registry capability 名仍是 `geometry2d.equal_mark`）；parallel_mark → parallel；angle_mark → angle_mark（`params.value` 为度）。无对应 PASS assertion 或绑定错误都报 `E_MATH_ASSERTION`。无静默画“看起来对”的路径。

### Numeric policy

唯一 MathViz geometry 常量 `GEOMETRY_EPS = 1e-9`，版本 `geometry2d/0.1.0`；关系谓词使用归一化 dot/cross 比较，长度/圆等按该固定 policy 比较。上游 Geometry DSL 自身 kernel 保留其内部误差策略；跨实现比较阈值统一使用 MathViz `GEOMETRY_EPS`。未把浮点结果写回 Math IR。

## Geometry DSL pin 与隔离

- 只桥接上游公开 geometry export 的 kernel（midpoint/rotate/intersection/projection）；没有 parser `.geom`、upstream SVG renderer、timeline、Scene、player 或逐帧 DSL 编译。
- upstream geometry kernel 源码和 MIT LICENSE 以 pin commit 原样固化在 `packages/adapters/geometry-dsl/vendor/geometry-dsl/`，并含 `PINNED_COMMIT` 与规范化 SHA256 `UPSTREAM_SHA256SUMS`（G11 启动时逐文件验证 pin 和源码 hash）；这样 G11 可离线复现。仓库完整 checkout 仅用于开发期核对来源，位于 gitignored `vendor/geometry-dsl/`。
- 上游类型只在 `packages/adapters/geometry-dsl/` 边界；Runtime/Math IR/Scene IR/renderer/geometry2d public types 均不依赖 upstream 类型。
- node-only `oracle.ts` 的 G11 用独立实现对照 MathViz 快照；Geometry DSL 没有进入浏览器 bundle，也没有被 stateAt 调用。MathViz construction math 自己实现，未复用上游 helper，避免假交叉验证。

## 三个 fixtures

1. `fixtures/p2/square-rotation.compiled.json`：正方形 side=`3√2`、BD=6；P 在 BD 且 BP=1；Q 在 BC 且 ∠BPQ=90°；△BPQ 顺时针绕 B 转一周；M/N 为旋转像，E=midpoint(N,D)。轨迹圆是 Math IR 中的 circle entity，G5 每锚点验证 E 在圆上。Scene 有 A/B/C/D/P/Q/M/N/E、边/中线段、轨迹圆和 assertion-backed marks；G5 每个锚点逐项确认右角、等长 mark 均由相同实体集合的 PASS assertion 支持。
2. `fixtures/p2/static-construction.compiled.json`：固定三角形的 projection F、midpoint M1/M2、两条中线交点 I；含垂直/共线/等长/距离 assertions 与 right/equal marks。
3. `fixtures/p2/invalid-geometry.json`：故意将 Q 移离使 ∠BPQ≠90°的位置，但保留 right-angle 声明/mark；Runtime 稳定返回 `E_MATH_ASSERTION`，不允许渲染。

这不是把原 `problems/p1.html` 的几何 JS 搬到新页面；只是依照 P2 指定数学模型建立编译输入。P1 页面仅作视觉/数学参考。

## Gates 与证据

- **G1/G2/G3/G6**：P2 project fixtures 直接复用 P0 contracts `runCase`；三个项目 schema / provenance / capability closure / binding 全 PASS。G3 同时将实体 construction 的 `props.capability_id` 纳入使用闭包。
- **G4**：两份有效项目 compile；5 个负向变异（cycle、missing ref、未实现 locus、静态坐标引用 t、缺 DomainAdapter）分别命中稳定错误码。
- **G5**：valid 项目所有锚点 assertions/marks PASS；invalid-geometry、缺 mark 对应断言、缺 source-fact mark binding、forbidden expectation 违例全部被拒绝。
- **G9**：0° 到 360° 的 9 个锚点，每个 `stateAt` 重复 100 次，state digest 一致。
- **G10**：node `stateAtFrame(n)` vs Chrome headless `?frame=n` 页面 `data-state-digest`，9 帧逐位相等；页面 `data-rendered-frame` 与请求一致。
- **G11**：31 个独立比较（9 锚点 × M/N rotation + E midpoint = 27；静态 M1/M2 midpoint、F projection、I intersection = 4），MathViz 与 pin 的 Geometry DSL kernel 最大位置差 `4.44e-16`，阈值 `1e-9`。

所有文件由 `npm run gates` 生成/重建：

- `runs/p2/gates.json`
- `runs/p2/geometry-vectors.json`
- `runs/p2/oracle-comparison.json`

## Known Vectors：旋转角锚点

| θ | presentation t | model_time | M (x,y) | N (x,y) | E (x,y) |
|---:|---:|---:|---|---|---|
| 0° | 0.0 | 0.000 | (0.707107, 3.535534) | (1.414214, 4.242641) | (2.828427, 2.121320) |
| 45° | 1.5 | 0.125 | (0.000000, 3.242641) | (1.000000, 3.242641) | (2.621320, 1.621320) |
| 90° | 3.0 | 0.250 | (-0.707107, 3.535534) | (0.000000, 2.828427) | (2.121320, 1.414214) |
| 135° | 4.5 | 0.375 | (-1.000000, 4.242641) | (-1.000000, 3.242641) | (1.621320, 1.621320) |
| 180° | 6.0 | 0.500 | (-0.707107, 4.949747) | (-1.414214, 4.242641) | (1.414214, 2.121320) |
| 225° | 7.5 | 0.625 | (0.000000, 5.242641) | (-1.000000, 5.242641) | (1.621320, 2.621320) |
| 270° | 9.0 | 0.750 | (0.707107, 4.949747) | (0.000000, 5.656854) | (2.121320, 2.828427) |
| 315° | 10.5 | 0.875 | (1.000000, 4.242641) | (1.000000, 5.242641) | (2.621320, 2.621320) |
| 360° | 12.0 | 1.000 | (0.707107, 3.535534) | (1.414214, 4.242641) | (2.828427, 2.121320) |

每行的完整 `geometry_snapshot_digest` 和 `runtime_state_digest` 存于 `runs/p2/geometry-vectors.json`。frame 为 `0,36,...,288`（fps=24）。

## Renderer / player

`examples/p2/index.html` 由 `scripts/gen-p2-html.mjs` 从 square fixture 生成，通用控制 API：`window.mathviz.{seek,play,pause,setFrame,getState}`。所有动作最终走同一 P1 evaluator；frame 公式不变 `setFrame(n) === stateAt(n/fps)`。renderer 只把 Snapshot 已有位置映射到像素，确定性 fit 覆盖 state 中所有几何（隐藏对象也参与 bounds，减少镜头跳动）；这是一项暂定的 P2 presentation policy，正式 viewport/camera/world-window 合同留到 P3。

## 复现

```bash
cd mathviz
npm install
npm run gates       # P0 + P1 + P2 gates；会生成页面与 bundle
npm test            # 113/113
npx tsc --noEmit
```

## 冻结边界 / 已知限制

P2 明确只实现本轮 geometry2d 子集；ray/arc/polygon/locus/derive_length 等 registry ID 保留但 `supports() === false`。暂无复杂 locus solver、region、advanced curve、学生参数滑块、正式 camera/world-window/自动 layout。`distance_equal` 是在建议的 P2 核心列表上额外实现的一项 registry predicate，用来把长度事实 BD=6、BP=1 作为真实 assertion 验证；其余超出建议范围的 capability 没有暗中扩张。

**验收判断**：同一个 square-rotation compiled project 经 Runtime 的冻结 DomainAdapter 变为几何快照，Chrome interactive 页面可 play/pause/seek/setFrame；9 个随机可寻址 anchor 重算一致；G5 阻止错误 mark；G11 与上游 pinned kernel 独立比对通过。MathViz runtime 未变成“知道这是一道正方形旋转题”的题目引擎。
