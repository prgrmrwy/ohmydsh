## Why

日常 vibe 对话目前只能由 Agent 临场判断是否进入 OpenSpec change，既缺少可复核的流程分流依据，也无法系统比较标准 OpenSpec、Anvil 与 spec-superflow 对不同规模工作的适配效果。Jev 擅长在固定候选间给出带概率与置信度的结构化判断，适合作为一个可关闭、可回退的 shadow 决策层，先观察而不改变现有行为。

## What Changes

- 接入精确版本的社区 `@jkudish/jev-mcp`，仅通过本机环境读取现有 TypeSafe API Key；凭据不得进入仓库、日志、会话正文或路由证据。
- 原样引入并验证社区 Anvil schema，原样安装精确版本的 spec-superflow；不 fork、不改写、不派生个人 schema，并记录来源、版本、更新与退出路径。
- 新增一个 Jev workflow-routing skill，在普通 vibe 对话出现“是否应进入 change / 应使用何种规划流程”的决策点时，把候选限定为：继续直接对话、标准 OpenSpec、Anvil、spec-superflow。
- 首期仅运行 shadow mode：Jev 结果被记录为脱敏、有限、可清理的评估样本，但不创建 change、不切换 schema、不调用 spec-superflow、不改变现有 OpenSpec 提醒，也不授权任何写操作。
- 明确确定性优先级：用户显式选择、已有 change 的既定流程、缺失凭据、服务错误、无效响应、低置信度或逃逸结果均不得由 Jev 覆盖；失败时保持现有标准行为。
- 为后续 advisory mode 与有限自动路由定义分期准入条件，但不在本 change 中启用自动选择。

## Capabilities

### New Capabilities
- `jev-workflow-routing`: 定义 Jev 对日常开发请求进行 shadow 流程推荐时的候选、证据、优先级、降级、隐私与分期行为。

### Modified Capabilities
- `repo-layout`: 扩展定制 manifest 与 sync 所管理的第三方工作流/MCP 资源范围，要求精确来源、可复现物化、可逆禁用和无凭据入库。

## Impact

- `dsh.yaml` 与 sync/check 脚本：登记并物化 Jev MCP、Anvil 和 spec-superflow 的精确版本及来源。
- `skills/`：新增 workflow-routing skill，只负责识别决策点、调用 Jev、执行 shadow/fallback 规则并保存有限评估结果。
- `openspec/schemas/`：加入未经本地修改的 Anvil schema；默认 `schema: spec-driven` 保持不变。
- 本机 DSH/OpenSpec 集成面：需验证 Jev MCP 在真实会话可达、社区工作流入口可发现，且不会与现有 Worktree Session 或受控合入流程发生隐式接管。
- 外部服务：TypeSafe Jev；首期使用用户已持有并在本机安全配置的 API Key。
