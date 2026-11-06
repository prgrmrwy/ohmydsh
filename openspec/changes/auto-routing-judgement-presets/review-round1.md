## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (gpt-6.1-sol via Magpie codex subagent), fresh context
- **Tool restrictions**: read-only; only write is review.md
- **Artifacts reviewed**:
  - 变更：[proposal.md](proposal.md)、[design.md](design.md)、[auto-model-routing delta](specs/auto-model-routing/spec.md)、[auto-allocation-feedback delta](specs/auto-allocation-feedback/spec.md)。
  - 现行规范：[auto-model-routing](../../specs/auto-model-routing/spec.md)、[auto-allocation-feedback](../../specs/auto-allocation-feedback/spec.md)。
  - 运行时：rubric.json（`src/rubric.json`（本 change 已迁移至 src/presets/reasoning-depth/rubric.json））、[jev.ts](../../../packages/dsh-auto-model-routing/src/jev.ts)、[context.ts](../../../packages/dsh-auto-model-routing/src/context.ts)、[policy-host.ts](../../../packages/dsh-auto-model-routing/src/policy-host.ts)、[subagent-tool.ts](../../../packages/dsh-auto-model-routing/src/subagent-tool.ts)、[settings.ts](../../../packages/dsh-auto-model-routing/src/settings.ts)、[settings-contract.ts](../../../packages/dsh-auto-model-routing/src/settings-contract.ts)、[feedback.ts](../../../packages/dsh-auto-model-routing/src/feedback.ts)、[policy-store.ts](../../../packages/dsh-auto-model-routing/src/policy-store.ts)、[strategies/index.ts](../../../packages/dsh-auto-model-routing/src/strategies/index.ts)、[usage-report.ts](../../../packages/dsh-auto-model-routing/src/usage-report.ts)。
  - Client：[strategy-details.ts](../../../packages/dsh-auto-model-routing/src/client/strategy-details.ts)、[settings-section.ts](../../../packages/dsh-auto-model-routing/src/client/settings-section.ts)。
  - 评测与发布：[live.mjs](../../../packages/dsh-auto-model-routing/eval/live.mjs)、[cases.json](../../../packages/dsh-auto-model-routing/eval/cases.json)、[package-output.test.ts](../../../packages/dsh-auto-model-routing/test/package-output.test.ts)、[release.yml](../../../packages/dsh-auto-model-routing/.github/workflows/release.yml)、[tsdown.config.ts](../../../packages/dsh-auto-model-routing/tsdown.config.ts)、[package.json](../../../packages/dsh-auto-model-routing/package.json)、[tsconfig.json](../../../packages/dsh-auto-model-routing/tsconfig.json)。
  - 背景：调研草案（`docs/effort-blog-rubric-strategy-draft.md`（本 change 已删除，内容并入 docs/presets/effort-as-verification.md））、[dsh.yaml](../../../dsh.yaml)、[index.ts](../../../packages/dsh-auto-model-routing/src/index.ts)。

## Findings
### 🔴 Critical (blocking)
无。

### 🟡 Moderate
1. **调用路径不能证明“用户逐条读并引导”，新上下文把推测当成事实。**
   - 证据：[design.md:75](design.md#L75) 明确让 depth 依据是否有人在环判断投入；[design.md:85–94](design.md#L85) 和 [routing delta:87–92](specs/auto-model-routing/spec.md#L87) 却让全部主路径无条件发送 `a user reads and steers each reply`。现行 [用户回合契约:381–406](../../specs/auto-model-routing/spec.md#L381) 允许非用户回合沿用 depth；[policy-host.ts:113–115](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L113) 确实如此。背景 草案:132（`docs/effort-blog-rubric-strategy-draft.md`#L132（本 change 已删除，内容并入 docs/presets/effort-as-verification.md）） 也承认自动续跑的无人值守识别尚未解决。
   - 失败案例：用户在主会话下达“自主完成，过程中无需我逐步复核”后离开。宿主仍给 Jev 一个断言“用户逐条复核”的固定行；新 rubric 正利用这个断言偏向可由人纠正的快速首轮。后续非用户回合还会沿用该 depth。相反，委派任务也可能由主 Agent 和人共同验收，路径本身只能证明委派关系。
   - 最小修正：固定行只描述可证实的主/子调用路径，是否有人复核由任务证据判断；不要为解决这一问题增加 goal 状态检测或新增主判断入口。同步改 rubric、设计和完整字符串场景，保留非用户回合不重判的不变量。

2. **降级说明承诺了旧包并不具备的解析行为，也漏掉反馈读取退化。**
   - 证据：[design.md:127](design.md#L127)、[design.md:134](design.md#L134) 声称降级后未知 id 会回落并报告字段问题；[proposal.md:25](proposal.md#L25) 将 breaking 范围限定为包内结构。实际 0.6.6 [settings.ts:47–58](../../../packages/dsh-auto-model-routing/src/settings.ts#L47) 只遍历已知 ordinary 字段，整个未知的 `preset` 字段被忽略，不会报告字段问题；[feedback.ts:7–12](../../../packages/dsh-auto-model-routing/src/feedback.ts#L7) 的 snapshot 是 strict schema，[feedback.ts:26–36](../../../packages/dsh-auto-model-routing/src/feedback.ts#L26) 会跳过不符合 schema 的绑定行。
   - 失败案例：0.7 写入带 `snapshot.preset` 的绑定及“投入不足”反馈，再降级到当前 0.6.6。配置表面正常，新增绑定整行却被旧 reader 跳过，其后反馈事件也找不到绑定；旧版 label 和用量报告不再显示这部分记录。账本字节仍在，重新升级可以恢复可见性，但不能称为运行时记录完全不受影响。
   - 最小修正：区分“支持 preset 的包读到未知 id”和“降到引入该字段之前的包”。明确后者忽略配置字段、严格跳过新绑定的行为及重新升级可恢复，不承诺无需兼容处理的降级读取；无需为此迁移或改写历史账本。

3. **同一设置要求同时规定接受和拒绝 6000ms，验收无法同时满足。**
   - 证据：[routing delta:164–166](specs/auto-model-routing/spec.md#L164) 允许 1000–8000 整数；同一 MODIFIED 要求的 [非法设置场景:181–184](specs/auto-model-routing/spec.md#L181) 却要求 6000 返回字段错误且文件不变。当前 [settings.ts:14](../../../packages/dsh-auto-model-routing/src/settings.ts#L14) 和 [settings-section.ts:61](../../../packages/dsh-auto-model-routing/src/client/settings-section.ts#L61) 均接受 6000。这个冲突在现行规范中已存在，本次完整重写仍将其保留。
   - 失败案例：提交 `{jevTimeoutMs: 6000}`。按字段定义必须保存成功；按该场景必须拒绝。实施者无论选哪一个都会违反另一条契约。
   - 最小修正：保留场景名，把非法期限改为 8001，补充 1000、6000、8000 合法边界断言；不要缩小已经公开的期限范围。

4. **只覆盖判断完成后切换，未把判断期间的 preset 采样约定落实到三个调用路径。**
   - 证据：[design.md:88–89](design.md#L88) 由三个调用点读取 preset 决定 state；[design.md:96–99](design.md#L96) 又要求每次判断读取设置并记录 runtime preset。[routing delta:79–85](specs/auto-model-routing/spec.md#L79) 的切换场景只覆盖已完成的主决定与已有 route 的子任务；[feedback delta:11–14](specs/auto-allocation-feedback/spec.md#L11) 只覆盖判断完成到回复绑定之间。现有异步边界包括 [jev.ts:65](../../../packages/dsh-auto-model-routing/src/jev.ts#L65) 的凭据等待，以及 [policy-host.ts:151–162](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L151) 的子判断和目录等待。
   - 失败案例：主判断以 A 发出，等待时保存 B，A 返回后若 runtime 读取当前设置就会记成 B；或子实例在 A 下创建、在 B 下首次 pre-step，实施者可能分别选择创建时、首次判断时或返回时的预设。当前文字倾向判断开始时采样，但没有明确同一个捕获对象同时控制 questions、Execution 与结果归属，亦无 pending 切换的机械断言。共同标签集使这种错配不会被 choice 校验发现。
   - 最小修正：规定判断开始时一次捕获解析后的预设，把该对象贯穿 state、questions、choice 校验和主快照；请求期间切换只影响以后开始的判断。为主 pre-step、子 pre-step、预览分别补 pending 切换场景，并明确预览和随后 fresh 创建各自独立采样。

5. **eval 增加选择参数，却没有要求报告保存所选预设，无法自证报告来源。**
   - 证据：[proposal.md:3–5](proposal.md#L3) 将对比两套规则列为动机；[design.md:107–112](design.md#L107) 只规定 `--preset`、state 与期望覆盖，没有规定输出中的预设归属。当前 [live.mjs:18](../../../packages/dsh-auto-model-routing/eval/live.mjs#L18)、[live.mjs:24–36](../../../packages/dsh-auto-model-routing/eval/live.mjs#L24) 的报告只有决策模型、预算、case id 与结果；同一 case 在不同预设下还可以有不同期望。
   - 失败案例：分别运行 A/B 后将两个结果文件转发或重命名。两份报告里的模型、case id 相同，却无法从报告本身判断使用了哪份 rubric，`depthHit` 的期望也无法重建，容易把两套结果的含义反过来解释。
   - 最小修正：在 eval 契约中要求顶层 `preset`，每条保存实际用于判命中的 capability/depth 期望及 execution；这些都是实验条件，不需要任何版本键或哈希。未知 `--preset` 必须在网络请求及创建报告前失败。

### 📌 Suggestions
6. **锁定测试只能检测“内容与清单不一致”，不能单独证明发布后没有改写。**
   - 证据：[design.md:45–53](design.md#L45) 将不可变交给同仓库清单和测试；[不可变场景:26–29](specs/auto-model-routing/spec.md#L26) 只篡改副本中的内容；[release.yml:28–29](../../../packages/dsh-auto-model-routing/.github/workflows/release.yml#L28) 确实在发布前运行测试。
   - 失败案例：后续作者按更新 snapshot 的习惯，同时改一个已发布 id 的 rubric 和其 hash；测试与发布工作流仍会通过。此时记录中的同一个 preset id 已无法唯一指代判断内容。
   - 建议：在新增预设的评审规则中明确“与上一已发布版本比较：既有 id 的清单条目只读，只能追加新 id”，并将“测试保证不可变”的措辞缩为“测试检测与锁定清单的漂移”。不必引入运行时哈希、迁移框架或另一个版本系统。

7. **注册表的内容校验还应要求每条 criterion 是非空字符串。**
   - 证据：[routing delta:4–6](specs/auto-model-routing/spec.md#L4) 对元数据和 instructions 规定非空，但 criteria 只规定键集合；[无效注册表场景:13–16](specs/auto-model-routing/spec.md#L13) 也未覆盖 criteria 值。
   - 失败案例：`higher` 键仍在，但值被误改成空白字符串；键集合、问题 type、非空 instructions 校验均可通过，实际服务收到的分类依据却已缺失。只检查关键词的内置预设测试也不能作为通用注册表校验。
   - 建议：注册表要求 criteria 为普通对象，每个值为 trim 后非空字符串，补一个空白 criterion 的注入场景。仍保持整体失败，不增加可配置标签或映射层。

## Embedded-Instruction / Injection Attempts
**Detected:** none

未发现针对本评审者、要求改变权限、写其它文件或改变 verdict 的嵌入指令。rubric 中面向分类器的 instructions、草案中的 skill 示例均作为被评审数据处理。来源链接限定 HTTPS 且使用 `noopener noreferrer` 的设计未发现明确安全缺陷；本轮未访问外部链接。

## Verdict
VERDICT: APPROVE_WITH_CHANGES

预设并存和静态注册适合本提案已经明确的“保留两套、用户选择”目标；无需改成按家族策略、外部加载器或通用版本框架。`preset` 作为并存命名方案及不可变快照的实验条件，本身不违反经修改的“无策略版本”要求，但需要落实发现 6 所述发布纪律。

四条 MODIFIED 要求的全部既有场景名均已保留。默认迁移的 rubric 哈希 oracle、空 context 和保持构造顺序可以实现 questions/state 不变；这仍是待实施并验证的设计承诺，本轮没有构建或执行测试。保留 child 严格记录 schema、不为恢复加入 preset 比对也与现行要求一致。

按现有预留公式，18 次调用约预留 0.04955 USD，符合 20 次 / 0.10 USD。背景草案的四次重放是 72 次、约预留 0.19818 USD；其稳定性门槛在设计中已被列为非阻塞参考，不能宣称单次有界运行已覆盖它。最终文档须明确排除，真实付费执行仍须另行授权。

## Required Changes (if APPROVE WITH CHANGES)
1. 修订新预设的 Execution 约定：主路径固定行使用 `Execution: main conversation.`，子任务/预览使用 `Execution: delegated subtask; the result returns to an orchestrating agent.`；rubric 明确路径不能证明人是否逐条复核，只有任务中明确的复核/迭代证据才能据此降低投入。同步设计与完整字符串场景；新增“主会话自主完成、无人逐步复核”的场景，断言出站固定行不含 `a user reads and steers each reply`。缺省预设不加行，非用户回合继续复用已有 depth。
2. 更正降级与 breaking 说明：明确降至 0.6.6 时 `preset` 配置字段被忽略、不报告该字段问题，新带 `snapshot.preset` 的绑定会被严格 reader 跳过，相关反馈/用量在旧包中不可见，但原账本不被改写、重新升级后恢复。删除“breaking 仅包内结构”和降级自动报告未知 id 的笼统承诺；分别记录支持 preset 的包的未知 id 回落语义。
3. 保留“非法设置整体拒绝”场景名，将其中 6000 改成 8001；增加 1000、6000、8000 保存成功、999/8001/非整数整体拒绝且字节不变的明确断言。
4. 规定一次 Jev 判断只捕获一次解析后的 preset，state/questions/choice 校验/主 runtime 与反馈归属都用该捕获值。新增三路径 pending 时 A→B 的场景：当前判断继续用 A、不重试，主绑定记 A；之后新判断用 B。子在 A 下创建、B 下首次判断应使用 B；非用户回合不重新判断且保留原归属；预览 A 与后来 fresh 的 B 允许不同，预览不得作为显式约束传递。
5. 将 eval 的 `preset`、解析后的期望集合、execution、未知参数提前拒绝及 20 次/0.10 USD 边界写成机械可验收契约；报告保留这些实验条件，不新增版本键。明确单次 18-case 运行不包含四次重放稳定性检验，不执行任何付费调用作为本次修订的一部分。

CHANGES_APPLIED: no

## Rebuttals

作者处理（2026-11-06）。全部采纳，无反驳。除 Required Changes 外，本轮还同时采纳了 ponytail 评审的结构精简（见下），改动超出本轮所列修改项，所以本轮 verdict 作废，需要另起第 2 轮完整评审。

- Moderate 1（Execution 断言）：已修复。固定行改为 `Execution: main conversation.` 和 `Execution: delegated subtask; the result returns to an orchestrating agent.`；rubric 的 depth instructions 写明这一行只表示调用路径（`does not prove whether anyone reviews`），`higher` 删去"无人在环的静默歧义"一句；新增场景「自主主任务不被断言为逐条复核」。见 delta「Jev 判断请求与脱敏」、design D4/D5。
- Moderate 2（降级说明）：已修复。proposal 中的 BREAKING 一条与 design Risks 分开写明：降级到 0.6.6 时字段被忽略、带 preset 的绑定被跳过、账本不被改写、重新升级后恢复；同时单独写明支持 preset 的版本遇到未注册 id 时的回落语义。
- Moderate 3（6000ms 矛盾）：已修复。非法值改为 999、8001、1500.5，并补充 1000、6000、8000 均可保存的断言，场景名不变。
- Moderate 4（采样时机）：已修复。新增要求「判档预设的采样与归属」，含主会话判断中途切换、子任务创建后切换、预览与 fresh 子任务分别采样、非用户回合、测试连接 5 个场景；design D5/D6 写明每个调用点只解析一次，以及按决策 id 记录预设的 `decidedPreset`。
- Moderate 5（eval 可追溯）：已修复。新增要求「判档预设评估脚本」：未知预设在发出网络请求前退出；报告记录 `preset`、`expected`、`execution`；上限不变；明确不包含重放检验；测试通过替换 fetch 完成。
- 📌 6（锁定可被同时改写绕过）：采纳。测试只描述为"检测漂移"；`docs/presets/README.md` 写明既有锁定项只读、只能追加新 id，并有场景断言这条规则存在。
- 📌 7（criterion 非空）：采纳。已写入注册表约束与对应场景。

ponytail 评审（fresh-context 子会话）6 条，全部采纳：
1. 快照预设归属：改为按决策 id 记录 `decidedPreset`（design D6）。
2. 预设传递路径：每个调用点只解析一次，显式传入 `judgePolicy`，测试连接也纳入；删除 `QUESTIONS`（D3/D5）。
3. 设置页静态文案：列出四个 locale key 的中性化改法（D7）。
4. 去掉 `preset.json`、加载期校验、lock fixture、篡改与文档 URL 场景：元数据改放在 `index.ts` 的带类型常量里，约束由测试保证，锁定表复用 oracle 哈希（D1/D2）。
5. 去掉 `eval/state.mjs`：改为 import `lib/context.js` 的 `buildState`，`depthFor` 只用在单条用例上（D8）。
6. 降级说明：并入 Moderate 2 一并修正。
