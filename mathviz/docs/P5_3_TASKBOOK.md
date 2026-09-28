# MathViz P5.3 — Parser Precision / Completeness 实施任务书

## 0. 基线与裁决

基线：

```text
P5.2 implementation:
0234ea2

P5.2 independent replication preregistration:
1e2c6ec

P5.2 terminal verdict:
882739302fa67ab1b9e8702a240af99cb9f87f1a
```

P5.2 最终状态：

```text
G19 grounding / repair mechanism:
PASS in both independent live runs

P5.2 overall:
FAIL

Parser:
NOT FROZEN
```

禁止继续：

```text
第三次运行 v2 benchmark
修改 v2 dataset
修改 v2 scoring policy
修改 v2 threshold
对 P5.2 重新判分
```

P5.3 使用：

```text
新的 prompt-policy version
新的 benchmark v3
新的 freeze hashes
新的独立 live acceptance
```

---

# 1. P5.3 解决的四个真实失效类

## A. Declared-entity completeness

代表：`fx_wd_01`

连续三次 live 均出现：

```text
source:
f(x) = x² - 9

candidate:
只生成 equation
漏掉显式声明的 function entity
```

这是可重复 parser 缺口。

目标：

> 与目标数学语义有关且在原文中显式声明的 source entity，不得被“等价求解结构”吞掉。

## B. Goal-irrelevant over-extraction

代表：`mo_ir_02`

模型曾生成一个真实、有 provenance、G19 可 grounding，但与目标无关的 `treeSpacing = 5m`。

因此：

```text
grounded != relevant
```

P5.3 必须增加 precision 约束。

## C. Source-expression loss

代表：`fx_ir_02`

```text
source:
x - 3 = 0

candidate:
lhs = x
rhs = 0
```

现有 G19 只能证明 candidate AST token 能在 source 找到，却不能证明 source 中的重要 token 没被模型漏掉。

因此必须增加：

```text
source → candidate
```

方向的完整性验证。

## D. Single-budget convergence

代表：`geo_wd_01`

一次生成出现多个 grounding findings，而唯一 repair 只修掉其中一部分，最终 REJECT。

单 repair budget 不改。

P5.3 的目标是：

> 在一次 repair 前尽可能把全部 deterministic fidelity findings 聚合起来，让一次 repair 同时看到完整问题集合。

不是增加第二次 repair。

---

# 2. 架构原则

P5.3 不改变：

```text
ProblemSpec schema
Math IR
DomainAdapter
solver
Runtime
Scene IR
G19 semantics
MAX_REPAIRS = 1
```

除非实现过程中证明现有 ProblemSpec 无法表达正确 source semantics，否则禁止 schema drift。

主链升级为：

```text
LLM A1
 ↓
Schema
 ↓
Semantic validation
 ↓
Source Fidelity Gate      ← P5.3
 ├─ completeness
 ├─ expression fidelity
 └─ relevance / precision
 ↓
Deterministic compile
 ↓
G19 grounding
 ↓
ACCEPT

任何 repairable findings
 ↓
aggregate errors
 ↓
唯一一次 repair
 ↓
完整主链重新执行
```

---

# 3. 新增 G20 — Source Semantic Fidelity

建议：

```text
G20_SOURCE_FIDELITY
```

G20 不做通用 NLP entailment。

它和 G19 一样：

```text
bounded
domain-specific
deterministic
fail-closed
```

---

# 4. G20-A — Declared Entity Completeness

第一版优先实现证据最强的 Function2D。

对于受支持语法：

```text
f(x) = <expression>
```

若：

```text
statement 显式声明 named function
AND
goal 明确引用该函数语义
```

则 ProblemSpec 必须存在对应：

```text
kind = function
```

且 `variable / expr / provenance` 与原声明一致。

例如：

```text
求函数 f(x)=x²-9 的所有零点
```

正确结构必须保留：

```text
source declaration:
function f(x)=x²-9

goal interpretation:
solve f(x)=0
```

不能只留下：

```text
equation x²-9=0
```

错误：

```text
E_SOURCE_COMPLETENESS
```

repair hint 只能说明合同要求，不得提供函数名、正确 AST、golden span 或答案。

---

# 5. G20-B — Bidirectional Expression Fidelity

G19 当前解决：

```text
candidate AST token
→ source evidence
```

P5.3 新增：

```text
source mathematical expression
→ candidate AST
```

对 frozen Function2D expression subset：

```text
integer / rational
symbol
+
-
*
/
^ integer exponent
=
```

建立 deterministic source-expression parser / canonicalizer。

例如：

```text
x - 3 = 0
```

必须解析并与 candidate AST 做 canonical semantic comparison。

以下必须失败：

```text
source: x - 3 = 0
candidate: x = 0

source: x² - 9 = 0
candidate: x² = 0

source: 2x + 3 = 7
candidate: 2x = 7
```

错误：

```text
E_SOURCE_EXPRESSION_LOSS
```

不要靠“数字 3 是否出现”这类 regex 代替 AST 结构比较。

支持范围外：

```text
G20 = N/A / unsupported verifier surface
```

不得假装验证成功。

---

# 6. G20-C — Goal-Relevance / Precision

建立 ProblemSpec dependency graph。

Roots：

```text
goal.inputs
```

向下遍历：

```text
entity → referenced entity
entity → fact
entity → parameter
constraint → subjects / params
function → parameter bindings
body → initial position / segment facts
```

另外允许 G20-A 要求保留的 source declaration 成为 supporting root。

最终所有：

```text
source_facts
entities
parameters
constraints
```

必须：

```text
reachable from goal semantics
OR
required source-declaration anchor
```

否则：

```text
E_SOURCE_IRRELEVANT
```

这冻结的是：

> ProblemSpec 不是全文知识抽取，而是当前数学目标所需 source semantics 的最小闭包。

---

# 7. Prompt 同时冻结 completeness 与 minimality

不能写：

```text
Extract every mathematical-looking fact.
```

应冻结成：

```text
Preserve every explicit mathematical entity or fact
that is necessary to represent the stated goal and its source model.

Do not extract decorative, contextual, or numerically stated information
that is not connected to the goal's mathematical dependency graph.
```

所以 completeness 与 minimality 必须同时要求。

---

# 8. A1 Prompt Policy v3

新版本：

```text
p5.3-policy-v1
```

不要继续改 `p5.2-policy-v1`。

A1 system contract 增加：

```text
1. Preserve all explicitly declared mathematical entities required
   to interpret the requested goal.

2. Copy source expressions structurally and completely.
   Never drop terms, coefficients, operators, or equation sides.

3. Emit only source semantics that participate in the goal's
   dependency graph. Do not extract unrelated numerical facts.

4. Before emitting JSON, silently check:
   - required declared entities are represented;
   - source expressions are complete;
   - every emitted fact/entity is goal-relevant.
```

输出仍然 JSON only，不增加 reasoning、checklist text、confidence 或 chain-of-thought。

---

# 9. 不采用 case-specific few-shot 修补

允许增加简短 contract example，但禁止：

```text
复制 fx_wd_01 原题
复制其 golden
用近乎同文的 benchmark case 作为 prompt example
```

Few-shot 和 benchmark v3 必须题面、数字、措辞不同。

---

# 10. G20 与 G19 findings 聚合

对于 schema + semantic 已成立的 candidate：

```text
G20 findings
+
G19 findings
```

应聚合后再决定 repair。

不要：

```text
先 G20 fail → repair
修完后才第一次看到 G19
```

因为 repair budget 只有一次。

推荐：

```text
schema
semantic
 ↓
compile viability
 ↓
G20 + G19 diagnostics
 ↓
aggregate
 ↓
one repair
```

如果 compile 本身失败但错误 repairable，也尽量同时返回可独立计算的 G20 findings。

---

# 11. Repair Prompt

继续保留 P5.2 三条：

```text
Do not change a mathematical value merely to satisfy grounding.

Prefer correcting provenance.

If source does not support a claim, do not invent evidence.
```

P5.3 增加：

```text
Do not delete an explicitly declared source entity merely because
the goal can be solved without representing that declaration.

Do not omit any term/operator from an explicit source expression.

Remove source facts/entities that are unrelated to the requested
goal rather than preserving them merely because they are true.
```

repair 仍返回完整 ProblemSpec，`MAX_REPAIRS = 1` 不变。

---

# 12. P5.3 不解决 mo_wd_05

继续冻结：

```text
KNOWN_GROUNDING_MODEL_LIMITATION
relational direction → per-body signed velocity
```

P5.3 不新增 `opposite_direction`，不改 Motion schema。

在 benchmark v3 中，这类 case 应预先分类为：

```text
KNOWN_LIMITATION_EXPECTED_REJECT
```

要求 fail-closed，而不是计为普通 COMPILE_OK core-match case。

这是新 benchmark 的预声明设计，不回改 v2 历史。

---

# 13. Benchmark v3

v2：

```text
保留
不可修改
只作为 regression / historical evidence
```

P5.3 建立：

```text
fixtures/parser-bench-v3/
```

建议：

```text
72 个新题
24 / domain
```

全部题目在 live 前完成：

```text
人工 golden
semantic audit
grounding audit
freeze hash
scoring policy hash
```

---

# 14. v3 题型组成

72 题：

```text
48 general cases
24 targeted challenge cases
```

24 challenge：

```text
6 declared-entity completeness
6 irrelevant grounded distractor
6 expression completeness / term-loss
6 multi-finding / one-repair convergence
```

不得直接复用：

```text
fx_wd_01
mo_ir_02
fx_ir_02
geo_wd_01
```

只能复用“失效类型”。

---

# 15. v3 每域建议结构

每 domain 24：

```text
8 straightforward
4 wording variation
4 irrelevant-information
4 compositional / completeness
2 unsupported
2 harder repair / provenance
```

可按 domain 特性微调，但三域总数固定。

---

# 16. v3 Golden 审计

第一次 live 之前必须独立审一次 golden。

重点检查：

```text
显式 function/entity 不遗漏
expression AST 与原文逐项一致
irrelevant 信息没有混入 golden
signed direction provenance
goal dependency graph
expected status
```

freeze 之后：

```text
禁止根据 live output 修改 golden
```

如果以后发现 golden bug：

```text
本轮 live verdict 保留
→ 新 benchmark version
→ 新独立 run
```

---

# 17. v3 新指标

新增 G20 指标：

```text
declared_entity_completeness
expression_fidelity
goal_relevance_precision

silent_fidelity_error_count
fidelity_repair_success_rate
```

最重要：

```text
silent_fidelity_error_count = 0
```

challenge 中错误 source semantics 可以被 repair correct 或 fail-closed reject，但不能错着 ACCEPT。

---

# 18. Challenge acceptance

24 个 challenge cases：

```text
silent accepted semantic errors = 0

declared-entity challenge:
detected-or-correct = 6/6

expression-loss challenge:
detected-or-correct = 6/6

irrelevant-overextract challenge:
detected-or-correct = 6/6

multi-finding challenge:
no second repair
no semantic regression
```

最终 accepted core-match 建议：

```text
>= 22/24
```

剩余可以 fail-closed，但不能错着 ACCEPT。

---

# 19. Overall live acceptance

72 题：

```text
final schema/semantic valid >= 98%

core semantic match >= 95%

goal capability accuracy >= 95%

supported compile success >= 90%

G19 final grounding >= 98.5%

answer leakage = 0

repair_semantic_regressions = 0

silent_fidelity_error_count = 0
```

known limitations 按预冻结 expected-reject 单独统计，不进入普通 core-match 分母。

---

# 20. Offline regression

P5.3 live 前必须：

```text
P0–P5.0 ALL GREEN

P5.1 / P5.2 unit regression PASS

v2 replay PASS
169/171 historical G19 calibration unchanged

G17 contract PASS

new G20 adversarial tests PASS
```

新增 regression：

```text
explicit function omitted
→ E_SOURCE_COMPLETENESS

x - 3 = 0 parsed as x = 0
→ E_SOURCE_EXPRESSION_LOSS

true-but-unreachable fact
→ E_SOURCE_IRRELEVANT

multiple G20+G19 findings
→ exactly one repair call

repair fixes G20 but leaves G19
→ REJECT, no second repair

repair fixes G19 but creates irrelevant fact
→ REJECT, no second repair
```

---

# 21. P5.3 执行分期

## P5.3A — Fidelity Contract

实现：

```text
G20-A declared entity completeness
G20-B source-expression bidirectional fidelity
G20-C relevance graph
```

只跑 synthetic/unit/replay，不调用 live LLM。

## P5.3B — Prompt + Repair Integration

冻结：

```text
p5.3-policy-v1
```

接入：

```text
G20 + G19 aggregate findings
single repair
full re-run
```

跑 adversarial regression。

## P5.3C — Benchmark v3 Construction

创建：

```text
72 fresh cases
goldens
scoring policy v3
freeze manifest
```

先人工/程序双审计，再冻结 hashes。

## P5.3D — Pre-registration

新增：

```text
P5_3_INDEPENDENT_LIVE_PROTOCOL.md
```

在 live 前提交。

记录：

```text
dataset hash
policy hash
prompt-policy version
model id
thresholds
single-run rule
no post-run benchmark edits
```

## P5.3E — One Independent Live Run

只运行一次完整 72-case benchmark。

禁止：

```text
中途调整
选择性重试
case-specific rerun
prompt 修改
```

结果无论 PASS/FAIL 都完整入档并提交。

---

# 22. P5.3 通过后的动作

所有冻结 Gate PASS 后：

```text
P5 PARSER FINAL FROZEN
```

正式停止 parser correctness 开发，进入：

```text
P6 Teaching Planner
```

之后 parser 只允许：

```text
bugfix with regression
new domain
new capability
明确 contract version change
```

不得继续针对现有 benchmark 刷分。

---

# 23. 如果 P5.3 仍 FAIL

禁止直接再跑一次。

根据诊断开：

```text
P5.4
```

先区分：

```text
deterministic gate缺口
prompt/model稳定缺口
benchmark contract问题
provider/model variance
```

然后重新冻结版本。

---

# 24. Token 成本暂不优化

P5.3 不做：

```text
A0 删除
schema 压缩
few-shot token 压缩
repair patch化
model 替换
```

Parser FINAL FROZEN 后单独做：

```text
Parser Cost Optimization
```

---

# 25. 最终验收句

> P5.3 完成后，MathViz Parser 不仅能够保证所有输出事实有原文 grounding，还能机器发现并修复“显式源实体遗漏、源表达式丢项、目标无关事实过抽取”等 source-semantic fidelity 问题；错误不能静默穿过 ProblemSpec 边界，且整个纠错流程仍只有一次有界 repair。

---

# 26. 立即执行顺序

```text
A1. 实现 G20-A declared-entity completeness
A2. 实现 G20-B source-expression bidirectional fidelity
A3. 实现 G20-C goal dependency / relevance closure
A4. adversarial tests

B1. prompt-policy → p5.3-policy-v1
B2. aggregate G20 + G19 repair findings
B3. 保持 global repair budget = 1
B4. offline regression

C1. 构建 72-case benchmark v3
C2. golden audit
C3. freeze dataset/policy hashes

D1. preregistration commit
D2. 一次 independent live
D3. 无论结果如何提交 verdict
```

P5.3A–C 不需要再次等待确认；完成 benchmark freeze 后，如果安全 provider 凭据在环境中可用，可按预登记直接执行 D 的一次 live run。若凭据不存在，则停在 `LIVE BLOCKED`，不得复用聊天中暴露过的旧密钥。
