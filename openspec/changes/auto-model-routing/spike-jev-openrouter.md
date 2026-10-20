# Spike：经 OpenRouter 调用 Jev（2026-10-20）

目的：TypeSafe 直连对当前出口地区返回 HTTP 451（`Typesafe is not available in your region.`），验证 OpenRouter 能否作为 Jev 的承载方，供路由判断使用。凭据只从本机 `.env.local` 读取，未写入仓库或日志。

## 接口事实

- Jev 是 decisions 模型：`POST https://openrouter.ai/api/v1/chat/completions` 返回 400 `is a decisions model and cannot be used with the chat/completions endpoint`。
- 正确入口 `POST https://openrouter.ai/api/alpha/decisions`，body `{model, state, questions}`；question 为 `{type: "choice", instructions, criteria: {label: description}}`。这与 `@jkudish/jev-mcp@0.14.1` `dist/provider.js` 的 openrouter 分支一致。
- 模型 id：`typesafe/jev-1.13`（端点 provider TypeSafe，输入 $0.042/M token，输出 0，近 30 分钟可用率 100%）。`typesafe/jev`、`typesafe/jev-latest` 为 404；浮动别名为 `~typesafe/jev-latest`；`typesafe/jev-router` 是另一种“替请求选模型”的产品，不是决策接口。
- 响应：`{model, answers: {id: {type, choice, probabilities, confidence}}, usage: {input_tokens, output_tokens, cost}, id, provider}`；实际快照 `typesafe/jev-1.13-20260917`。
- 上游 jev-mcp 对 408/409/429/5xx 自动重试最多 3 次、整体期限默认 60s。这与“失败即停用”不兼容，路由插件因此不经 MCP。

## 实测（10 条中文样本，每条独立请求）

| 输入 | 预期 | Jev | 置信度 | 耗时 |
|---|---|---|---|---|
| 把这个变量名从 foo 改成 userCount | simple | simple | 1.00 | 1.03s |
| 解释一下 git rebase 和 merge 的区别 | simple | simple | 1.00 | 0.78s |
| 这个报错是什么意思：Cannot find module 'react' | simple | simple | 0.92 | 0.82s |
| 给登录页加一个记住密码的复选框，并写单测 | standard | standard | 0.97 | 0.80s |
| 修复列表分页在最后一页显示空白的问题 | standard | standard | 0.96 | 0.85s |
| 把这个函数改成支持传入超时参数 | standard | standard | 0.73 | 0.77s |
| 排查多个模块之间的问题，并给出实现与测试方案 | complex | complex | 1.00 | 0.84s |
| 重构会话持久化层，拆分读写路径并保持向后兼容 | complex | complex | 0.37 | 0.80s |
| 设计并实施用户数据库从 MySQL 迁移到 Postgres 的不停机方案 | escalated | escalated | 1.00 | 0.78s |
| 审查认证模块的权限绕过漏洞并给出修复 | escalated | escalated | 1.00 | 0.81s |

- 10/10 与预期一致；p50 0.81s，最大 1.03s（10 个样本不足以给出可靠 p95）；合计 $0.000169，约 $0.000017/次。
- 另有 1 次前置探测（complex，1.01s）。账户免费层、充值 0，11 次请求均成功，余额已为负约 $0.00019；**OpenRouter 在何时以何种状态码拒绝，本次无法测出**，因此设计按状态码分类而不假设阈值。
- 置信度最低的一条（0.37）说明边界任务会有分歧；路由对任何成功响应均采用其 choice，不另设置信度门槛（避免引入第二套判断）。

## 结论

OpenRouter 承载 Jev 可行：连通、无 451、延迟约 0.8s、成本可忽略。数据处理方变为 OpenRouter + TypeSafe，用户已开通账户并同意试用。未覆盖：长期稳定性、限流阈值、余额耗尽的实际表现。
