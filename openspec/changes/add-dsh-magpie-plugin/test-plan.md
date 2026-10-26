## Test Plan

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 保存 key 后不回显 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "保存 key 后不回显" | 🟢 green |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 网关反射的 key 被脱敏 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "网关反射的 key 被脱敏" | 🟢 green |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 环境提供的 key 拒绝修改 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "环境提供的 key 拒绝修改" | 🟢 green |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 非法设置输入被拒绝 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "非法设置输入被拒绝" | 🟢 green |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 未配置时不提供模型且不发请求 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "未配置时不提供模型且不发请求" | 🟢 green |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 换地址后不显示旧目录 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "换地址后不显示旧目录" | 🟢 green |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 换 key 后不显示旧卡片 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "换 key 后不显示旧卡片" | 🟢 green |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 旧代晚到的响应被丢弃 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "旧代晚到的响应被丢弃" | 🟢 green |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 已准备的调用按捕获值跑完 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "已准备的调用按捕获值跑完" | 🟢 green |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 进行中的生成不被换代中止 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "进行中的生成不被换代中止" | 🟢 green |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 外部改 key 触发换代 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "外部改 key 触发换代" | 🟢 green |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 未收到事件时新操作发现 key 变化 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "未收到事件时新操作发现 key 变化" | 🟢 green |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 保存地址后自动同步并发布 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "保存地址后自动同步并发布" | 🟢 green |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 同步失败保留当前代目录 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "同步失败保留当前代目录" | 🟢 green |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 同代重复触发只发一次请求 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "同代重复触发只发一次请求" | 🟢 green |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 同步超时 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "同步超时" | 🟢 green |
| specs/dsh-magpie/spec.md → 目录同步与发布 | key 无效的分类 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "key 无效的分类" | 🟢 green |
| specs/dsh-magpie/spec.md → 模型目录字段映射 | 字段映射 | packages/dsh-magpie/test/catalog-mapping.test.ts | spec Scenario "字段映射" | 🟢 green |
| specs/dsh-magpie/spec.md → 模型目录字段映射 | 畸形条目被丢弃 | packages/dsh-magpie/test/catalog-mapping.test.ts | spec Scenario "畸形条目被丢弃" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 两种协议的文本生成与 effort | packages/dsh-magpie/test/generate.test.ts | spec Scenario "两种协议的文本生成与 effort" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | Responses 工具往返 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "Responses 工具往返" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | Chat 工具往返 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "Chat 工具往返" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 请求体与 usage 映射（两种协议） | packages/dsh-magpie/test/generate.test.ts | spec Scenario "请求体与 usage 映射（两种协议）" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 缺缓存详情、缺 total 与不一致计数 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "缺缓存详情、缺 total 与不一致计数" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 未选 effort 时不写推理字段 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "未选 effort 时不写推理字段" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 带 stop 的请求被拒绝 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "带 stop 的请求被拒绝" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 两种协议发送图片 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "两种协议发送图片" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 附件读取失败 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "附件读取失败" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 流中错误事件不当成功 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "流中错误事件不当成功" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 首事件与空闲超时 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "首事件与空闲超时" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 空 block start 不提前耗尽首内容预算 | packages/dsh-magpie/test/stream-timeout-investigation.test.ts | empty reasoning/message/function_call item start preserves first content at 65s and successful completion; without content times out at 90s | 🟢 green — 修复 owner focused 40/40、full 212 |
| specs/dsh-magpie/spec.md → 生成 | 首内容前的空 delta 不续期 | packages/dsh-magpie/test/stream-timeout-investigation.test.ts | empty reasoning/message/function_call delta at 55s does not renew the first-content deadline | 🟢 green — 90 秒绝对上限 |
| specs/dsh-magpie/spec.md → 生成 | 已有内容后的空结构与空 delta 不续期 | packages/dsh-magpie/test/stream-timeout-investigation.test.ts | reasoning/message/function_call content delta renews idle budget; later empty end/start/delta/comments do not | 🟢 green — 最后非空 delta 后 60 秒 |
| specs/dsh-magpie/spec.md → 生成 | 截断不当成功 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "截断不当成功" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 达到输出上限 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "达到输出上限" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 取消 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "取消" | 🟢 green |
| specs/dsh-magpie/spec.md → 生成 | 向不可收图模型发图 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "向不可收图模型发图" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读与传输边界 | 完整流程只触达白名单 | packages/dsh-magpie/test/transport.test.ts | spec Scenario "完整流程只触达白名单" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读与传输边界 | 重定向不被跟随 | packages/dsh-magpie/test/transport.test.ts | spec Scenario "重定向不被跟随" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读与传输边界 | 存在全局代理时仍直连 | packages/dsh-magpie/test/transport.test.ts | spec Scenario "存在全局代理时仍直连" | 🟢 green |
| specs/dsh-magpie/spec.md → 按 provider 分组的模型可见性 | 未设置时跟随网关 | packages/dsh-magpie/test/visibility.test.ts | spec Scenario "未设置时跟随网关" | 🟢 green |
| specs/dsh-magpie/spec.md → 按 provider 分组的模型可见性 | 设置后严格按白名单与目录求交集 | packages/dsh-magpie/test/visibility.test.ts | spec Scenario "设置后严格按白名单与目录求交集" | 🟢 green |
| specs/dsh-magpie/spec.md → 按 provider 分组的模型可见性 | 形状非法被拒绝 | packages/dsh-magpie/test/visibility.test.ts | spec Scenario "形状非法被拒绝" | 🟢 green |
| specs/dsh-magpie/spec.md → DSH 侧默认 effort | 设置与清除 | packages/dsh-magpie/test/default-effort.test.ts | spec Scenario "设置与清除" | 🟢 green |
| specs/dsh-magpie/spec.md → DSH 侧默认 effort | 拒绝非法档位 | packages/dsh-magpie/test/default-effort.test.ts | spec Scenario "拒绝非法档位" | 🟢 green |
| specs/dsh-magpie/spec.md → DSH 侧默认 effort | 档位失效时不下发，恢复后重新下发 | packages/dsh-magpie/test/default-effort.test.ts | spec Scenario "档位失效时不下发，恢复后重新下发" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 渲染卡片字段 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "渲染卡片字段" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 缺失字段不伪造 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "缺失字段不伪造" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 带错误的卡片仍显示 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "带错误的卡片仍显示" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 无权读取用量 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "无权读取用量" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 冷启动空集合 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "冷启动空集合" | 🟢 green |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 卡片字符串按字面渲染 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "卡片字符串按字面渲染" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新单张卡片 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新单张卡片" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 冷启动时刷新全部 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "冷启动时刷新全部" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 节流期内返回旧读数 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "节流期内返回旧读数" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 非法刷新目标被拒绝 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "非法刷新目标被拒绝" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 并发刷新复用进行中的那一次 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "并发刷新复用进行中的那一次" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 旧响应晚到不覆盖新结果 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "旧响应晚到不覆盖新结果" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新进行中打开的页面得到刷新结果 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新进行中打开的页面得到刷新结果" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 单卡刷新进行中时点刷新全部 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "单卡刷新进行中时点刷新全部" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 等待中的刷新不被跟随者压过 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "等待中的刷新不被跟随者压过" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新失败后闸门释放 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新失败后闸门释放" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 受限 key 冷启动刷新全部仍为空 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "受限 key 冷启动刷新全部仍为空" | 🟢 green |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新失败保留原卡片 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新失败保留原卡片" | 🟢 green |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 快速模式请求带 priority（两种协议） | packages/dsh-magpie/test/speed.test.ts | spec Scenario "快速模式请求带 priority（两种协议）" | 🟢 green |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 标准模式与其它会话不带字段 | packages/dsh-magpie/test/speed.test.ts | spec Scenario "标准模式与其它会话不带字段" | 🟢 green |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 不支持的模型不显示且不带字段 | packages/dsh-magpie/test/speed.test.ts + packages/dsh-magpie/test/speed-ui.test.tsx | spec Scenario "不支持的模型不显示且不带字段" | 🟢 green |
| specs/dsh-magpie/spec.md → Codex 速度切换 | host 重启后回到标准 | packages/dsh-magpie/test/speed.test.ts | spec Scenario "host 重启后回到标准" | 🟢 green |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 非法 tier 被拒绝 | packages/dsh-magpie/test/speed.test.ts | spec Scenario "非法 tier 被拒绝" | 🟢 green |
| specs/dsh-magpie/spec.md → 禁用不删除用户数据 | dispose 不删除数据 | packages/dsh-magpie/test/dispose.test.ts | spec Scenario "dispose 不删除数据" | 🟢 green |
| specs/dsh-magpie/spec.md → 禁用不删除用户数据 | dispose 时有进行中的请求 | packages/dsh-magpie/test/dispose.test.ts | spec Scenario "dispose 时有进行中的请求" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | DeepSeek/OpenAI/OpenCode 显示正确品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "DeepSeek/OpenAI/OpenCode 显示正确品牌" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Kimi/GLM/MiniMax/Pi 显示正确品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Kimi/GLM/MiniMax/Pi 显示正确品牌" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | OpenClaw/Hermes 显示正确品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "OpenClaw/Hermes 显示正确品牌" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | OpenCode 目录模型族得到品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "OpenCode 目录模型族得到品牌" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Trae route 显示 Trae 品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Trae route 显示 Trae 品牌" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | TraeX 目录模型族得到品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "TraeX 目录模型族得到品牌" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | OpenCode route 不被模型名误判 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "OpenCode route 不被模型名误判" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 未知兼容 route 使用 model fallback | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "未知兼容 route 使用 model fallback" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Magpie route 显示 Magpie 品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Magpie route 显示 Magpie 品牌" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Magpie 只按精确名或前缀匹配 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Magpie 只按精确名或前缀匹配" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 相似但不同的 route 名不被识别 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "相似但不同的 route 名不被识别" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 网关模型 id 按上游 provider 段识别 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "网关模型 id 按上游 provider 段识别" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 上游段无法识别时退回模型名 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "上游段无法识别时退回模型名" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 网关小图标取模型厂商而不是上游平台 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "网关小图标取模型厂商而不是上游平台" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 模型名优先于上游段 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "模型名优先于上游段" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 网关中转层单独识别 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "网关中转层单独识别" | 🟢 green |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 上游段不是品牌时没有中转层 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "上游段不是品牌时没有中转层" | 🟢 green |

## AMD2 coverage ledger — independent source recheck approved; live acceptance pending

原85场景的 green 是既有实测记录，不覆盖下面新场景。2026-10-25 收尾已独立重跑插件179与 pinned-source25，以及原339回归；下面 group 三行更新为分层 local green（并非一条插件→网络→GUI E2E）。独立 [AMD2 source/planning recheck](<review.md#L555-L618>) 已APPROVE；2026-10-26正式d1fb图与当前fingerprint inputs的只读恢复见verify末节。live GUI仍待验收，不改历史RED/旧review结论。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| 选择器按网关归属展示分组（AMD2） | owned_by 分组不随型号名猜测 | packages/dsh-magpie/test/display-group.test.ts + packages/dsh-pet/test/model-display-host.spec.ts + packages/dsh-pet/test/model-display-react.spec.tsx | `direct resolve/prepare use raw owned_by=$ownedBy, not misleading id/name`; `validates and deeply detaches display metadata through real LLM and Host catalog without changing routes`; `renders distinct display buckets without changing real providers or model names; click keeps route and effort selection` | 🟢 local green — plugin output + real patched Host/React layers; source recheck APPROVE; live GUI pending |
| 选择器按网关归属展示分组（AMD2） | 分组搜索保留可见性与 effort | packages/dsh-magpie/test/display-group.test.ts + packages/dsh-pet/test/model-display-react.spec.tsx + packages/dsh-pet/test/model-display-popup.spec.ts | `visibility and default effort preserve display groups and real route/model identity`; `searches group label, model id and name (%s) while keyboard accepts true identity`; `accepts exactly the highlighted Second model after ArrowDown across codex display groups`; `actual /model registration shares buckets, aliases and exact selection with the composer directory` | 🟢 local green — hidden/default filtering at plugin boundary, exact keyboard/click/effort + /model at Host-source boundary; source recheck APPROVE; live GUI pending |
| 选择器按网关归属展示分组（AMD2） | 缺失归属不冒充分组 | packages/dsh-magpie/test/display-group.test.ts + packages/dsh-pet/test/model-display-host.spec.ts + packages/dsh-pet/test/model-display-react.spec.tsx | `missing owned_by stays Other even when the existing settings fallback is codex`; `keeps ungrouped model metadata unchanged`; `rejects invalid displayGroup %j with INVALID_MODEL_INFO`; `renders distinct display buckets without changing real providers or model names; click keeps route and effort selection` | 🟢 local green — missing/raw ownership and ordinary fallback/invalid metadata covered separately; source recheck APPROVE; live GUI pending |
| 设置导航自身行使用 Magpie 鸟形图标（AMD2） | 鸟形图标只标记自身导航行 | packages/dsh-magpie/test/settings-nav-icon.test.ts | spec Scenario "鸟形图标只标记自身导航行" | 🟢 green — local behavior tested; source recheck APPROVE; live theme/GUI pending |
| 设置导航自身行使用 Magpie 鸟形图标（AMD2） | 卸载清理与缺失入口静默降级 | packages/dsh-magpie/test/settings-nav-icon.test.ts | spec Scenario "卸载清理与缺失入口静默降级" | 🟢 green — local behavior tested; source recheck APPROVE; live theme/GUI pending |

证据分层：插件 `display-group.test.ts` 的18例覆盖 raw owned_by（含误导名字、缺失/畸形/namespace碰撞）、list/resolve/prepare detach、visibility/default effort；它不证明 stock core 保留 metadata。受管 Host 源码原24例（现25，新增 finding2 exactcase）另证 real LLM 校验/detach、Host catalog、原 React selector、实际 `/model` 注册和 AgentLoop/投影。原339回归覆盖原选择/默认effort/命令路径。group 三行是这些实际测试的显式组合映射，不虚构 `spec Scenario` 标题，不声称完整插件→Remote网络→GUI贯通。设置图标测试实际执行 client apply、晚挂载/重挂载、旧 connect 行与重复同名负例、observer dispose、样式 currentColor/mask 及无 DOM 降级；DOM 测试不等于真实 GUI 主题视觉验收。

## AUTO compatibility + actual/next display ledger — expanded AMD2 source recheck approved

下列中文 scenario 与现有英文测试名是显式映射，不声称作者已将测试重命名。历史 AUTO 作者 targeted RED45→GREEN45 保留；本次独立全包31files/222tests、typecheck/build通过（含 finding1 双 MANUAL 回归）。纯显示三行另由真实 patched Host source25实测，不能用主 wire 调查替代。这些local green不替代独立review；扩大范围的source/planning recheck现已单独APPROVE，但仍不等于live GUI通过。

| Requirement | Scenario | Test File | Test Name / explicit mapping | State |
|-------------|----------|-----------|-----------------------------|-------|
| 新默认策略的双 Magpie 精确 transport 兼容 | 新旧 Magpie 子实例保持精确身份并恢复 | packages/auto-model-routing/test/policy-host.integration.test.ts | %s children retain exact transport routes across mode changes and plugin reload | 🟢 local green — independent 222-test rerun, dual-provider parameterized |
| 新默认策略的双 Magpie 精确 transport 兼容 | legacy 对新旧 Magpie 预览都发前拒绝 | packages/auto-model-routing/test/subagent-tool.test.ts | %s preview uses exact provider/model and legacy rejects before Jev | 🟢 local green — independent 222-test rerun |
| Magpie 兼容不扩大权限与能力范围 | GPT 主子保持同 transport 及支持的 effort | packages/auto-model-routing/test/policy-host.integration.test.ts | %s GPT main and child use supported efforts on the same transport | 🟢 local green — independent 222-test rerun |
| Magpie 兼容不扩大权限与能力范围 | 更新全局目录不能扩大父 captured allowlist | packages/auto-model-routing/test/policy-host.integration.test.ts | does not broaden the %s parent captured allowlist with a newer global catalog | 🟢 local green — independent 222-test rerun; cross-transport/capability/cap negatives additionally in policy-v2.test.ts |
| 主 actual effort 不借显示写回选择 | 主请求已应用而官方 pending 保留 | packages/auto-model-routing/test/policy-host.integration.test.ts | %s AUTO reaches the adapter while the official picker retains a differing pending selection | 🟢 green — actual high / next medium / selectModel=[]; not display acceptance |
| 主 actual effort 不借显示写回选择 | 异步解析期间切 MANUAL 不覆盖主请求 | packages/auto-model-routing/test/policy-host.integration.test.ts | main request rechecks MANUAL after asynchronous model resolution | 🟢 local green — independent 222-test rerun; unchanged behavior regression |
| actual 与 next effort 仅展示分离 | 同模型 actual 与 next effort 同时可见 | packages/dsh-pet/test/model-display-react.spec.tsx | visibly shows actual effort and next intent without mutating either; effort checks still use next | 🟢 local green — real patched source test passed; source recheck APPROVE; live GUI pending |
| actual 与 next effort 仅展示分离 | 新手选 intent 不被实际请求抹除 | packages/dsh-pet/test/model-display-host.spec.ts | renders actual request use separately while preserving both stale and newer user intent in real projection state | 🟢 local green — real patched source test passed; source recheck APPROVE; live GUI pending |
| actual 与 next effort 仅展示分离 | 无差异或不同模型维持普通展示 | packages/dsh-pet/test/model-display-react.spec.tsx | leaves ordinary matching efforts and different-route intents unchanged | 🟢 local green — real patched source test passed; source recheck APPROVE; live GUI pending |

共102个 delta scenarios = 原85 + AMD2五个 + 本轮AUTO九个 + 用户验收暴露的超时边界三个；当前102 local green /0 red（超时三个边界已有真实 RED→GREEN；实际用户长轮验收仍待重试）。green 是分层源码/行为证据；本轮source/planning有独立APPROVE，不是完整操作验收。display普通回退行在专用测试中明确测相同effort与不同provider；无lastUsed由其它默认setup覆盖、不同model分支由同一精确身份条件源码复核，不伪称新增独立参数例。主实际 request 与纯显示证据仍分开；尚无完整插件→受管宿主→真实GUI的验收。

## Coverage Notes

- **测试框架**：`packages/dsh-magpie` 用 vitest，与 `auto-model-routing`、`sidebar-session-provider-icon` 一致。原场景沿用 `spec Scenario "<场景名>"`；AMD2/AUTO英文实际标题按上表显式映射，不为凑标题重命名或声称不存在的测试。
- **共享 fixture**（`packages/dsh-magpie/test/support/`）：
  - 网关 mock：本机 `http.createServer`。记录每个请求的 method、path、query、headers 和 body；可以按路径编排 JSON 或 SSE 响应、延迟、断连、307，并记录同一时刻并发的请求数。
  - credentials mock：实现 `describe/resolve/set/unset`，可设为不可写、在不发事件的情况下切换 resolve 结果，或主动发出 `credentials/reference-updated`。
  - 附件服务 mock、代理 mock（作为全局 dispatcher 记录请求）、虚拟时钟（`vi.useFakeTimers`）。
  - 卡片和模型 fixture 取自 2026-10-25 对 CT105 的只读实测，key 和账号都换成占位值，不入库任何真实凭据。
- **生成测试**走真实 pi-ai 0.87.x（不 mock pi-ai），断言实际的 wire body 和 DSH 流块。这样 pi-ai 升级时可以兼作回归测试（design D2）。
- **web 半区测试**（`*.test.tsx`）用 jsdom 渲染设置页和速度栏，断言 DOM 文本以及有没有 img、script 元素。
- **sidebar 包**：源码不改；新增 `dsh-magpie` 正向和 `dsh-magpie2` 负向回归。AMD-1 另补四个具名场景：「网关小图标取模型厂商而不是上游平台」「模型名优先于上游段」「网关中转层单独识别」「上游段不是品牌时没有中转层」，对 `dsh-magpie` 与 `dsh-magpie-connect` 参数化核验。所有 sidebar 场景须按账本提供具名测试；现有 green 只表示基线回归，最终仍须重新运行套件验证。
- **2026-10-26 evidence reconciliation**：17.2按独立review接受的分层TDD receipt完成（Host clean RED24物理历史实读；plugin18fail→18pass仅author-reported消息回执，不声称rawlog重放）。18.8独立APPROVE不变更99行localgreen的层级。当前正式d1fb图descriptor动态probe与fingerprint重算通过，五包同physical LLM；新incognito3080得401且无安全官方existing-server auth交付，未观察GUI。Responses optional-tools strict另owner调查中，无本轮已修结论；2.5/16.2/16.3/16.4仍open。
- **不进 test-plan、但在 tasks 里机械验证的项**：README 治理（`npm test` 中的 repo-docs-governance）、包元数据自检（prepare、prepack、files、exports）、`npm run check:artifacts`、`node scripts/sync.mjs` 连续两次不产生变化，以及只读冒烟：对 CT105 跑一次目录同步、一次生成、一次读卡片。

## AMD3 ledger — supersedes AMD2 no-write/dual-value rows (2026-10-26)

上文118–122行及102 localgreen计数是旧冻结历史，不是新需求通过；禁止selectModel和双值显示明确废止。新需求由下表独立验证，旧分组/transport/cap/identity回归保留。

| Requirement | Scenario | Test File | Test Name / explicit mapping | State |
|---|---|---|---|---|
| AUTO 主 effort 同步官方选择 | 同次主请求同步官方 effort 与 defaults | packages/auto-model-routing/test/policy-host.integration.test.ts | AUTO synchronizes the same request, official selection and global defaults | 🟢 local green — actual RED→GREEN |
| AUTO 主 effort 同步官方选择 | 同步失败不丢本次请求 | packages/auto-model-routing/test/policy-host.integration.test.ts | selection sync failure true/missing keeps the official effort and logs the failure | 🟢 local green — parent RED26=2fail24pass→GREEN26，失败保留原官方 effort |
| AUTO 主 effort 同步官方选择 | 手动与子请求不污染默认 | packages/auto-model-routing/test/policy-host.integration.test.ts | same effort and MANUAL do not sync; GPT main and child use supported efforts on the same transport | 🟢 local green — no extra selection/default write |
| AUTO 主 effort 同步官方选择 | 异步解析期间切 MANUAL 不覆盖主请求 | packages/auto-model-routing/test/policy-host.integration.test.ts | main request rechecks MANUAL after asynchronous model resolution | 🟢 local green — fresh regression |
| 选择器恢复官方单值 effort | 单值 effort 与选择一致 | packages/dsh-pet/test/model-display-react.spec.tsx + model-display-host.spec.ts | displays one official effort; directory keeps official current selection | 🟢 local green — actual RED→GREEN |
| 选择器恢复官方单值 effort | 分组搜索与精确选择保留 | packages/dsh-pet/test/model-display-react.spec.tsx + model-display-popup.spec.ts | existing exact keyboard/click/search regressions | 🟢 local green — fresh regression |

AMD3 实跑：实施者 AUTO33files261tests/typecheck/build，parent 同步失败复核后最终 AUTO33files262tests/typecheck/build；隔离pinned Host4files24tests（RED2fail22pass→GREEN24），原selector3files78tests；builder5、governance30、artifacts/strict/whitespace通过。不代表编译图或live GUI验收。官方全局默认使用inert saveSelection port证明真实controller调用，不声称本轮真实defaults落盘。
