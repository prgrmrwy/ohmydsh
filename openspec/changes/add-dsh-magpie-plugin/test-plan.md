## Test Plan

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 保存 key 后不回显 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "保存 key 后不回显" | 🔴 red |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 网关反射的 key 被脱敏 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "网关反射的 key 被脱敏" | 🔴 red |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 环境提供的 key 拒绝修改 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "环境提供的 key 拒绝修改" | 🔴 red |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 非法设置输入被拒绝 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "非法设置输入被拒绝" | 🔴 red |
| specs/dsh-magpie/spec.md → 网关连接与凭据 | 未配置时不提供模型且不发请求 | packages/dsh-magpie/test/connection.test.ts | spec Scenario "未配置时不提供模型且不发请求" | 🔴 red |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 换地址后不显示旧目录 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "换地址后不显示旧目录" | 🔴 red |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 换 key 后不显示旧卡片 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "换 key 后不显示旧卡片" | 🔴 red |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 旧代晚到的响应被丢弃 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "旧代晚到的响应被丢弃" | 🔴 red |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 已准备的调用按捕获值跑完 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "已准备的调用按捕获值跑完" | 🔴 red |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 进行中的生成不被换代中止 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "进行中的生成不被换代中止" | 🔴 red |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 外部改 key 触发换代 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "外部改 key 触发换代" | 🔴 red |
| specs/dsh-magpie/spec.md → 连接身份与代际隔离 | 未收到事件时新操作发现 key 变化 | packages/dsh-magpie/test/generation.test.ts | spec Scenario "未收到事件时新操作发现 key 变化" | 🔴 red |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 保存地址后自动同步并发布 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "保存地址后自动同步并发布" | 🔴 red |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 同步失败保留当前代目录 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "同步失败保留当前代目录" | 🔴 red |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 同代重复触发只发一次请求 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "同代重复触发只发一次请求" | 🔴 red |
| specs/dsh-magpie/spec.md → 目录同步与发布 | 同步超时 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "同步超时" | 🔴 red |
| specs/dsh-magpie/spec.md → 目录同步与发布 | key 无效的分类 | packages/dsh-magpie/test/catalog-sync.test.ts | spec Scenario "key 无效的分类" | 🔴 red |
| specs/dsh-magpie/spec.md → 模型目录字段映射 | 字段映射 | packages/dsh-magpie/test/catalog-mapping.test.ts | spec Scenario "字段映射" | 🔴 red |
| specs/dsh-magpie/spec.md → 模型目录字段映射 | 畸形条目被丢弃 | packages/dsh-magpie/test/catalog-mapping.test.ts | spec Scenario "畸形条目被丢弃" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 两种协议的文本生成与 effort | packages/dsh-magpie/test/generate.test.ts | spec Scenario "两种协议的文本生成与 effort" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | Responses 工具往返 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "Responses 工具往返" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | Chat 工具往返 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "Chat 工具往返" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 请求体与 usage 映射（两种协议） | packages/dsh-magpie/test/generate.test.ts | spec Scenario "请求体与 usage 映射（两种协议）" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 缺缓存详情、缺 total 与不一致计数 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "缺缓存详情、缺 total 与不一致计数" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 未选 effort 时不写推理字段 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "未选 effort 时不写推理字段" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 带 stop 的请求被拒绝 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "带 stop 的请求被拒绝" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 两种协议发送图片 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "两种协议发送图片" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 附件读取失败 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "附件读取失败" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 流中错误事件不当成功 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "流中错误事件不当成功" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 首事件与空闲超时 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "首事件与空闲超时" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 截断不当成功 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "截断不当成功" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 达到输出上限 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "达到输出上限" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 取消 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "取消" | 🔴 red |
| specs/dsh-magpie/spec.md → 生成 | 向不可收图模型发图 | packages/dsh-magpie/test/generate.test.ts | spec Scenario "向不可收图模型发图" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读与传输边界 | 完整流程只触达白名单 | packages/dsh-magpie/test/transport.test.ts | spec Scenario "完整流程只触达白名单" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读与传输边界 | 重定向不被跟随 | packages/dsh-magpie/test/transport.test.ts | spec Scenario "重定向不被跟随" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读与传输边界 | 存在全局代理时仍直连 | packages/dsh-magpie/test/transport.test.ts | spec Scenario "存在全局代理时仍直连" | 🔴 red |
| specs/dsh-magpie/spec.md → 按 provider 分组的模型可见性 | 未设置时跟随网关 | packages/dsh-magpie/test/visibility.test.ts | spec Scenario "未设置时跟随网关" | 🔴 red |
| specs/dsh-magpie/spec.md → 按 provider 分组的模型可见性 | 设置后严格按白名单与目录求交集 | packages/dsh-magpie/test/visibility.test.ts | spec Scenario "设置后严格按白名单与目录求交集" | 🔴 red |
| specs/dsh-magpie/spec.md → 按 provider 分组的模型可见性 | 形状非法被拒绝 | packages/dsh-magpie/test/visibility.test.ts | spec Scenario "形状非法被拒绝" | 🔴 red |
| specs/dsh-magpie/spec.md → DSH 侧默认 effort | 设置与清除 | packages/dsh-magpie/test/default-effort.test.ts | spec Scenario "设置与清除" | 🔴 red |
| specs/dsh-magpie/spec.md → DSH 侧默认 effort | 拒绝非法档位 | packages/dsh-magpie/test/default-effort.test.ts | spec Scenario "拒绝非法档位" | 🔴 red |
| specs/dsh-magpie/spec.md → DSH 侧默认 effort | 档位失效时不下发，恢复后重新下发 | packages/dsh-magpie/test/default-effort.test.ts | spec Scenario "档位失效时不下发，恢复后重新下发" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 渲染卡片字段 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "渲染卡片字段" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 缺失字段不伪造 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "缺失字段不伪造" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 带错误的卡片仍显示 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "带错误的卡片仍显示" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 无权读取用量 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "无权读取用量" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 冷启动空集合 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "冷启动空集合" | 🔴 red |
| specs/dsh-magpie/spec.md → 只读用量卡片 | 卡片字符串按字面渲染 | packages/dsh-magpie/test/cards-render.test.tsx | spec Scenario "卡片字符串按字面渲染" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新单张卡片 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新单张卡片" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 冷启动时刷新全部 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "冷启动时刷新全部" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 节流期内返回旧读数 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "节流期内返回旧读数" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 非法刷新目标被拒绝 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "非法刷新目标被拒绝" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 并发刷新复用进行中的那一次 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "并发刷新复用进行中的那一次" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 旧响应晚到不覆盖新结果 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "旧响应晚到不覆盖新结果" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新进行中打开的页面得到刷新结果 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新进行中打开的页面得到刷新结果" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 单卡刷新进行中时点刷新全部 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "单卡刷新进行中时点刷新全部" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 等待中的刷新不被跟随者压过 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "等待中的刷新不被跟随者压过" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新失败后闸门释放 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新失败后闸门释放" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 受限 key 冷启动刷新全部仍为空 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "受限 key 冷启动刷新全部仍为空" | 🔴 red |
| specs/dsh-magpie/spec.md → 手动刷新用量 | 刷新失败保留原卡片 | packages/dsh-magpie/test/cards-refresh.test.ts | spec Scenario "刷新失败保留原卡片" | 🔴 red |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 快速模式请求带 priority（两种协议） | packages/dsh-magpie/test/speed.test.tsx | spec Scenario "快速模式请求带 priority（两种协议）" | 🔴 red |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 标准模式与其它会话不带字段 | packages/dsh-magpie/test/speed.test.tsx | spec Scenario "标准模式与其它会话不带字段" | 🔴 red |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 不支持的模型不显示且不带字段 | packages/dsh-magpie/test/speed.test.tsx | spec Scenario "不支持的模型不显示且不带字段" | 🔴 red |
| specs/dsh-magpie/spec.md → Codex 速度切换 | host 重启后回到标准 | packages/dsh-magpie/test/speed.test.tsx | spec Scenario "host 重启后回到标准" | 🔴 red |
| specs/dsh-magpie/spec.md → Codex 速度切换 | 非法 tier 被拒绝 | packages/dsh-magpie/test/speed.test.tsx | spec Scenario "非法 tier 被拒绝" | 🔴 red |
| specs/dsh-magpie/spec.md → 禁用不删除用户数据 | dispose 不删除数据 | packages/dsh-magpie/test/dispose.test.ts | spec Scenario "dispose 不删除数据" | 🔴 red |
| specs/dsh-magpie/spec.md → 禁用不删除用户数据 | dispose 时有进行中的请求 | packages/dsh-magpie/test/dispose.test.ts | spec Scenario "dispose 时有进行中的请求" | 🔴 red |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | DeepSeek/OpenAI/OpenCode 显示正确品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "DeepSeek/OpenAI/OpenCode 显示正确品牌" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Kimi/GLM/MiniMax/Pi 显示正确品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Kimi/GLM/MiniMax/Pi 显示正确品牌" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | OpenClaw/Hermes 显示正确品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "OpenClaw/Hermes 显示正确品牌" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | OpenCode 目录模型族得到品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "OpenCode 目录模型族得到品牌" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Trae route 显示 Trae 品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Trae route 显示 Trae 品牌" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | TraeX 目录模型族得到品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "TraeX 目录模型族得到品牌" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | OpenCode route 不被模型名误判 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "OpenCode route 不被模型名误判" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 未知兼容 route 使用 model fallback | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "未知兼容 route 使用 model fallback" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Magpie route 显示 Magpie 品牌 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Magpie route 显示 Magpie 品牌" | 🔴 red |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | Magpie 只按精确名或前缀匹配 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "Magpie 只按精确名或前缀匹配" | 🟢 green (existing, regression) |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 相似但不同的 route 名不被识别 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "相似但不同的 route 名不被识别" | 🔴 red |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 网关模型 id 按上游 provider 段识别 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "网关模型 id 按上游 provider 段识别" | 🔴 red |
| specs/sidebar-session-provider-icon/spec.md → 使用下载落盘的真实品牌资产 | 上游段无法识别时退回模型名 | packages/sidebar-session-provider-icon/test/logos.test.ts | spec Scenario "上游段无法识别时退回模型名" | 🟢 green (existing, regression) |

## Coverage Notes

- **测试框架**：`packages/dsh-magpie` 用 vitest，与 `auto-model-routing`、`sidebar-session-provider-icon` 一致。测试名一律用 `spec Scenario "<场景名>"`，方便按 spec 逐条核对。
- **共享 fixture**（`packages/dsh-magpie/test/support/`）：
  - 网关 mock：本机 `http.createServer`。记录每个请求的 method、path、query、headers 和 body；可以按路径编排 JSON 或 SSE 响应、延迟、断连、307，并记录同一时刻并发的请求数。
  - credentials mock：实现 `describe/resolve/set/unset`，可设为不可写、在不发事件的情况下切换 resolve 结果，或主动发出 `credentials/reference-updated`。
  - 附件服务 mock、代理 mock（作为全局 dispatcher 记录请求）、虚拟时钟（`vi.useFakeTimers`）。
  - 卡片和模型 fixture 取自 2026-10-25 对 CT105 的只读实测，key 和账号都换成占位值，不入库任何真实凭据。
- **生成测试**走真实 pi-ai 0.87.x（不 mock pi-ai），断言实际的 wire body 和 DSH 流块。这样 pi-ai 升级时可以兼作回归测试（design D2）。
- **web 半区测试**（`*.test.tsx`）用 jsdom 渲染设置页和速度栏，断言 DOM 文本以及有没有 img、script 元素。
- **sidebar 包**：只新增 `dsh-magpie` 正向和 `dsh-magpie2` 负向两条测试，源码不改。现有场景的测试已经存在，标为 green，作为回归。如果现有测试名不带 `spec Scenario`，apply 阶段补上标题，不改断言。
- **不进 test-plan、但在 tasks 里机械验证的项**：README 治理（`npm test` 中的 repo-docs-governance）、包元数据自检（prepare、prepack、files、exports）、`npm run check:artifacts`、`node scripts/sync.mjs` 连续两次不产生变化，以及只读冒烟：对 CT105 跑一次目录同步、一次生成、一次读卡片。
