## MODIFIED Requirements

### Requirement: Host compatibility runtime 跨版本族升级必须重新证明
当启用的 customization 请求长期 Host compatibility runtime 且 `dshVersion` 跨版本族变化时，该 compatibility runtime MUST 针对目标精确版本重新审查并生成可复核的来源证明、补丁身份、依赖替换身份与运行时能力证明。旧版本的 tag、commit、patch hash、构建产物、能力 marker 或“文本仍可应用”的结果 MUST NOT 被视为目标版本兼容证据。

目标版本缺少 customization 所要求的任一 Host 能力时，系统 SHALL 保留或重新推导最窄 compatibility seam；无法保持原有能力与安全语义时 SHALL 阻止目标 Host 启动，不得回退到官方 runtime、旧 compatibility runtime 或能力残缺的运行体。

重新证明 SHALL 以**逐项举证**方式进行：对每一个既有 seam，先在目标版本的官方已发布 API 上核验该能力是否已可表达。核验 MUST 依据目标版本的类型声明或官方文档原文，而不是依据该 seam 在旧版本上曾经必要这一历史事实。核验证明官方已支持时，该 seam SHALL 被移除并改用官方 API；核验证明官方仍不支持时，SHALL 记录被排除的官方替代路径后保留最窄 seam。

#### Scenario: 旧补丁无法应用到目标版本
- **WHEN** compatibility patch 在目标精确 DSH tag 上无法通过可应用性检查
- **THEN** 系统 SHALL 要求重新推导补丁和能力验证，MUST NOT 只更新版本字符串、commit 或 hash 后继续构建

#### Scenario: 旧补丁文本仍可应用
- **WHEN** 旧 compatibility patch 在目标 tag 上仍能文本应用
- **THEN** 系统 SHALL 仍重新固定目标版本 provenance 并复跑语义、原子性和并发能力验证，MUST NOT 把文本可应用等同于兼容

#### Scenario: 目标运行体缺少必需能力
- **WHEN** 官方目标运行体缺少 customization 已声明并依赖的任一能力，且重新推导的 compatibility runtime 未能证明该能力
- **THEN** 长期 Host 启动 SHALL fail closed，不得静默降级或套用旧运行体

#### Scenario: 目标版本官方已提供既有 seam 的能力
- **WHEN** 对既有 seam 的逐项核验表明目标版本官方 API 已能表达该语义
- **THEN** 该 seam SHALL 从 compatibility runtime 中移除并改用官方 API，MUST NOT 因其在旧版本上曾经必要而继续保留

### Requirement: compatibility runtime 只替换长期 Host 且保持单一依赖身份
Customization 请求的 compatibility runtime SHALL 只作用于长期 `dsh web` Host；build、plugin、dump-config 及其它官方一次性 CLI SHALL 继续使用 manifest 的官方精确 `dshVersion`，除非人类显式提供全局逃生路径。

Compatibility runtime 发布前 MUST 证明被替换的运行体包在 Host 依赖树中各自只有一个有效实例，实际解析路径、包名、版本、目标 tag/commit、patch 身份和能力 marker 全部匹配已审查声明。任何双实例、来源不明或 marker 缺失 MUST 阻止发布。

当 compatibility 产物同时经由独立于长期 Host 依赖根的第二条通道投影到部署 profile 时，该通道 SHALL 施加与长期 Host 同等的 provenance 校验。两条通道 MUST NOT 允许出现各自独立的新鲜度判定，使同一 compatibility 能力在不同路径上处于不同代际。

#### Scenario: 官方一次性 CLI 执行
- **WHEN** 用户在启用 Host compatibility 的 manifest 上执行 build、plugin 或 dump-config
- **THEN** 系统 SHALL 使用官方精确 `dshVersion`，不得构建或加载 Host compatibility overlay

#### Scenario: 长期 Host 解析 compatibility runtime
- **WHEN** `dsh web` 为目标版本准备并选择 compatibility runtime
- **THEN** 系统 SHALL 验证唯一依赖树、实际解析来源和全部能力 marker 后才允许启动

#### Scenario: manifest 与 compatibility 支持版本不一致
- **WHEN** `supportedDshVersion` 不精确等于 `dshVersion`
- **THEN** sync 与长期 Host 启动 SHALL 在产生部署副作用或启动服务前拒绝，自动升级链 SHALL 按既有规则回滚 manifest

#### Scenario: 两条投影通道代际不一致
- **WHEN** 部署 profile 中经第二条通道投影的 compatibility 产物与长期 Host 依赖根中的同名产物属于不同上游 base
- **THEN** 系统 SHALL 报告该不一致并拒绝将部署状态判定为已同步
