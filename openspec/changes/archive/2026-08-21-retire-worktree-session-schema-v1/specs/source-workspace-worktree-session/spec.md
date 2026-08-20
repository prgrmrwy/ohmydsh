## REMOVED Requirements

### Requirement: Existing independent Workspace records remain compatible
**Reason**: schema-v1 target-Workspace handoff 流程已正式退役。当前所有已注册 DSH Workspace 的 `.git/ws/operations` 均无 v1 持久数据，v1 只服务于已废弃产品路径。继续承诺兼容维护需要保留 v1 reader、`handoff` union 与 legacy cleanup 分支，代价长期存在。
**Migration**: 对任何遗留 v1 operation，系统不得自动迁移或伪造 source binding；operator 可使用旧版本插件或手工 Git 恢复，或忽略该历史记录。历史 Session 日志与 Workspace 注册不会被本退役逻辑删除。

## ADDED Requirements

### Requirement: Retired schema-v1 operations fail closed
系统 SHALL 将 `schemaVersion: 1` 及任何未知未来版本视为已退役或不受支持的 operation 格式，并在 status/promote/clean/recovery 中返回明确的 unsupported-version 诊断；系统 MUST 不为该类 operation 创建、修改或删除任何 Git worktree、branch、绑定、依赖或 operation 文件，且 MUST 不迁移或伪造绑定。

#### Scenario: Status receives a schema-v1 operation
- **WHEN** `ws status` 解析到 `schemaVersion: 1` 的 operation metadata
- **THEN** 系统 SHALL 返回清晰的 unsupported-version 诊断，且不修改任何持久数据或 Git 资源

#### Scenario: Promote receives a schema-v1 operation
- **WHEN** `ws promote` 解析到 `schemaVersion: 1` 的 operation metadata
- **THEN** 系统 SHALL 拒绝操作且不得改动依赖、lean 链接或绑定状态

#### Scenario: Clean receives a schema-v1 operation
- **WHEN** `ws clean` 解析到 `schemaVersion: 1` 的 operation metadata
- **THEN** 系统 SHALL 拒绝清理，且不得删除 Git worktree、branch 或 operation 文件

#### Scenario: Unknown future schemaVersion
- **WHEN** 系统遇到既非 1 也非 2 的 `schemaVersion`
- **THEN** 系统 SHALL 以与退役版本相同的 fail-closed 语义拒绝，并报告遇到的具体版本号

### Requirement: Legacy history is preserved, never migrated
系统 SHALL 保留历史源 Session 日志与既有 DSH Workspace/Session 注册；退役 schema-v1 不得触发任何自动迁移、重绑定、重命名或删除历史实体，且任何路径都无法为旧格式伪造 source-session binding。

#### Scenario: Historical Session logs remain readable
- **WHEN** 用户或系统在 schema-v1 退役后访问历史 Session 日志
- **THEN** 日志 SHALL 保持原样可读，系统不得改写或迁移其历史内容

#### Scenario: No binding fabrication for legacy records
- **WHEN** 系统遇到一个遗留 v1 operation 或独立 Workspace/Session 记录
- **THEN** 系统 SHALL 不为其创建 source-session binding，也不将其从“已归档或独立”状态重绑定或重归类
