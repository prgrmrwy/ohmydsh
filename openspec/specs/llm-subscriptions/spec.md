# llm-subscriptions Specification

## Purpose
以 Claude / ChatGPT-Codex 订阅账号作为 DeepSeek Harness 主对话的 LLM「模型提供方」:登录/退出、凭据存储与共享、模型目录与选择器出现规则,在插件跨版本升级下保持稳定且可验证。

## Requirements

### Requirement: Claude 订阅登录可达且优先复用本机 Claude Code 登录态
系统 SHALL 支持以「导入本机 Claude Code 凭据」方式完成 Claude 订阅登录(macOS keychain → `~/.claude/.credentials.json` / `CLAUDE_CONFIG_DIR` 文件回退),作为设置页「登录」的默认路径;本机存在有效 Claude Code 登录态时,登录 SHALL 即刻成功(不要求浏览器 OAuth);本机无登录态时,SHALL 给出明确指引而非静默失败。登录流程 SHALL 不再触发 0.3.1 版的 `authorization failed`(旧 claude.ai 授权路径已废弃)。

#### Scenario: 本机已有 Claude Code 登录态
- **WHEN** 用户在设置 → 订阅点 Claude 的「登录」,且本机存在有效的 Claude Code 凭据(keychain 或凭据文件)
- **THEN** Claude 立即变为已登录(不弹浏览器),`auth.json` 生成 claude 会话,选择器随后出现 Claude 模型组

#### Scenario: 本机无 Claude Code 登录态
- **WHEN** 用户点 Claude 的「登录」,且本机无任何 Claude Code 凭据
- **THEN** 登录操作返回可读错误(提示先运行 `claude` 完成登录),不产生半成品会话,不影响其他 provider

#### Scenario: 旧版授权失败回归
- **WHEN** 登录流程与旧授权端点(`claude.ai/oauth/authorize` + localhost 回调)交互
- **THEN** 不出现 `authorization failed`;流程走 0.4.2 支持的新授权路径(含固定回调)或本机凭据导入

### Requirement: Claude 模型目录与选择器出现规则
系统 SHALL 在 Claude 已登录时通过 live 模型目录(`api.anthropic.com/v1/models`)列举可用模型(含模型支持的 thinking / effort 能力,当上游提供);未登录时 SHALL 返回空目录,使 Claude 不出现在会话模型选择器。静态 3 模型目录为 live 发现失败时的回退,不得是唯一来源。

#### Scenario: 已登录时选择器可见
- **WHEN** 用户打开 `/model` 且 Claude 已登录
- **THEN** 选择器显示 Claude 分组,列出 live 目录中的模型;支持 effort 的模型可选推理档

#### Scenario: 未登录时不出现
- **WHEN** 用户未登录 Claude(或登录被永久失效)
- **THEN** `/model` 选择器中不显示 Claude 分组;直接指定该路由请求返回明确的未登录提示

### Requirement: 凭据持久化与共享一致性
系统 SHALL 将订阅凭据以 owner-only(`0600`)原子写落盘(写入规则:插件历史路径 `$DSH_HOME/plugins/subscriptions/`);Claude 会话刷新后 SHALL 尝试将新 token 写回 Claude Code 自己的凭据库以保持与 `claude` CLI 同账号一致,且 SHALL 在写回前做 stale-blob 校验(Cli 或其它消费者已先行轮换时放弃写回并重读)。跨版本升级(0.3.1 → 0.4.2)SHALL 保持既有 codex 会话(access/refresh/accountId 等字段)沿用,不因升级而失效。

#### Scenario: 刷新写回与 CLI 保持同步
- **WHEN** 插件刷新了 claude 会话且本机 claude CLI 凭据仍是本次刷新前的旧值
- **THEN** 新 token 写回 CLI 凭据库(或等价 keychain 条目),插件与 CLI 继续共享同一会话;若 CLI 已先行轮换,写回放弃且插件重读最新值

#### Scenario: 升级不破坏既有会话
- **WHEN** manifest 从 0.3.1 升到 0.4.2 并重启
- **THEN** `auth.json` 中既有 codex 会话原样可用(无需重新登录),codex 模型选择器与流式工作正常

### Requirement: Provider 路由与适配层稳定性
系统 SHALL 保持订阅 provider 的路由标识(`codex` / `claude` / `grok`)在 0.4.2 升级前后不变,使部署侧的适配器边界包装(`subscriptions-sandbox-shim`,按 `codex`/`grok` 路由匹配)无需任何修改即继续生效。

#### Scenario: 升级后 shim 继续命中
- **WHEN** 升级到 0.4.2 并重启,shim 配置仍为 `providers: [codex, grok]`
- **THEN** codex/grok 适配器的 stream 仍被 shim 清洗(schema 出站剥离 + arguments 入站剥离 + 历史配对保护),行为与升级前一致

### Requirement: 登录状态变更后选择器目录刷新
系统 SHALL 在任一订阅 provider 登录或登出后触发模型目录刷新,使选择器同步(不要求手动刷新页面)。

#### Scenario: 登录/登出后刷新
- **WHEN** 用户在设置页完成某 provider 登录,或执行登出
- **THEN** 会话模型选择器在免刷新状态下反映该 provider 的可见性变化(新增或消失其模型组)
