## ADDED Requirements

### Requirement: 新默认策略的双 Magpie 精确 transport 兼容
当前默认 `policy-v2` SHALL 在目录、策略路由、预览工具与持久化恢复中接受 `dsh-magpie-connector` 和 `dsh-magpie-connect`，保持各自精确 provider 与网关完整 model ID，不把两者互为 alias，也不转到本地 claude/codex。自动推荐 SHALL 仅使用已定义的 claude/codex 能力家族；其它家族仍须显式模型及可验证 effort。该增量 SHALL NOT 改变显式 legacy 回滚的既有语义：仅当所属根会话为 AUTO 且显式选择 legacy 时，两个 Magpie transport 的新预览均在请求 Jev 前拒绝；所属根会话为 MANUAL 时仍返回 `{routed: false, reason: "manual"}`，不判档、不外发、不写状态；此前已绑定实例继续按既定精确身份恢复。

#### Scenario: 新旧 Magpie 子实例保持精确身份并恢复
- **GIVEN** 当前默认策略下的 AUTO 主会话，transport 分别为新旧 Magpie，目录和允许列表包含同 transport 的目标模型
- **WHEN** 创建 bounded 子实例，再重载插件、切父 MANUAL/legacy 并恢复该已绑定实例
- **THEN** 初始持久绑定及后续实际请求仍为原 transport 和完整 model ID；恢复不重判、不迁移到另一个 Magpie 或本地入口

#### Scenario: legacy 对新旧 Magpie 预览都发前拒绝
- **GIVEN** 所属根会话为 AUTO，显式 legacy 回滚及任一 Magpie transport
- **WHEN** 调用 route_subagent 预览
- **THEN** 报 policy-v2 限定错误，Jev 请求数不增加；不改变已有 legacy 本地路由语义

### Requirement: Magpie 兼容不扩大权限与能力范围
新旧 Magpie 的候选 SHALL 同时满足精确 provider/model 的实时目录能力、自动 effort cap、当前官方允许列表及存在时的父会话 captured allowlist。兼容分类 SHALL NOT 将另一 transport 的许可视为本 transport 许可，不添加或放宽任何 allowlist 项，不静默突破能力或 effort cap。持久记录损坏 SHALL 继续 fail closed。

#### Scenario: GPT 主子保持同 transport 及支持的 effort
- **GIVEN** AUTO Magpie GPT 主模型与同 transport 的 bounded GPT 子模型均在目录/允许列表内且支持目标 effort
- **WHEN** 主请求和 fresh 子请求应用新默认策略
- **THEN** 主 provider/model 不变并应用支持的 effort；子使用同 transport 的 codex/gpt-6-luna，持久恢复后保持身份和 effort

#### Scenario: 更新全局目录不能扩大父 captured allowlist
- **GIVEN** 任一 Magpie 父会话 captured allowlist 不含当前目标，即使较新全局目录和列表已含该目标
- **WHEN** 创建需要该目标的子实例
- **THEN** 拒绝该路由且无越权实际子请求；另一 Magpie transport 的许可与不支持/超过 cap 的 effort 也不能放行

### Requirement: AUTO 主 effort 同步官方选择
默认 policy-v2 主请求 SHALL 保持官方合成 provider/model，按既有 depth 算法、实时支持与 effort cap 选 effort；与官方合成 effort 不同时 SHALL 等待官方 sessionController.selectModel，以同 sessionId/provider/model 和选定 reasoningEffort 更新选择，允许官方保存全局 defaults。相同 effort SHALL 不重复同步。官方同步失败或 writer 尚不可用 SHALL 记录可诊断告警，保留官方原请求 effort 以避免再次产生显示差异，不将目标 effort 标为 applied、不静默吞错、不换模型；MANUAL、无 effort 支持及已绑定 child 请求 SHALL 不因此写官方选择。此授权废止 AMD2 禁止 selectModel/global-default 的限定，判档、child 精确绑定与 legacy 不变。

#### Scenario: 同次主请求同步官方 effort 与 defaults
- **GIVEN** 默认 AUTO 主模型 pending medium，模型支持 high，Jev depth 为 higher
- **WHEN** 真实主请求执行（包含新旧 Magpie 与普通 route）
- **THEN** adapter/header、官方选择与默认保存均为同 provider/model 的 high；同步完成后才发出该请求，不产生递归请求，后续相同 effort 不重复写

#### Scenario: 同步失败不丢本次请求
- **GIVEN** 官方当前选择 medium、AUTO 目标 high，但官方 selectModel 拒绝或 writer 不可用
- **WHEN** 主请求执行
- **THEN** 记录同步告警，实际请求保留原 provider/model/medium，使选择与请求一致；不停用 AUTO、不伪造目标 high 已同步或 applied

#### Scenario: 手动与子请求不污染默认
- **GIVEN** MANUAL 主会话、同 effort AUTO 主请求，或此前精确绑定的 child
- **WHEN** 对应请求执行或恢复
- **THEN** MANUAL 请求原样通过，child 保持既定路由；均无额外 selectModel/defaults 保存

#### Scenario: 异步解析期间切 MANUAL 不覆盖主请求
- **GIVEN** AUTO 主请求正在异步解析模型能力
- **WHEN** 会话切为 MANUAL 后解析完成
- **THEN** 输出保持官方合成请求，不写官方选择或全局 defaults

### Requirement: 选择器恢复官方单值 effort
受管宿主 SHALL 删除仅服务 actual/next 双值展示的 ModelDirectory.lastUsed 接缝、caption helper 与 locale；trigger、root effort 行和 menu SHALL 依官方 current 展示单一 effort，不出现“最近实际/下次”或 Last used/Next 双值文案。展示分组、统一搜索、真实 provider/model 的 click/keyboard/effort 提交、core modelSelection 投影及 metadata 校验/detach SHALL 保留；不得维护两套 value helper 或手改 generated dirs。

#### Scenario: 单值 effort 与选择一致
- **GIVEN** 官方 current 为同模型 high（或手选 medium/low）
- **WHEN** 渲染 trigger、root effort 行和 effort menu
- **THEN** 只展示官方 current 的一个 effort，menu 勾选相同值；主动选择仍按原 provider/model 与选定 effort 提交，无展示写入

#### Scenario: 分组搜索与精确选择保留
- **GIVEN** Claude/GPT 展示组与普通 provider 共存
- **WHEN** 搜索组标签、型号或完整 id，并使用 click 或 keyboard 接受
- **THEN** 保持既有可见顺序、唯一高亮与真实 provider/model/effort 提交，展示组 key 不充当 provider
