## ADDED Requirements

### Requirement: 当前不保留任何 Host compat seam
Pet SHALL 不携带任何替换官方宿主包的源码补丁或长期 Host 兼容运行体。重新引入任一 seam MUST 另立变更，并满足本能力既有的正面举证、逐项语义与可验证退役条件要求；manifest 中退役的 `hostRuntimeCompatibility` 声明 MUST NOT 被用作重新启用的开关。

#### Scenario: 官方仍存在已知缺陷
- **WHEN** 已知官方运行体存在曾由 compat seam 修补的缺陷，且所有者已接受其风险
- **THEN** 系统保持使用官方包，并在变更记录中写明残余风险与复查时机，而不是保留 seam

#### Scenario: 试图恢复旧声明
- **WHEN** manifest 或 overlay 重新写入 `hostRuntimeCompatibility`
- **THEN** 加载阶段报错说明该机制已退役，不构建或加载任何兼容运行体
