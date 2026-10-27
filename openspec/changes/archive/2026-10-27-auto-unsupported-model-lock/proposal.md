## Why

用户确认 AUTO 的定位是「倾向 Claude / GPT 系列」：不支持其它模型可以接受，但当前行为不可接受——主模型是不被支持的模型（例如 `opencode-go/deepseek-v4.1-flash`，官方目录 `defaultEffort=max`）时，AUTO 仍尝试映射 effort，`policyEffort` 抛 `模型推荐 effort 起点不可验证，请先配置受支持模型`，从 `agent/request` 钩子冒出去导致**整轮失败**（2026-10-27 本工作区会话 turn 1 的 `turn/end`：该 message、code `UNKNOWN`；请求头 `opencode-go` / `deepseek-v4.1-flash` / `max`）。

期望行为改为「不支持就不玩」：切到不支持的模型后自动落为 MANUAL 并锁定（不可切回 AUTO），芯片加描边 info 图标，悬停整个按钮说明目前仅支持 Claude/GPT 系列、其他模型策略欢迎提交 issue 或 PR（给出仓库地址）——而不是让请求失败。

另有一个同类隐患：即便模型属于 Claude/GPT 系列，只要官方目录给不出可用的自动 effort（只支持 `max`、上限排除全部候选、未来新模型的 `defaultEffort` 不在 `low..xhigh`），当前实现同样抛错阻断请求。主请求不应因为「无法映射」而失败，应降级为不改写。

## What Changes

- **定义 AUTO 主模型支持范围**：模型名去掉 transport 前缀（Magpie 的 `claude/`、`codex/`）后以 `claude-` 或 `gpt-` 开头（大小写不敏感）即视为支持；其余模型（DeepSeek、GLM、Grok、Gemini、Kimi、Qwen 等）不支持。
- **不支持时自动锁定 MANUAL**：状态接口、`agent/pre-step`、`agent/request` 三处一致判定；AUTO 会话切到不支持模型后持久化为 MANUAL，本回合不调用 Jev、不改写请求；状态接口返回 `autoSupport.supported=false` 与当前 provider/model。
- **主请求映射不可得不再阻断**：支持范围内但 `policyEffort` 无法给出自动 effort 时，主请求保持官方合成配置，`reason=no-effort-support`，不失败请求、不停用 AUTO。
- **芯片锁定态 UI**：不支持时芯片显示 MANUAL + 描边 info 图标，`aria-disabled` 且点击不发送 setMode；悬停/聚焦整个按钮打开面板，说明仅支持 Claude/GPT 系列并给出 `https://github.com/prgrmrwy/dsh-auto-model-routing` 的 issue/PR 链接。切回支持模型后芯片恢复可点击，模式保持 MANUAL（不自动恢复 AUTO）。
- **客户端即时刷新**：芯片在官方 `ctx.modelDirectories` 的会话选择 store 变化时立即重取状态（服务缺失或失败时仍以 3s 轮询兜底），避免切换模型后最长 3 秒显示旧状态。
- **子任务路由与 legacy 回滚不变**：`route_subagent`/正式创建仍 fail closed；`policy: legacy` 不套用新支持范围判定。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auto-model-routing`：新增「AUTO 主模型支持范围与不可用锁定」要求（范围、自动 MANUAL、不阻断请求、芯片锁定与提示、切回恢复）；修改「状态可见且不改写其它控件」，说明锁定态覆盖点击切换的默认描述。

## Impact

- 代码（Host）：`src/policy-v2.ts`（支持范围纯函数）、新增 selection/support 判定辅助、`src/policy-host.ts`（pre-step/request 门禁与映射失败降级）、`src/index.ts`（状态接口返回 `autoSupport`、setMode 拒绝、`agent/created` 默认 AUTO 保护）。
- 代码（Client）：`src/client/index.ts`（锁定态芯片、info 图标、面板说明与链接、`modelDirectories` 变化触发即时刷新）。
- 测试：`test/policy-v2.test.ts`、`test/policy-host.integration.test.ts`、`test/host.integration.test.ts`、`test/client.test.ts`。
- 文档：`packages/auto-model-routing/README.md`、`README.zh.md`。
- 不改 `dsh.yaml`、版本 pin、依赖或宿主包；Host 侧变化需 `dsh build` 并重启 DSH 才生效，部署与重启由用户决定。发布镜像仓库与版本号另行处理。
