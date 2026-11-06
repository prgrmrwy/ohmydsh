## ADDED Requirements

### Requirement: 部署面显式启用官方文件观察策略
`dsh.yaml` 启用的每个 DSH profile SHALL 让官方 `@deepseek-ai/dsh-fs-observation-policy` 行（行 id `fs-observation-policy`）处于启用状态，使「改前先读」与外部修改防护不随运行体默认值静默变化。启用 SHALL 通过一个 manifest `type: patch` 条目，对官方同 id 行做覆盖来实现；MUST NOT 新增第二条加载同一包的行（该策略的 intent slot 只有一个决策者，先注册者生效，重复行会让顺序不可控）。该条目 SHALL 可逆：设为 `enabled: false` 并 `dsh build` 后，profile 恢复官方默认。官方行的 id 或包名变化时，sync 或测试 SHALL 失败并指出该条目，MUST NOT 静默失去防护。

#### Scenario: 启用后有效配置含策略行且未禁用
- **GIVEN** manifest 中该 patch 条目为 `enabled: true`
- **WHEN** 执行 `dsh build`，再以目标运行体 `--dump-config` 导出 web profile 的有效配置
- **THEN** 有效配置中恰有一条 `name` 为 `@deepseek-ai/dsh-fs-observation-policy` 的行，其 id 为 `fs-observation-policy`，且不处于禁用状态；第二次 `dsh build` 无变更

#### Scenario: 未读先改被拒绝
- **GIVEN** 隔离预览中的 web profile 已启用该策略，工作区中有一个本会话未读过的已存在文件
- **WHEN** Agent 对该文件调用 `edit`
- **THEN** 工具返回错误码 `FS_NOT_OBSERVED`，文件内容不变

#### Scenario: 禁用后恢复官方默认
- **GIVEN** 该 patch 条目改为 `enabled: false`
- **WHEN** 执行 `dsh build` 并导出有效配置
- **THEN** 有效配置中 `fs-observation-policy` 行的状态与官方默认一致（禁用）；profile patch 中不再含本条目的 fragment

#### Scenario: 官方行缺失时失败而非静默
- **GIVEN** 目标运行体的官方组合中不存在 id 为 `fs-observation-policy`、包名为 `@deepseek-ai/dsh-fs-observation-policy` 的行
- **WHEN** 运行仓库测试或 `dsh build`
- **THEN** 检查失败，报错中包含该 patch 条目的 id 和缺失的行 id
