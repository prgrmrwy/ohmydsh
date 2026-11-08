# fs-observation-policy Specification

## Purpose
DSH 0.2.2 起官方文件观察策略（改文件前必须先读、读后被外部修改则拒绝编辑）默认关闭。本仓在 sync 物化的 web profile 中显式启用它，使这层防护不随运行体默认值变化而静默消失；启用方式是整行覆盖官方行，不新增第二条加载同一包的行。

## Requirements

### Requirement: 部署面显式启用官方文件观察策略
sync 物化的 DSH profile（`DSH_PROFILE`，默认 `web`）SHALL 让官方 `@deepseek-ai/dsh-fs-observation-policy` 行（行 id `fs-observation-policy`）处于启用状态，使「改前先读」与外部修改防护不随运行体默认值静默变化。sync 不物化的 profile（如 `superagent`）不在本要求范围内，由其所属 change 另行决定。

启用 SHALL 通过一个 manifest `type: patch` 条目，对官方同 id 行做整行覆盖来实现；MUST NOT 新增第二条加载同一包的行（该策略的 intent slot 只有一个决策者，先注册者生效，重复行会让顺序不可控）。该条目 SHALL 可逆：设为 `enabled: false` 并 `dsh build` 后，profile 恢复官方默认。每次 DSH 升级的候选验收 SHALL 重跑下面第一个场景的 `--dump-config` 检查，以发现官方行改名或移除。

#### Scenario: 启用后有效配置含策略行且未禁用
- **GIVEN** manifest 中该 patch 条目为 `enabled: true`
- **WHEN** 执行 `dsh build`，再以目标运行体 `--dump-config` 导出 web profile 的有效配置
- **THEN** 有效配置中恰有一条 `name` 为 `@deepseek-ai/dsh-fs-observation-policy` 的行，其 id 为 `fs-observation-policy`，且不处于禁用状态；第二次 `dsh build` 无变更

#### Scenario: 未读先改被拒绝
- **GIVEN** 隔离预览中的 web profile 已启用该策略，工作区中有一个本会话未读过的已存在文件
- **WHEN** Agent 对该文件调用 `edit`
- **THEN** 工具返回错误码 `FS_NOT_OBSERVED`，文件内容不变

#### Scenario: 读后被外部修改再编辑被拒绝
- **GIVEN** 隔离预览中的 web profile 已启用该策略，Agent 已读过文件 F，随后会话外的进程改写了 F
- **WHEN** Agent 对 F 调用 `edit`
- **THEN** 工具返回错误码 `FS_STALE_VERSION`，F 保留外部写入的内容；Agent 重新读取 F 后再 `edit` 成功

#### Scenario: 禁用后恢复官方默认
- **GIVEN** 该 patch 条目改为 `enabled: false`
- **WHEN** 执行 `dsh build` 并导出有效配置
- **THEN** 有效配置中 `fs-observation-policy` 行的状态与官方默认一致（禁用）；profile patch 中不再含本条目的 fragment
