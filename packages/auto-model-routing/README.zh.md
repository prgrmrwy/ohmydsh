# dsh-auto-model-routing

[English](README.md)

<!-- problem -->
主会话在 AUTO 下每个用户回合请 Jev 决策模型（经 OpenRouter）判断任务档位，只调整推理强度，保留 provider/model。Jev 任何失败都会让 AUTO 自动停用，并在芯片上显示原因；没有本地降级。默认禁用，会话默认 MANUAL。

## 使用

在主 checkout 的 `.env.local` 写入 `OPENROUTER_API_KEY=sk-or-...`，`bin/dsh` 启动时加载。芯片位于 GPT 速度芯片左侧，外观与模型选择器一致：点击切换模式，悬停查看本回合 effort、原因与最近 20 条内存历史（不含任务正文，重启清空）。AUTO 选出的 effort 在请求发出后会显示在官方模型选择器上。

**外发数据**：AUTO 下每个用户回合会把你的消息（最多 8000 字符）发送给 OpenRouter 与 TypeSafe（模型 `typesafe/jev-1.13`）。每次调用 `route_subagent` 也会同样外发任务文本，与主会话模式无关。OpenRouter 对该模型的数据保留与日志条款未确认，请在 OpenRouter 后台自行设置。

**Jev 失败时**（未配置 key、余额不足、key 无效、限流、地区受限、超时、响应无效），会话切到 MANUAL，芯片显示 `MANUAL · Jev 停用` 与原因；点 AUTO 重试。取消回合不算失败。不轮询、不查余额。

`route_subagent` 工具对子会话使用同一个 Jev 判断，返回 provider/model/reasoning_effort。配套 skill 要求主 Agent 显式传入，工具失败时暂停委派并询问你。

**MANUAL 只是停止自动调整**，不复原：会话保持 AUTO 最后一次的 effort，直到你在模型选择器里另选；Jev 失败后同样如此。模式与最近一次 Jev 失败保存在 `$DSH_HOME/state/auto-model-routing/sessions/`。不自行换模型，不绕过网络门禁或官方模型白名单。不保证 provider 的缓存命中。

## 开发验证

在仓库根目录安装依赖，再运行：

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

测试使用真实 AgentLoop、假 LLM 流与本地回环假 Jev 服务，不访问 OpenRouter。离线测试不能替代现有 GUI 验收。

## 移除
<!-- section: removal -->

将插件 `enabled: false` 并构建即可。会话保持 AUTO 最后一次的 effort，需要时在官方模型选择器里另选。skill 有独立开关；插件未启用时，它会让主 Agent 按官方默认委派。
