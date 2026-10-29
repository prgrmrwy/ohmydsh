## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 — APPROVE_WITH_CHANGES，因探针后的方案修订作废。
- **Reviewer context**: fresh independent Anvil reviewer；中文规划复核。
- **Review date**: 2026-10-28
- **Scope**: proposal、design、完整 delta spec、上一轮 review、implementation-progress，以及 probe-managed-identity 脚本的静态阅读。
- **Restrictions**: 唯一写入为替换本报告；未执行 shell、构建、测试或探针。

VERDICT: APPROVE_WITH_CHANGES

CHANGES_APPLIED: yes

**计数：0 Critical、3 Moderate、0 Suggestions。**

本轮接受用户固定决定：D1 在 agent/created(startup) 按 ALS + 同父 + 根 AUTO 绑定，不用 catalog；同窗口插件旁支可能一并受管是已接受限制，不是待修来源缺陷。本报告批准对象为规划，非实现或运行验收。三项均可按下述精确文字局部修订，无需重设计。

## Findings / Required Changes

### R4-M1 — 受管范围摘要与通用透传场景仍遗漏已接受例外

[proposal:13](<proposal.md#L13>) 仍把“经官方工具创建”作为严格来源保证，并无条件排除插件直建；[design:17](<design.md#L17>) 同样无条件排除插件直建。[delta:18–21](<specs/auto-model-routing/spec.md#L18-L21>) 的“不经官方创建工具直接创建”也覆盖了同 ALS 窗口服务直建，却断言零绑定、零 Jev，与新 D1/已知限制不一致。

**精确替换：**

1. proposal 第 13 行替换为：

> - **收敛受管范围。** AUTO 只路由在官方 fresh 创建工具（`subagent`、fresh `spawn_teammate`）的 ALS 上下文内，以 `source = "startup"` 创建、`parentSession` 等于工具执行会话、且创建时根为 AUTO、直接父 provider 可读并成功绑定的子会话。该规则不能证明工具独占来源：同一窗口内插件以同父直接创建的子会话也可能一并受管，这是用户 2026-10-28 接受的限制，不使用 catalog 消歧。其余子会话原样放行，不判断、不改写、不报错，`childRouting` 显示未路由；包括窗口外插件直建（如 Pet locus）、MANUAL 时创建的子会话和 fork。孙会话照常按同一规则判定，每一层以直接父会话为锚。

2. design 第 17 行替换为：

> - 非受管子会话（官方工具 ALS 上下文外的插件直建、MANUAL 时创建、fork）原样放行，零抛错；同窗口同父 startup 插件旁支可能一并受管，按 D1 如实记录该已接受限制。

3. delta 第 9 行括号内的 `插件直接创建的子会话如 Pet locus` 替换为：

> 官方工具 ALS 上下文外插件直接创建的子会话，如 Pet locus

4. delta 第 20 行替换为：

> - **WHEN** 在官方创建工具的 ALS 上下文之外，以 `meta: {origin: "subagent", parentSession: R}` 直接创建子会话 L 并让其发出第 1 轮请求

### R4-M2 — 已接受限制缺少可判定的 childRouting 输出与同窗口正向 oracle

[delta:7](<specs/auto-model-routing/spec.md#L7>) 要求文档和 `childRouting` 如实说明限制，但[端点契约:312](<specs/auto-model-routing/spec.md#L312>) 只规定返回记录或 unsupported，未定义说明字段；现有窗口外场景也不能守护“同窗口一并受管”的新行为。不是要求恢复 catalog gate，而是让新决定可断言。

**精确替换 / 插入：**

1. delta 第 312 行中的：

> `childRouting` 只读，返回该子会话的决策记录，无记录时返回 `{status: "unsupported"}`。

替换为：

> `childRouting` 只读，有记录时返回该子会话的决策记录，并在响应顶层附加 `scopeNote: "按官方工具 ALS 上下文、同父与 startup 绑定；不能区分同窗口插件旁支，旁支可能一并受管。"`（仅响应说明，不写回记录）；无记录时仍返回 `{status: "unsupported"}`。

2. 在 delta“工具窗口外创建的插件子会话不被接管”场景之后插入：

```markdown
#### Scenario: 同窗口同父插件旁支一并受管且如实说明
- **GIVEN** 根会话 R 为 AUTO、父 provider 可读；目录、允许列表和 effort 支持目标 route；Jev 固定返回 bounded/baseline
- **WHEN** 分别在官方 `subagent` 与 fresh `spawn_teammate` 的 ALS 上下文内，在实际工具目标创建之前，以 R 为父调用 `subagents.startContinuable` 创建 startup 插件旁支 L，再让 L 发出首个请求
- **THEN** 两种工具各自的 L 均有绑定标记与记录，并进入受管首次路由；`childRouting(L).scopeNote` 恰为“按官方工具 ALS 上下文、同父与 startup 绑定；不能区分同窗口插件旁支，旁支可能一并受管。”；不以有无 `subagent/catalog` 决定绑定
```

该场景是待实施的 oracle，不代表现有探针已证明首轮或 fresh teammate 成功。

### R4-M3 — 实施暂停点仍把已作废来源 gate 当作当前阻塞

[implementation-progress:16–20](<implementation-progress.md#L16-L20>) 仍宣称不能启用 ALS 绑定、需要用户在全部透传和寻找新接缝之间决策。它不是带日期的历史记录，而是当前“暂停点”，与新 D1 和已固定用户决定相反，容易让实施再次停在已解决问题上。

**精确替换：** 将第 16–20 行整段替换为：

```markdown
## 修订后的继续点（2026-10-28）

上述探针否定了 catalog 能证明官方工具独占来源的旧 gate；它没有证明首轮时序、请求透传或 fresh teammate 创建成功。用户随后明确接受同窗口同父 startup 插件旁支可能一并受管，D1 已改为在 agent/created 以 ALS + parentSession + startup 绑定，不再使用 catalog，也不再以旁支隔离成功作为启用门槛。

业务代码尚未实施，原任务完成声明不因此增加。后续按修订后的 proposal、design 与 delta 推进，并验证窗口外插件透传、同窗口旁支一并受管、父快照、首次请求及恢复行为；不得把本探针 exit 0 或该用户决定写成这些行为已通过验收。
```

## 其余核验结论与边界

- 新 design D1 与 delta 受管定义均已删除 catalog 授权条件；其余 catalog 提及用于解释被否定方案或模型目录，不构成要求恢复来源 gate 的理由。探针保留旧 gate 的反例断言合理，不要求改写历史实验。
- 上轮批准的同步父快照、首次写入 parentSelection、旧记录兼容、完整前缀过滤、允许列表无豁免、显式维度不替换、已有 route 实时门禁、模式 epoch、HTTP/RPC 子状态短路与可选预览规则仍保留。未发现本次修订破坏这些结论。
- 其余场景具有可构造输入及可观察断言；本轮新增问题集中在受管范围例外及其输出 oracle。未将“尚未实施”或“尚未动态通过”列为规划缺陷。
- 探针仅静态核对：两类窗口旁支的 catalog/同父/startup 条件确有断言；calls=0 与 TEAM_PROVISIONING_CONFLICT 的限制由进度文档明确记录。不能据此声称首轮运行或透传已经验证。

**未检查 / 风险边界**：未运行任何命令、测试、构建或探针，未验证实际 Host、GUI 或模型请求；只修改本报告。

## 定向复核（2026-10-28）

已逐项核对 R4-M1 的四处精确替换、R4-M2 的 childRouting scopeNote 句子与新增“同窗口同父插件旁支一并受管且如实说明”场景，以及 R4-M3 的继续点整段替换，均已按要求落实，无缺项。CHANGES_APPLIED 已改为 yes，VERDICT 保持不变；仅复核上述文档修改，未重开其他评审，未运行命令或测试。
