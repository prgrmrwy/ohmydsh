# jev-provider-transport Specification

## Purpose

定义 Jev MCP 的服务方闭集（TypeSafe/OpenRouter）、每个服务方固定的凭据变量、生成的 profile 门控行与替换式 launcher 环境、凭据只经本机环境通道提供，以及就绪检查的报告口径。不提供跨服务方回退，也不为其它插件提供 Host 侧 transport。

## Requirements

### Requirement: Jev MCP provider is a closed set with a fixed credential mapping
`dsh.yaml` 中 `type: npm-mcp-server` 的 Jev 条目 SHALL 声明 `jevProvider`，取值闭集为 `typesafe` 与 `openrouter`，并 SHALL 声明 `credentialEnv`，其值 MUST 等于该服务方的固定映射：`typesafe → TYPESAFE_API_KEY`，`openrouter → OPENROUTER_API_KEY`。缺失 `jevProvider`、取值不在闭集，或 `credentialEnv` 与映射不一致时，manifest 校验 SHALL 在任何部署副作用之前抛出错误，错误信息指出字段名与期望值。`jevProvider` 是传输枚举，MUST NOT 被当作 npm 包 pin 参与冲突检测、包条目生成或完整性预检；`npm-workflow` 条目的 `provider` 包 pin 语义保持不变。

#### Scenario: OpenRouter 条目通过校验
- **GIVEN** Jev 条目为 `jevProvider: openrouter`、`credentialEnv: OPENROUTER_API_KEY`，其余字段合法
- **WHEN** 调用 `validateThirdPartyResources`
- **THEN** 返回的资源对象 `jevProvider` 为 `openrouter`、`credentialEnv` 为 `OPENROUTER_API_KEY`，且无异常

#### Scenario: 凭据变量与服务方不匹配被拒
- **GIVEN** Jev 条目为 `jevProvider: openrouter`、`credentialEnv: TYPESAFE_API_KEY`
- **WHEN** 调用 `validateThirdPartyResources`
- **THEN** 抛出的错误消息匹配 `credentialEnv: must be OPENROUTER_API_KEY for jevProvider openrouter`，且校验前的副作用计数为 0

#### Scenario: 未知或缺失服务方被拒
- **GIVEN** Jev 条目分别为 `jevProvider: cloudflare` 与缺少 `jevProvider` 字段
- **WHEN** 调用 `validateThirdPartyResources`
- **THEN** 两次都抛出消息匹配 `jevProvider: must be one of typesafe, openrouter` 的错误

#### Scenario: 混合资源的包 pin 枚举不含传输枚举
- **GIVEN** 已校验的 `npm-workflow`（带 `provider` 包 pin）与 `jevProvider: openrouter` 的 `npm-mcp-server` 两个资源
- **WHEN** 调用 `packagePins`、`resourcePackageItems`，并以计数解析器调用 `preflightResourceIntegrities`
- **THEN** 每个枚举出的 pin 都是带 `name`、`spec`、`integrity` 的对象；解析器恰收到 4 个 spec（workflow runtime、workflow provider、jev-mcp、mcp bridge），每个各一次，且没有任何调用参数含字符串 `openrouter`

### Requirement: Generated bridge row and launcher pass only the selected provider credential
生成的 profile 插入行 `third-party-jev-bridge` 的 `disabled` 门控与 `config.env` SHALL 只引用所选服务方的凭据变量。生成的 launcher SHALL 读取该变量，缺失时以退出码 78 静默退出；存在时 SHALL 以替换式 env 启动 jev-mcp，子进程应用环境恰为 `{<该凭据变量>: <值>, JEV_PROVIDER: <服务方>}`，不得继承其它环境变量，不得包含其它服务方的凭据变量名。launcher 自身产生的诊断 MUST NOT 含凭据值。jev-mcp 子进程是受信组件，其输出经继承的 stdio 直接传递，本要求不承诺过滤子进程输出（过滤会破坏 MCP 字节流）。

#### Scenario: OpenRouter 行与 launcher 只透传 OpenRouter 凭据
- **GIVEN** 已校验的 `jevProvider: openrouter` 资源且健康检查通过
- **WHEN** 渲染 profile 行与 launcher，并以 `OPENROUTER_API_KEY=unit-test-key`、`TYPESAFE_API_KEY=other`、`SHOULD_NOT_LEAK=nope` 运行 launcher，指向一个回写 env 的假服务
- **THEN** 行文本含 `!process.env.OPENROUTER_API_KEY` 与 `OPENROUTER_API_KEY: !!js process.env.OPENROUTER_API_KEY`，不含 `TYPESAFE_API_KEY`；假服务收到的应用环境键集合（忽略 macOS 注入的 `__CF_` 前缀键）恰为 `JEV_PROVIDER`、`OPENROUTER_API_KEY`，`JEV_PROVIDER` 为 `openrouter`

#### Scenario: 缺少所选凭据时 launcher 静默退出
- **GIVEN** `jevProvider: openrouter` 的 launcher
- **WHEN** 在只含 `TYPESAFE_API_KEY` 的环境中运行
- **THEN** 退出码为 78，stdout 与 stderr 均为空

#### Scenario: 入口缺失时 launcher 诊断不含凭据
- **GIVEN** `jevProvider: openrouter` 的 launcher 指向不存在的入口文件
- **WHEN** 以 `OPENROUTER_API_KEY=must-not-appear` 运行
- **THEN** 退出码非 0，stdout 与 stderr 都不含 `must-not-appear`

#### Scenario: TypeSafe 回滚保持原有生成结果
- **GIVEN** 已校验的 `jevProvider: typesafe`、`credentialEnv: TYPESAFE_API_KEY` 资源
- **WHEN** 渲染 launcher 并以 `TYPESAFE_API_KEY=unit-test-key` 运行
- **THEN** 子进程应用环境键集合恰为 `JEV_PROVIDER`、`TYPESAFE_API_KEY`，`JEV_PROVIDER` 为 `typesafe`，信号转发与退出码传递行为与改动前相同

### Requirement: Credential stays in local environment channels and readiness reports the configured variable
所选服务方的凭据 SHALL 只经 Host 启动环境提供（包括 launcher 以 strict 模式从 Git 忽略的仓库 `.env.local` 注入的字面值），MUST NOT 写入仓库、manifest、生成的 profile 文件、launcher、部署账本或日志。`scripts/jev-readiness.mjs` SHALL 按 manifest 中 Jev 条目的 `credentialEnv` 报告变量名、当前进程是否提供、`.env.local` 是否声明，报告 MUST NOT 含凭据值；读取会话工具列表时 SHALL 优先查找 `session.v4.jsonl.zstd`，不存在时回退到 `session.v3.jsonl.zstd`。

#### Scenario: .env.local 字面值进入 Host 环境
- **GIVEN** 临时仓库的 `.env.local` 含一行 `export OPENROUTER_API_KEY=sk-or-fixture-value`
- **WHEN** 调用 `loadEnvironment(repo, {})`
- **THEN** 返回的 `hostEnv.OPENROUTER_API_KEY` 为 `sk-or-fixture-value`

#### Scenario: 含 shell 展开的凭据行被拒且不泄露值
- **GIVEN** `.env.local` 含一行 `export OPENROUTER_API_KEY=$SECRET_SOURCE`
- **WHEN** 调用 `loadEnvironment(repo, {})`
- **THEN** 抛出的错误消息含 `shell expansion`，且不含 `SECRET_SOURCE`

#### Scenario: 就绪报告使用所配置变量名
- **GIVEN** manifest 的 Jev 条目为 `credentialEnv: OPENROUTER_API_KEY`，进程环境含 `OPENROUTER_API_KEY=readiness-secret`
- **WHEN** 运行 `node scripts/jev-readiness.mjs`
- **THEN** 输出 JSON 的 `credential.variable` 为 `OPENROUTER_API_KEY`、`credential.currentProcess` 为 `true`，整个输出不含 `readiness-secret`

#### Scenario: 就绪检查优先 v4 会话并回退 v3
- **GIVEN** 临时 `DSH_HOME` 中同一会话目录分别只有 v4 文件、只有 v3 文件、两者都有（v4 的工具列表含 `mcp__jev__jev_classify` 与 `mcp__jev__jev_decide`，v3 不含）
- **WHEN** 以该 `DSH_SESSION_ID` 运行 `node scripts/jev-readiness.mjs`
- **THEN** 三种情况的 `currentSession.available` 均为 `true`；两者都有时 `liveProbeReady` 为 `true`（读取了 v4）

#### Scenario: 生成物不含凭据值
- **GIVEN** Host 环境含 `OPENROUTER_API_KEY=deploy-secret`
- **WHEN** 渲染 profile 行与 launcher
- **THEN** 两份生成文本都不含 `deploy-secret`，只含变量名引用

### Requirement: Readiness decodes session logs without an external zstd binary
`scripts/jev-readiness.mjs` SHALL 在读取会话工具列表时只依赖 Node 运行时提供的解压能力，MUST NOT 以外部 `zstd` 可执行文件作为前置条件。它 SHALL 完整解码 `session.v4.jsonl.zstd`（该文件是多帧 zstd 流）后合并全部帧的内容；只解首帧 MUST NOT 被视为成功。

#### Scenario: 无外部 zstd 时仍可读取工具列表
- **GIVEN** 运行环境没有 `zstd` 可执行文件，且 `DSH_HOME` 中目标会话存在 `session.v4.jsonl.zstd`
- **WHEN** 以该 `DSH_SESSION_ID` 运行 `node scripts/jev-readiness.mjs`
- **THEN** `currentSession.available` 为 `true`，`jevTools` 含 `mcp__jev__jev_classify` 与 `mcp__jev__jev_decide`，`liveProbeReady` 为 `true`，输出中不含 `decodeFailed`

#### Scenario: 多帧日志不被首帧截断
- **GIVEN** 一个 `session.v4.jsonl.zstd`，其 `request/header` 事件与 `skill-catalog` 事件分别位于不同 zstd 帧
- **WHEN** 运行就绪检查
- **THEN** 两个事件都被解析到，`toolCount` 与 `routerSkill` 都反映完整日志内容

### Requirement: Readiness reports an actionable reason when a session cannot be read
就绪检查 SHALL 在无法读取会话时报告具体的失败原因（至少区分文件缺失、解压失败与解析后无 `request/header` 事件），MUST NOT 只以一个笼统布尔字段表达失败，也 MUST NOT 因此让整个就绪检查以非 0 退出或输出凭据值。

#### Scenario: 会话文件缺失
- **GIVEN** `DSH_HOME` 中不存在该 `DSH_SESSION_ID` 的日志文件
- **WHEN** 运行就绪检查
- **THEN** `currentSession.available` 为 `false`，原因字段标明文件缺失，进程退出码为 0

#### Scenario: 日志损坏
- **GIVEN** 目标日志文件存在但内容不是有效 zstd 流
- **WHEN** 运行就绪检查
- **THEN** `currentSession.available` 为 `false`，原因字段标明解压失败且不影响其它字段（凭据、profile pin、插入行）照常报告
