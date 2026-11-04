## ADDED Requirements

### Requirement: 长期 Host 只使用官方精确运行体
长期 `dsh web` Host 与 build、plugin、dump-config 等一次性 CLI SHALL 使用 manifest `dshVersion` 指定的同一官方精确运行体；除人类显式提供的全局 `DSH_BIN` 逃生路径外，系统 MUST NOT 构建、选择或加载由 customization 声明的替代 Host 运行体。

#### Scenario: 启用 Pet 时启动长期 Host
- **WHEN** manifest 启用 `dsh-pet` 并执行 `dsh web`
- **THEN** Host 由官方精确 `dshVersion` 运行体启动，启动事件不报告 customization 拥有的运行体

#### Scenario: 显式 DSH_BIN 覆盖
- **WHEN** 人类显式设置 `DSH_BIN`
- **THEN** 系统按既有逃生路径使用该可执行文件，不因本要求改变

## REMOVED Requirements

### Requirement: Host compatibility runtime 跨版本族升级必须重新证明
**Reason**: 兼容运行体已整体退役，最后一处 team-membership seam 由所有者接受风险后删除。
**Migration**: 升级 DSH 只更新 `dshVersion` 并按常规回归验证；若将来重新需要源码补丁，按 `pet-compat-minimization` 另立变更。

### Requirement: compatibility runtime 只替换长期 Host 且保持单一依赖身份
**Reason**: 长期 Host 不再有替代运行体，单一依赖身份由官方发布图保证。
**Migration**: 无需迁移；部署后长期 Host 与一次性 CLI 使用同一官方精确版本。
