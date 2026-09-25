## Context

见 `proposal.md` 的 Why。当前仓库默认 OpenSpec schema 是 `spec-driven`，普通 change 与 Worktree Session 已有稳定流程；用户已明确不再使用 Superpowers，也不希望维护个人 fork schema。本设计还受以下事实约束：

- Jev 是 typed judgment 服务，不生成实施方案；社区 `@jkudish/jev-mcp@0.6.0` 已提供 `jev_classify`/`jev_decide`、escape hatch、概率/置信度、严格响应校验和多 provider，但其 README 明确仍属 early software。
- Anvil 是项目级 OpenSpec schema，可按 change 选择；其门禁大多是 prompt-level，OpenSpec `requires` 只保证文件存在。
- spec-superflow `2.0.1` 是独立 CLI/skill workflow，而不是 OpenSpec schema。它的 v2 新任务使用 direct/planned 两条路径，默认当前会话与最终 review；它自己的 worktree/finish 必须保持 opt-in，不能接管本仓 DSH Worktree Session 的受控生命周期。
- 本 profile 目前没有通用 MCP client。仅安装 `@jkudish/jev-mcp` 包不等于工具真实可调用；实现必须找到并验证 DSH 0.1.5 的真实 MCP 装配接缝，或者以最窄的本地适配层暴露所需 Jev 判断，不能以配置存在冒充生效。
- 用户已有 TypeSafe API Key，但密钥不能进入 change、代码、命令行回显或对话；live 验证必须在本机安全环境配置后进行。

## Goals / Non-Goals

**Goals:**

- 以标准 `spec-driven` bootstrap change 建立第一期，避免“先让尚未接入的 Jev 决定如何接入自己”的循环依赖。
- 原样复用 Anvil 与 spec-superflow，分别保持其原生身份和升级路径；标准 OpenSpec 继续是默认与故障回退。
- 在现有 vibe 对话的 change 提醒决策点加入 observation-only shadow 推荐，获得中文真实样本而不改变行为。
- 让每个结果可审计、可比较、可关闭，且任何不确定或集成失败都不阻塞现有工作。
- 为第二期 advisory 和第三期有限自动化留下明确而非自动触发的升级边界。

**Non-Goals:**

- 不创建 `verified-plan`、`assured-change` 或其它个人混合 schema。
- 不修改 Anvil、spec-superflow 或 Jev MCP 上游源码；必要的 DSH 装配只做外围 adapter/manifest wiring。
- 本期不让 Jev 创建 change、切 schema、启动 spec-superflow、决定权限、运行工具、合入或归档。
- 不用 Jev 生成技术方案、风险理由或自然语言解释。
- 不在本期承诺自动识别所有普通聊天意图；只处理现有 Agent 已到达的“需要选择流程”决策点。

## Decisions

### D1. Bootstrap 使用标准 OpenSpec，Jev 只从后续请求开始 shadow

本 change 固定使用仓库已有 `spec-driven`。这是一个确定性 bootstrap 规则：路由器不能在尚未安装、未验证、无本地评测时决定自身控制平面。

替代方案是当前就让用户在 Anvil/spec-superflow 中任选其一；这既不能验证 Jev，也会把接入风险与工作流风险绑在一起，因此拒绝。

### D2. 候选按真实产品身份保留，不融合成新 schema

路由候选固定为：

1. `direct`：继续普通对话/小改动，不创建 change；
2. `standard-openspec`：当前官方 `spec-driven`；
3. `anvil`：项目内原样 schema，change 创建时显式 `--schema anvil`；
4. `spec-superflow`：使用上游 `ssf` 的 direct/planned 工作流，不伪装为 OpenSpec schema。

Anvil 与 spec-superflow 可以共享 DSH 的会话环境，但一个工作项只能有一个主要控制平面。已有 change 不重路由；社区流程也不得绕过 Worktree Session 的工具安全和合入审批。

替代方案是把二者内容拼成个人 schema，用户已明确拒绝，且会产生持续维护与语义漂移成本。

### D3. 使用两步判断，但首期只保存 recommendation

一次 shadow observation 包含两个有序判断：

1. **change necessity**：`direct` 与“需要正式流程”之间分类；
2. **workflow choice**：若需要正式流程，再在 `standard-openspec`、`anvil`、`spec-superflow` 间决定。

优先复用 Jev MCP 的 `jev_classify` 和 `jev_decide`，而不自行实现 System One 响应协议。候选描述而非候选名字承担判据：标准流程强调通用 change；Anvil 强调安全/迁移/持久化/并发与独立 test ledger；spec-superflow 强调范围需一次确认、实施/恢复/最终 review，但不需要 Anvil 全套门禁。

shadow 阶段不把 recommendation 当作决定，只记录与最终实际 route 的差异。Jev 不提供长理由；可审计原因来自输入的有限特征与 requirement checks，不能由 Agent事后编造。

### D4. 确定性规则包围 Jev

调用前：

- 用户显式选择直接成为实际 route；shadow 可以记录但不得覆盖；
- 已有 change 读取既定控制平面，不重新推荐；
- 非实施型请求不强迫进入 change；
- 候选未安装/未健康时从可推荐集合移除；
- 本仓安全规则永远是下限。

调用后：

- escape、无效响应、未知 choice、缺失概率/置信度、低于阈值或 winner margin 不足统一记为 `needs-review`；
- provider/MCP 故障统一规范化，不阻塞现有 Agent；
- shadow 模式没有任何自动 side effect。

阈值由版本化配置集中管理；初值沿用 Jev MCP 的保守默认，只用于标注 `auto-candidate`/`needs-review`，不能在本期触发自动化。

### D5. Jev MCP 先走官方/社区分发物，DSH 接缝必须实测

资源 pin：

- `@jkudish/jev-mcp@0.6.0`（npm integrity 同 manifest 审查记录）；
- `spec-superflow@2.0.1`（npm integrity 与 SLSA provenance 记录）；
- Anvil 使用 `jikkujoyce/openspec-schemas` 的精确 commit，而不是浮动 `main`。

实施前先审计 DSH 0.1.5 实际 MCP client/skill 装配：谁启动 stdio、如何注入经过 allowlist 的环境、如何把工具装到普通 Agent、dispose/取消如何传播。若宿主不存在可靠接缝，本期可以用本仓 local package 启动 pinned Jev MCP 并只投影所需工具，但不得复制或修改其业务逻辑。配置或 package 存在不算成功，真实 Agent 必须能调用并收到 typed 结果。

### D6. TypeSafe key 只留在本机凭据边界

仓库只记录变量名 `TYPESAFE_API_KEY` 和配置方法，不记录值。优先让 DSH 凭据/受控环境向 Jev 子进程注入单个 allowlisted 变量；禁止继承完整环境、项目 `.env` 或把 key 写进生成 patch。错误体必须由 adapter/MCP 规范化，日志只保存错误类别。

若当前宿主无法证明最小环境注入，本期 live 入口保持禁用，先完成 mock 与无凭据降级，不能临时把 key 写进配置凑通。

### D7. Shadow 记录是本地有限评估数据，不进入对话历史

建议每条记录为 JSONL 或等价追加记录，字段版本固定：

- schemaVersion / routerVersion；
- 时间、匿名 observation id；
- 裁剪后的请求特征（intent、行为变化、模块/外部系统/安全/迁移等），不存全文；
- 实际可用候选及版本；
- recommendation、probabilities、confidence/margin、escape/status；
- 最终实际 route 与来源（用户显式、Agent、existing-change），可在事后补录；
- 规范化成本/延迟/错误类别。

记录位于 `$DSH_HOME` 受管状态目录，默认不上 Git、不注入模型上下文，并提供关闭、导出脱敏汇总与清理。首期不记录源码 diff、附件或完整聊天。

### D8. 三期推进，各期必须由新 change 与用户批准开启

- **Phase 1 / 本 change：shadow。** 安装与验证三条候选路径；现有行为不变；积累建议/实际 route 样本。
- **Phase 2：advisory。** 仅在达到预先登记的样本和质量门槛后，以非阻塞方式展示推荐和明确覆盖选项。
- **Phase 3：有限自动化。** 只考虑高置信度、低风险且可逆的选择；跳过 change、选择 assured 流程、已有 change 转换以及任何副作用仍需人工/确定性授权。

本 change 只定义 Phase 2/3 的准入证据，不实现其 UI 或自动动作。

## Risks / Trade-offs

- **[社区资源版本年轻且语义漂移]** → 精确 pin、记录 provenance、安装前审计、升级走独立 change；默认 OpenSpec 始终可用。
- **[MCP 配上但 Agent 实际看不到工具]** → 按 integration pitfalls 检查真实 request header/tool surface 和一次真实调用，不以文件/日志“已加载”作为验收。
- **[Jev 中文分类不稳定]** → shadow 收集本地中文样本，比较实际 route；不足时不升级。
- **[Shadow 记录形成隐私副本]** → 只存结构化特征与不可逆 id，默认本地、有限保留、可清理，不保存全文和附件。
- **[三套工作流入口造成认知负担]** → 路由 skill 展示稳定的四候选语义与版本；现有 change 不切换；标准 OpenSpec 永远回退。
- **[spec-superflow 与 Worktree Session 双重隔离]** → 上游 worktree/finish 保持 opt-in；在绑定 Worktree Session 内禁止它创建第二套 worktree 或直接完成合入。
- **[Anvil gate 仅为提示]** → 首期按上游原样保留并明确能力边界；若未来需要机械 enforcement，作为独立 change，而非修改 Anvil schema。
- **[外部服务不可用拖慢对话]** → 有界超时、取消传播、异步/非阻塞 shadow；故障直接回到现有行为。

## Migration Plan

1. 审计并固定三份社区资源的 commit/version、license、hash/integrity、运行依赖与 DSH 适配边界。
2. 以仓库真相源登记资源；Anvil 原样落在 OpenSpec 官方 user schema 目录（默认 `~/.local/share/openspec/schemas/anvil`），由 ohmydsh sync 自动管理并供 checkout/worktree 共享，spec-superflow 与 Jev MCP 按各自原生分发形态物化，默认 schema 不变。OpenSpec 1.9.0 不向项目父目录递归查找 schema，因此不在每个 worktree 重复保存可重建副本。
3. 建立最窄 Jev 接缝与凭据注入，先用 mock/无凭据测试，再由用户在本机环境配置已有 TypeSafe key 后运行 live probe。
4. 新增 shadow routing skill 与本地记录；验证关闭时行为完全等同接入前。
5. 运行至少一轮 synthetic fixture 和真实 vibe shadow dogfood，生成不含原文/密钥的评估摘要。
6. 如需回滚，禁用 Jev routing 与社区资源并 sync；删除受管 shadow 状态。标准 OpenSpec 与已有 change 不变。

## Open Questions

- 无。Phase 2 的具体样本门槛与 UI 形态由 Phase 1 真实数据决定，属于后续 change，不改变本期任务拆分。
