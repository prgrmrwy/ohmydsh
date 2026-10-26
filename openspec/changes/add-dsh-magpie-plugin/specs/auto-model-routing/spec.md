## ADDED Requirements

### Requirement: 新默认策略的双 Magpie 精确 transport 兼容
当前默认 `policy-v2` SHALL 在目录、策略路由、预览工具与持久化恢复中接受 `dsh-magpie` 和 `dsh-magpie-connect`，保持各自精确 provider 与网关完整 model ID，不把两者互为 alias，也不转到本地 claude/codex。自动推荐 SHALL 仅使用已定义的 claude/codex 能力家族；其它家族仍须显式模型及可验证 effort。该增量 SHALL NOT 改变显式 legacy 回滚的既有语义：仅当所属根会话为 AUTO 且显式选择 legacy 时，两个 Magpie transport 的新预览均在请求 Jev 前拒绝；所属根会话为 MANUAL 时仍返回 `{routed: false, reason: "manual"}`，不判档、不外发、不写状态；此前已绑定实例继续按既定精确身份恢复。

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

### Requirement: 主 actual effort 不借显示写回选择
新默认 AUTO 主请求 SHALL 不按 transport 名称跳过已支持的 effort 调整；provider/model SHALL 保持不变。实际应用 SHALL 由 adapter/request-header 验证，不因选择器仍有 pending effort 就宣称未判档。系统 SHALL NOT 为同步显示调用会保存全局 defaults 的 selectModel，不覆盖官方 next/pending；MANUAL 请求 SHALL 继续原样通过。该限定仅针对新默认策略，不改写 current spec 中显式 legacy 的历史同步规则。

#### Scenario: 主请求已应用而官方 pending 保留
- **GIVEN** 新旧 Magpie AUTO 主模型 pending medium，模型支持 high，Jev depth 为 higher
- **WHEN** 实际主请求执行
- **THEN** adapter 与 request-header 为原 provider/model 和 high，官方投影 lastUsed=high/next=medium，selectModel 调用数为零；此证据不等于 GUI 显示完成

#### Scenario: 异步解析期间切 MANUAL 不覆盖主请求
- **GIVEN** AUTO 主请求正在异步解析模型能力
- **WHEN** 会话切为 MANUAL 后解析完成
- **THEN** 输出保持官方合成请求不被 AUTO 覆盖，不为显示保存 selection 或全局 defaults

### Requirement: actual 与 next effort 仅展示分离
受管宿主 SHALL 通过 Pet 现有 compat 唯一 owner 的 pinned-source patch，使 ModelDirectory 仅透出官方已有 lastUsed。lastUsed 与 next 的 provider/model 相同且 effort 不同时，选择器 trigger 与 root effort 行 SHALL 同时显示实际与下次值，例如“实际 High · 下次 Medium”（英文亦区分 last used/next）。current、pending、check、effort menu 选中态和提交 SHALL 仍取 next，展示 SHALL NOT 改写 projection、调用 selectModel 或保存全局 defaults。用户主动选择仍按原流程提交，不把展示 no-write 误解为禁用用户操作。

#### Scenario: 同模型 actual 与 next effort 同时可见
- **GIVEN** 同 provider/model 的 lastUsed high、next medium
- **WHEN** 渲染选择器 trigger、root effort 行并打开 effort 子菜单
- **THEN** 前两处同时显示实际 High 与下次 Medium，effort 子菜单仍勾选 Medium，未发生选择写入；用户主动选 High 才提交原 provider/model 与 High

#### Scenario: 新手选 intent 不被实际请求抹除
- **GIVEN** 已有 lastUsed high、next medium，用户后来选择 low
- **WHEN** 官方投影再记录同模型实际 high 并重新渲染
- **THEN** next/current/pending 仍表示 low，显示实际 High 与下次 Low，lastUsed仍high，不产生显示写回或defaults保存

#### Scenario: 无差异或不同模型维持普通展示
- **GIVEN** lastUsed 缺失、与 next effort 相同，或 lastUsed 和 next 的 provider/model 不同
- **WHEN** 渲染选择器
- **THEN** 不显示同模型 effort 差异提示，不伪造实际 effort，普通选择与 MANUAL 请求行为不变
