# policy-v2 开发与验收记录

## 状态

2026-10-25 用户在最小真实 Magpie 验收后追加授权：AUTO 默认升级，不再要求版本开关。默认配置为内部 policy-v2；显式 legacy 仅供回滚。旧四档配置保留但不参与新策略，MANUAL 不变。已构建部署、通过分离控制进程重启现有3080服务，并在实际GUI验证无版本选择、显示 AUTO 已使用新策略。真实质量/返工/成本对照仍未完成，不宣称性能收益。

## 实现入口

- [Jev 契约](../src/jev.ts)：复用认证、deadline、body 上限、错误分类；原 tier 问题不变。新主请求只问 depth；子请求一次问 capability/depth，显式约束只问未指定维度。
- [独立映射](../src/policy-v2.ts)：版本化能力槽，effort 推荐起点按受支持序列最多移动一档，受 cap 限制，不自动使用 max。映射是初始基线，Codex analytical/frontier 都是 Sol，未虚构第三模型。
- [宿主接入](../src/policy-host.ts)：官方 `tools/execute` → AsyncLocalStorage → `agent/created` 绑定精确 child ID 和 parent/root；不依赖 prompt 相似度。`agent/pre-step` 获取首次任务并决策，`agent/request` 应用；`request/header` 记录匹配证据。
- [持久化](../src/policy-store.ts)：每 child 哈希路径、严格 schema、owner-only 原子替换，只有身份/版本/约束/路由/状态，不含任务原文。缺失、损坏、未完成恢复不默默继承；未完成决策不能用后续消息重新分类。
- [工具](../src/subagent-tool.ts)：policy-v2 下 optional preview，仅 recommended；普通创建工具负责精确应用，不把预览冒充 applied。
- [设置](../src/client/settings-section.ts)：无用户版本开关；省略即新策略，旧四档表仅在显式 legacy 回滚时显示。当前能力槽是版本化代码，不新增另一套可编辑映射表。
- [状态 API](../src/index.ts)：`auto-model-routing.childRouting` 接收 `{sessionId}`；主 state 返回 policy/depth/effort。v2 不使用 `selectModel`，避免全局默认副作用。

## 覆盖矩阵

| 路径/行为 | 证据 | 结果/边界 |
|---|---|---|
| 官方 ordinary fresh continuable 工具与 provider | [整链脚本](../scripts/policy-v2-host-probe.mjs)加载官方 0.2.0-rc.2、真实生产插件，fake Jev/adapter | 实际请求 model/effort 匹配；全宿主关闭重建后恢复，不重判 |
| 官方 fresh teammate 工具与服务 | 同上 | 创建、后续消息和全宿主恢复通过，不重选 |
| 并发创建与显式模型/effort | [宿主测试](../test/policy-host.integration.test.ts)官方 Tools/Agents，测试创建工具 | 并发精确身份隔离；两者指定零判断；普通/teammate 官方 provider 的并发压力未测 |
| fork / teammate fork | tools wrapper 可提前拒绝 | unsupported，真实历史兼容未验证，不擅自转 fresh |
| 未绑定 service API、别名工具、远端 ACP | 进入子 pre-step 时若发现启用 v2 而无绑定则停止 | 不宣称支持；根链不可达时不作自动决策。未宣称能阻止进程外原生创建 |
| MANUAL / 切回原策略 | unit + host tests | 不做新判断；已绑定实例保留创建初始路线，不因后续消息换模 |
| needs-context / Jev 402 / 配置失效 | host tests | 子请求停止，根仍 AUTO，不静默替代或自治重试 |
| 恢复损坏 / 身份不匹配 | store tests | fail closed；单进程按 child 写，无跨进程争用/崩溃注入证明 |
| 实际请求被其它 middleware 改写 | host mismatch test | 记录 failed，不标 applied；header observer 抛错为尽力阻断，不将配置匹配等同调用成功 |
| 当前允许列表与父快照 | 新鲜 catalog 校验 + 父 `subagent/model-selection-policy`（存在时） | 不用较新全局列表扩大父快照；整链脚本的 allowlist 是合成 service seam，未验证真实 GUI 设置装配 |

适配器/Jev 都为 fake 的宿主测试不证明真实 provider 兼容、真实工具 schema 部署或网络效果。实际 `applied` 只代表 request/header 配置匹配，不代表任务验收、模型成功或底层 provider 尊重 effort。

## 验证

- 真实 Jev：10 请求 / development 5 + holdout 5，均符合预期，US$0.000344148；见 [Jev 记录](jev-policy-v2-validation.md)。没有实际子模型调用。
- package `npm run typecheck`、`npm test`（29 文件 / 184 测试）、`npm run build` 通过；构建保留现有 tsdown deprecation/format warning，不顺手升级工具链。
- 官方整链脚本：ordinary + fresh teammate 创建/请求/全宿主冷恢复通过。
- 早期 [宿主能力探针](host-capability-report.md)证明 service/request 基础能力；新整链脚本补充生产插件与正式工具绑定，而非把之前的测试标签 oracle 当生产实现。

重跑整链：先 package build；在原临时官方 prefix 的基础上，精确安装 `@deepseek-ai/dsh-tool-subagent@0.2.0-rc.2`、`@deepseek-ai/dsh-experimental-tool-agent-team@0.2.0-rc.2`、`@deepseek-ai/dsh-launch-environment@0.2.0-rc.2`（`--save-exact --ignore-scripts`），然后：

```sh
node packages/auto-model-routing/scripts/policy-v2-host-probe.mjs "$PROBE_HOME"
```

官方 standing tool 的 `modelSelectionSettings:true` 要求 preset-scoped context；隔离脚本没有伪造该 composition，使用 standing fixed-schema 工具 + 合成 allowlist。因此显式选择与父快照另用 host tests 验证，真实 preset/GUI 组合不记为通过。

## 独立审查后的修复

用户授权只读独立审查后，修复子输入来源过滤、模式往返 epoch 撤销、await 后 MANUAL 复核，以及路由记录丢失时的 sidecar 绑定检测。原尝试自定义 session 事件被官方持久化拒绝，已完全移除；不依赖上游改动。完整官方 cold resume 探针重新通过。独立最终聚焦复核结论 PASS；其测试命令未能找到 vitest，测试通过证据来自主会话的完整运行，不将其静态审查冒充独立测试通过。

`.bound` 标记只保存 child ID，不包含任务；路由 JSON 缺失而标记保留时 fail closed。整个插件状态目录（两份记录）同时丢失、或旧版无标记记录丢失，无法检测，不能泛称所有存储丢失都已覆盖。

## Magpie 接入（2026-10-25）

用户指定实际模型先只经 Magpie，OpenRouter 仅 Jev，不用本地 Claude/codex。v2 支持精确 `dsh-magpie-connect` transport，持久记录保留完整 model ID；自动映射使用 `claude/...` / `codex/...` 家族，不把网关 route 伪装为本地 provider。映射版本为 `capability-slots-2-magpie`，已有完成路由保持原配置；其他网关模型可显式使用，未定义能力槽时不自动猜；未知模型 effort 使用 LLM 目录 defaultEffort，缺失则停止。固定已知家族沿用版本化官方起点。

当前 legacy catalog 仍不包含 Magpie；持久子路由重放使用独立全量策略目录，避免关闭试验导致既有实例失效。目录/allowlist 校验对精确 provider+model 执行，模型名含斜线只在 v2 网关路径允许，旧配置校验不放宽。

验证：190 测试、类型检查、构建通过；官方工具整链脚本加 `--magpie` 后通过 ordinary/fresh teammate 和全宿主冷恢复（fake adapter/Jev，无外网）。实际 dsh-magpie-connect 0.4.1 源码显示 resolveModel.reasoning 从缓存努力等级构建 defaultEffort；尚未验证在线生成或真实 effort 消费，不把缓存/模拟当实测。

## 回滚与后续

- 切回 legacy 或 MANUAL：停止新判断；已有 child 继续恢复初始路线，避免意外退回父模型。
- 完全移除/停用插件：请求覆盖停止，官方 cold resume 回到创建 descriptor 配置；操作前应确认已创建子任务可以接受该变化。
- 不修改 main current spec，不归档 change；其约束继续描述默认旧策略。试验有独立 delta spec。
- 未运行真实子模型保留集对照、返工总成本评估、浏览器部署验收、全仓测试、sync、发布。4.3 和默认推广不完成；真实质量与收益未知，不记为零。
