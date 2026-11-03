## ADDED Requirements

### Requirement: 官方宿主与测试依赖独立

Memex SHALL 在官方 DSH `0.2.0-rc.2` 公开 API 上实现固定自检所需语义，MUST NOT 要求安装 Pet、构建 Pet launcher 或加载 Pet compatibility 产物。包的 runtime/peer 依赖 MUST NOT 引入 Pet 或实验 Team 包；真实 Team 仅作为开发测试依赖。集成测试 SHALL 默认从 Memex 自身声明的依赖解析 Host；附加外部图回归只能由显式、有效的绝对 package.json 路径选择，不得自动发现或回退到 Pet。

#### Scenario: 没有 Pet 目录也能执行完整自检测试
- **GIVEN** 仅有 Memex、其声明的官方开发依赖及已有非 Pet 测试夹具
- **WHEN** 运行完整六条件自检集成
- **THEN** 六根、八回合、十二裁判及原有清退、取消、预算、恢复断言通过，模块解析不使用 Pet 或 compat 产物

#### Scenario: 显式外部图输入无效
- **WHEN** 指定的测试 Host manifest 不是已存在的绝对普通文件
- **THEN** 测试初始化明确失败，不回退到其它依赖图

### Requirement: 裁判在原版 Team 共存时自持工具隔离

Memex SHALL 仅对创建窗口登记、由裁判父精确拥有的 child，通过官方 scoped assembly 接口移除已知 Team 工具的模型展示。执行 guard SHALL 持续只允许 `structured_output`；Host/root `llm/stream` 对真实 loop request、精确 live owner、冻结 route/effort、messages、schema 与 toolHistory 的最终门禁 MUST 保留。未知工具或上下文污染 SHALL 在 adapter 前拒绝。该隔离 MUST NOT 改变 Team roster、伪造 descriptor、禁用全局 Team 或影响日常会话。

#### Scenario: 原版 Team 误装工具仍能安全评分
- **GIVEN** 原版 Team 在裁判创建窗口误装九项 own 工具
- **WHEN** 精确裁判发出模型请求
- **THEN** 实际请求只暴露冻结 schema 的 structured_output，能够完成评分；日常 Team 工具保持可用

#### Scenario: 未知工具与后置污染仍拒绝
- **WHEN** 裁判被额外装入 own subagent、未知工具或非法上下文
- **THEN** 最终请求门禁拒绝，adapter 调用数为零；直接尝试其它工具执行同样被 guard 拒绝

#### Scenario: 宿主没有启用 Team
- **WHEN** 在未加载 Team 的官方宿主运行裁判
- **THEN** 裁判仍正常返回结构化结果，无额外运行时 Team 依赖
