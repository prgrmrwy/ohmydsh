# Spec Delta

## ADDED Requirements

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
