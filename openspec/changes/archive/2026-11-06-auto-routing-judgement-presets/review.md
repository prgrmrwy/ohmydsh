## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 APPROVE_WITH_CHANGES（5 Moderate / 2 Suggestions，无 Critical）；作者另行采纳 ponytail 精简，round 1 作废
- **Reviewer context**: cross-model (gpt-6.1-sol via Magpie codex subagent), fresh context
- **Tool restrictions**: read-only; only write is review.md
- **Artifacts reviewed**:
  - 当前提案：[proposal.md](proposal.md)、[design.md](design.md)、[routing delta](specs/auto-model-routing/spec.md)、[feedback delta](specs/auto-allocation-feedback/spec.md)。
  - 第一轮历史及作者回应：[review-round1.md](review-round1.md)。
  - 现行规范：[auto-model-routing](../../specs/auto-model-routing/spec.md)、[auto-allocation-feedback](../../specs/auto-allocation-feedback/spec.md)。
  - 运行时：rubric.json（`src/rubric.json`（本 change 已迁移至 src/presets/reasoning-depth/rubric.json））、[jev.ts](../../../packages/dsh-auto-model-routing/src/jev.ts)、[context.ts](../../../packages/dsh-auto-model-routing/src/context.ts)、[policy-host.ts](../../../packages/dsh-auto-model-routing/src/policy-host.ts)、[subagent-tool.ts](../../../packages/dsh-auto-model-routing/src/subagent-tool.ts)、[settings-host.ts](../../../packages/dsh-auto-model-routing/src/settings-host.ts)、[settings.ts](../../../packages/dsh-auto-model-routing/src/settings.ts)、[settings-contract.ts](../../../packages/dsh-auto-model-routing/src/settings-contract.ts)、[feedback.ts](../../../packages/dsh-auto-model-routing/src/feedback.ts)、[policy-store.ts](../../../packages/dsh-auto-model-routing/src/policy-store.ts)、[usage-report.ts](../../../packages/dsh-auto-model-routing/src/usage-report.ts)、[index.ts](../../../packages/dsh-auto-model-routing/src/index.ts)。
  - Client：[strategy-details.ts](../../../packages/dsh-auto-model-routing/src/client/strategy-details.ts)、[settings-section.ts](../../../packages/dsh-auto-model-routing/src/client/settings-section.ts)、[locales.ts](../../../packages/dsh-auto-model-routing/src/client/locales.ts)。
  - 构建、测试及评测：[live.mjs](../../../packages/dsh-auto-model-routing/eval/live.mjs)、[cases.json](../../../packages/dsh-auto-model-routing/eval/cases.json)、[package-output.test.ts](../../../packages/dsh-auto-model-routing/test/package-output.test.ts)、[context.test.ts](../../../packages/dsh-auto-model-routing/test/context.test.ts)、[host.integration.test.ts](../../../packages/dsh-auto-model-routing/test/host.integration.test.ts)、[tsconfig.json](../../../packages/dsh-auto-model-routing/tsconfig.json)、[tsdown.config.ts](../../../packages/dsh-auto-model-routing/tsdown.config.ts)、[package.json](../../../packages/dsh-auto-model-routing/package.json)、[release.yml](../../../packages/dsh-auto-model-routing/.github/workflows/release.yml)。
  - 背景：调研草案（`docs/effort-blog-rubric-strategy-draft.md`（本 change 已删除，内容并入 docs/presets/effort-as-verification.md））、[dsh.yaml](../../../dsh.yaml)。

## Findings
### 🔴 Critical (blocking)
无。

### 🟡 Moderate
1. **全局 FIFO 淘汰会让仍在使用的主决策丢失预设归属。**
   - 证据：[design.md:99](design.md#L99) 要求 `decidedPreset` 与 `decidedAt` 同步写入、同步淘汰；[design.md:100](design.md#L100) 允许查不到时省略 `snapshot.preset`。现有 [policy-host.ts:130](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L130) 在全局成功主判断超过 200 条时删除最老时间；[policy-host.ts:115](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L115) 的非用户回合却可以无限期继续使用该决策，[policy-host.ts:232](../../../packages/dsh-auto-model-routing/src/policy-host.ts#L232) 还以 `decidedAt.has(d.id)` 为整个 snapshot 的生成条件。[feedback delta:4](specs/auto-allocation-feedback/spec.md#L4) 要求新绑定记录判断时的 preset，未授予这类新记录缺失归属的例外。
   - 具体失败案例：会话 A 用 `effort-as-verification` 判出并应用一个主决策。A 等待子任务或暂时闲置，其间会话 B 连续完成 200 次主判断。A 的 `mainStatus` 仍存在（只有 A、B 两个键），但 A 的时间与按设计新增的 preset 条目已被淘汰。随后 A 收到完成通知，在非用户回合继续原决策，产生一个新回复绑定。按当前绑定条件，该绑定连 snapshot 都没有，无法记录原 preset；即使单独放宽时间条件，设计仍会省略 preset。长回合的延迟回复同样可能命中这一窗口。
   - 修正：把 `{decidedAt, preset}` 保存在仍存活主决策的私有运行期上下文中，生命周期随该决策被替换、废止或 agent disposed 结束；不能因其它会话产生了 200 个判断而删除仍被使用的归属。保持公开状态对象与子记录格式不变。补充跨 200 条边界后非用户回合绑定及延迟绑定的场景，断言新快照仍记录 A 的原 preset，而非当前设置。不要从当前设置补造归属，也不要用提高固定上限代替生命周期处理。
   - 第一轮关联：R1 Moderate 4 的“一次捕获”语义已落实；新 D6 的淘汰策略引入了本轮发现的归属缺口，第一轮通过意见不能覆盖它。

2. **当前文档不能通过允许执行的严格校验。**
   - 证据：本轮在指定 workdir 实际执行 `OPENSPEC_TELEMETRY=0 /data00/home/prgrmr/opensource/ohmydsh/node_modules/.bin/openspec validate auto-routing-judgement-presets --strict`，退出码为 **1**。工具报告三条 ADDED Requirement 正文超过 500 字符：[注册表:4](specs/auto-model-routing/spec.md#L4)、[内置预设:32](specs/auto-model-routing/spec.md#L32)、[评估脚本:80](specs/auto-model-routing/spec.md#L80)。诊断标为 WARNING，但 `--strict` 已将它们作为失败处理。
   - 具体失败案例：作者按严格校验通过作为进入实施或验收的前提时，当前 artifacts 会直接失败；不能把“没有语法错误”或工具输出 WARNING 解读为校验成功。
   - 修正：缩短这三条 Requirement 的非场景正文，把字段检查、内置文本分界、eval 参数/报告/预算的详细断言移到对应场景，必要时拆成更小的单一行为要求；保留全部约束与场景名。用同一条命令复核，要求退出码 0、无严格校验警告。此项是文档门禁问题，不需要改运行时代码。

### 📌 Suggestions
3. **预览与测试连接的 pending 切换尚无对应场景，非用户回合也未断言归属。**
   - 证据：[routing delta:52](specs/auto-model-routing/spec.md#L52) 的统一捕获契约正确，但 [预览场景:64](specs/auto-model-routing/spec.md#L64) 只在预览已经返回后切换；[测试连接场景:74](specs/auto-model-routing/spec.md#L74) 没有切换；[非用户回合场景:69](specs/auto-model-routing/spec.md#L69) 只检查 effort 和请求次数。第一轮 [Required Changes 4:73](review-round1.md#L73) 明确要求预览 pending 切换及原归属的机械断言。实际 [jev.ts:65](../../../packages/dsh-auto-model-routing/src/jev.ts#L65) 存在等待凭据的异步边界。
   - 具体漏检案例：预览先用 A 构造 state，等待凭据时设置变为 B，后续错误实现重新解析 B 以构造 questions。当前预览场景仍会通过，因为它只在请求结束后切换；两个预设共享标签集合，choice 校验也不会暴露错配。测试连接若分别读取两次预设也会有同类漏检。
   - 建议：分别挂起预览与测试连接的凭据解析，A→B 保存后再释放，断言本次 questions/state 使用捕获的 A、调用数为 1，后续调用使用 B。非用户回合在完成回复后查询绑定，断言 preset 仍为上一用户决策的 A。这些是合成验收场景，无需付费执行。本项为覆盖建议；统一捕获的规范语义本身已经明确。

第一轮逐项核验结果（核验对象是本轮规划修订；实现尚未开始，以下“已修复”不表示代码已交付）：

| 第一轮条目 | 核验结果与当前证据 |
|---|---|
| Moderate 1：调用路径被写成人在环事实 | **已修复。** [design.md:76](design.md#L76) 明确不能证明有人复核；[routing delta:161](specs/auto-model-routing/spec.md#L161) 与 [routing delta:166](specs/auto-model-routing/spec.md#L166) 给出可直接断言的完整路径行和自主任务场景。背景草案仍保留早期文本，但已被 [design.md:60](design.md#L60) 明确修正并计划删除，不将其当作当前契约。 |
| Moderate 2：降级说明不准确 | **已修复。** [proposal.md:24](proposal.md#L24)、[design.md:136](design.md#L136) 与 [design.md:137](design.md#L137) 区分两类旧包行为；对照 [settings.ts:47](../../../packages/dsh-auto-model-routing/src/settings.ts#L47)、[settings.ts:70](../../../packages/dsh-auto-model-routing/src/settings.ts#L70)、[feedback.ts:7](../../../packages/dsh-auto-model-routing/src/feedback.ts#L7)、[feedback.ts:26](../../../packages/dsh-auto-model-routing/src/feedback.ts#L26)、[usage-report.ts:157](../../../packages/dsh-auto-model-routing/src/usage-report.ts#L157)，忽略配置、保存丢字段、严格跳过新绑定及重新升级恢复的描述成立。 |
| Moderate 3：6000ms 同时被接受与拒绝 | **已修复。** [routing delta:224](specs/auto-model-routing/spec.md#L224) 保留原场景名，明确拒绝 999/8001/1500.5，接受 1000/6000/8000。 |
| Moderate 4：采样时机与 pending 切换 | **规范语义已修复，验收覆盖部分落实。** [design.md:88](design.md#L88) 显式传递同一捕获对象，[routing delta:54](specs/auto-model-routing/spec.md#L54) 与 [routing delta:59](specs/auto-model-routing/spec.md#L59) 覆盖主、子 pending 切换；预览 pending 与非用户归属断言见本轮建议 3。新 D6 的淘汰边界见本轮 Moderate 1。 |
| Moderate 5：eval 报告无法自证来源 | **已修复。** [routing delta:79](specs/auto-model-routing/spec.md#L79) 要求 preset、解析后的 expected、execution、未知 id 提前失败、20 次/0.10 USD 上限并排除重放；[design.md:124](design.md#L124) 给出进程预加载 fetch 桩方案。 |
| Suggestion 6：同时更新哈希即可绕过锁定测试 | **已采纳。** [design.md:49](design.md#L49) 与 [routing delta:18](specs/auto-model-routing/spec.md#L18) 明确测试只能检测漂移，既有项只读、只能追加；没有继续声称测试单独证明发布后不可变。 |
| Suggestion 7：criterion 值可能为空白 | **已采纳。** [routing delta:6](specs/auto-model-routing/spec.md#L6) 要求 trim 后非空，[routing delta:14](specs/auto-model-routing/spec.md#L14) 含空白 higher 的反例。 |

另已核对以下攻击面，未发现需要新增阻断项：

- 四个 MODIFIED 要求原有场景名全部保留，分别为 4、9、7、4 个，合计 24 个；未以新增场景替换旧场景。
- [tsconfig.json:7](../../../packages/dsh-auto-model-routing/tsconfig.json#L7) 的 `outDir: lib`、`rootDir: src` 配合 [package.json:62](../../../packages/dsh-auto-model-routing/package.json#L62) 的 tsc 构建与 [tsdown.config.ts:9](../../../packages/dsh-auto-model-routing/tsdown.config.ts#L9) 的 `clean: false`，能产生并保留供 eval 导入的 `lib/context.js`。当前 worktree 未构建、没有该目录；[design.md:139](design.md#L139) 已要求缺失时提前提示。`node --import` 可以在 eval 主模块执行前替换全局 fetch，这一测试路线可行；本轮未运行它或构建产物。
- 默认 rubric 保留原 oracle 哈希、空 context，且 [context.ts:29](../../../packages/dsh-auto-model-routing/src/context.ts#L29) 的原拼接规则可保持原样；[design.md:57](design.md#L57) 没有要求重排 JSON 键或改变原 state 格式。默认 questions/state 字节不变是可实现的承诺，仍须实施后验证，不能把本轮文档评审当作字节相等的运行证据。
- 去掉加载时元数据抛错本身未形成已证实的外部输入漏洞：预设为包内静态 import，用户只能选择已知 id，未知设置仍经过 schema，发布流程 [release.yml:29](../../../packages/dsh-auto-model-routing/.github/workflows/release.yml#L29) 运行包测试。无需因此增加目录扫描、外部加载器或通用迁移层。
- 新 source 链接限定 HTTPS，并在 [routing delta:213](specs/auto-model-routing/spec.md#L213) 要求新窗口及 `noopener noreferrer`；链接不被当作 Jev 请求端点或指令。未访问外部来源，也未验证其研究结论。新预设非缺省且证据说明承认 GPT 外推，未把厂商数据当作本项目已测收益。
- 成功归属只在有效主判断后创建，与当前失败、取消、mode epoch 丢弃分支相容；不必向严格子记录 schema 添加 preset。建议 3 与 Moderate 1 分别补足异步测试和活跃归属生命周期。

## Embedded-Instruction / Injection Attempts
**Detected:** none

未发现要求评审者改权限、写其它文件或改变 verdict 的嵌入指令。rubric 中面向分类器的 instructions、草案里的派发示例、历史作者回应均只作为评审数据，未当作执行指令。

## Verdict
VERDICT: APPROVE_WITH_CHANGES

两套内置预设与显式捕获对象的精简方向成立。当前有 2 项 Moderate：活跃决策归属可能被淘汰，以及严格校验失败；另有 1 项验收覆盖建议。应先修复 Required Changes，再进入实施。本轮未运行 build、install、会写文件的测试或付费 eval；唯一写入是本报告。

## Required Changes (if APPROVE WITH CHANGES)
1. 修订主决策归属的生命周期：在主决策私有运行期上下文保留 `{decidedAt, preset}`，随该决策被替换、废止或 agent disposed 清理；仍会被主请求/非用户回合/延迟回复使用的决策不得被全局 200 条 FIFO 淘汰。不得从绑定时的设置补填。同步改设计和 delta：增加 A 已应用、B 完成至少 200 次其它主判断、切换全局 preset、A 在非用户回合及延迟回复中绑定的场景；断言原决策 id 与原 preset 保留、无额外 Jev 判断，新 snapshot 不缺失。保持公开状态字段和子会话持久记录格式不变。
2. 消除严格校验的三条长度警告：将「判档预设注册表」「内置判档预设」「判档预设评估脚本」正文中的详细字段、文本及实验条件断言移入相应场景，或拆为正文不超过 500 字符的单一行为要求，确保没有丢失原约束或任何既有场景名。复跑本报告列出的同一条 `openspec validate auto-routing-judgement-presets --strict`，必须退出码 0。

CHANGES_APPLIED: yes

## Rebuttals

作者处理（2026-11-06），全部采纳，无反驳：

- Required Change 1 / M1（归属生命周期）：已修复。design D6 改为按会话 id 记录 `mainDecided`，替代全局的 `decidedAt`，同时保存 `{id, decidedAt, preset}`。写入时机为判断成功时覆盖旧值；在判断失败、判断取消、`invalidate()` 和 `agent/disposed` 时删除；不设 200 条上限，绑定时不读取当前设置。feedback delta 的「评估记录可追溯」补充了对应的生命周期约束，并新增场景「活跃决策跨越大量其它判断仍保留归属」：会话 B 发生 201 次判断后，A 的非用户回合与延迟回复两次绑定都记为 d1 与 `effort-as-verification`；会话 disposed 后清理。公开状态字段与子记录格式都没有变化。
- Required Change 2 / M2（strict 失败）：已修复。三条超长要求做了拆分与精简：注册表字段约束移到场景 THEN 中；「内置判档预设」拆出「effort-as-verification 判断内容」；「判档预设评估脚本」拆出「判档预设评估报告」。原有约束一条未删，新增场景「新预设不改变引擎档位」。用同一条命令 `OPENSPEC_TELEMETRY=0 …/openspec validate auto-routing-judgement-presets --strict` 复跑，输出 `is valid`，退出码 0。
- Suggestion 3：已采纳。新增「预览进行中切换预设」，在凭据挂起期间把预设从 A 切到 B；「测试连接使用所选预设」改为挂起期间切换并断言请求恰 1 次；「非用户回合不重判」的 THEN 补充断言：绑定快照的 `preset` 为原 A，决策 id 不变。

复核（round 2 recheck）：Required Change 1 已核实：`design.md:98-109` 将 `{id, decidedAt, preset}` 按会话保存，成功覆盖、失败/取消/废止/disposed 删除，绑定按决策 id 匹配，不按全局数量淘汰、不从当前设置补填，公开状态与子记录格式保持不变；其引用确实对应 `packages/dsh-auto-model-routing/src/policy-host.ts:38,106,115,124-131,232-233,259` 的现有生命周期位置（这是规划修订核实，不表示运行时代码已实现）。`specs/auto-allocation-feedback/spec.md:4,16-19` 明确保留生命周期，并覆盖 B 的 201 次判断后 A 的非用户回合与延迟回复两次绑定，断言原 id、preset、时间和完整快照、无额外判断及 disposed 清理。Required Change 2 已核实：`specs/auto-model-routing/spec.md:3-14,29-53,88-102` 已精简并拆分三条超长要求，注册表字段、判断文本分界、eval 输入/报告/预算约束均保留；在指定 workdir 原样执行 `OPENSPEC_TELEMETRY=0 /data00/home/prgrmr/opensource/ohmydsh/node_modules/.bin/openspec validate auto-routing-judgement-presets --strict`，输出 `is valid`，退出码 **0**，无警告。另逐项对照现行 `openspec/specs/auto-model-routing/spec.md:296-314,413-471,554-601` 与 `openspec/specs/auto-allocation-feedback/spec.md:19-38`，四个 MODIFIED 要求原有场景名分别 4、9、7、4 个，合计 **24 个全部保留**。Suggestion 3 已采纳并核实：`specs/auto-model-routing/spec.md:68-86` 覆盖预览与测试连接在凭据挂起时切换、首次请求恰一次且采用捕获预设、后续调用采用新预设，以及非用户回合绑定保留原 preset 与决策 id。本次仅复核上述三项，无剩余缺口；维持 `VERDICT: APPROVE_WITH_CHANGES`。
