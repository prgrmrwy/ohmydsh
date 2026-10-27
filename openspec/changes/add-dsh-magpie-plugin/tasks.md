## 1. 包骨架与测试基础设施

- [x] 1.1 创建 `packages/dsh-magpie/`，参照 auto-model-routing：`package.json` 中 name 为 `dsh-magpie`、license 为 MIT，`prepare` 与 `prepack` 都执行 build，`dsh.bundle.patch`、`dsh.client`、`exports`、`files` 齐全，并设 `ohmydsh.docTier: "C"`；依赖 `@earendil-works/pi-ai@^0.87.1`、`undici`。另建 tsconfig、tsdown、vitest 配置和 `cordis.patch.yml`。验证：`npm run typecheck` 与 `npm run build` 通过，空测试套件能跑。
- [x] 1.2 先写包元数据自检测试：断言存在 prepare、prepack、files、exports、dsh.client、docTier，而且 `files` 覆盖的实际产物在 build 后存在；再造一个缺 prepare 的负例，确认测试会失败。然后补齐元数据，让测试通过。
- [x] 1.3 实现 `test/support/`：网关 mock（编排 JSON 和 SSE 响应、延迟、断连、307，记录并发数）、credentials mock、附件 mock、代理 dispatcher mock、卡片和模型 fixture（来自只读实测，全部改为占位值）。验证：给 mock 写一条自测，确认能记录 method、path、body 和最大并发。

## 2. 网关连接与凭据

- [x] 2.1 编写失败测试 `spec Scenario "保存 key 后不回显"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 2.2 编写失败测试 `spec Scenario "网关反射的 key 被脱敏"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 2.3 编写失败测试 `spec Scenario "环境提供的 key 拒绝修改"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 2.4 编写失败测试 `spec Scenario "非法设置输入被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 2.5 编写失败测试 `spec Scenario "未配置时不提供模型且不发请求"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 2.6 实现：settings 路由的地址与 key 校验、credentials 存取（`MAGPIE_API_KEY`）、key 脱敏、未配置时短路（design D6、D10），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 2.7 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 3. 连接身份与代际隔离

- [x] 3.1 编写失败测试 `spec Scenario "换地址后不显示旧目录"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 3.2 编写失败测试 `spec Scenario "换 key 后不显示旧卡片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 3.3 编写失败测试 `spec Scenario "旧代晚到的响应被丢弃"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 3.4 编写失败测试 `spec Scenario "已准备的调用按捕获值跑完"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 3.5 编写失败测试 `spec Scenario "进行中的生成不被换代中止"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 3.6 编写失败测试 `spec Scenario "外部改 key 触发换代"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 3.7 编写失败测试 `spec Scenario "未收到事件时新操作发现 key 变化"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 3.8 实现：Generation 代际、换代触发（自身保存、credentials 事件、操作开始时比对指纹）、bgAbort、prepareCall 捕获 origin 与 key（design D4），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 3.9 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 4. 目录同步与发布

- [x] 4.1 编写失败测试 `spec Scenario "保存地址后自动同步并发布"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 4.2 编写失败测试 `spec Scenario "同步失败保留当前代目录"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 4.3 编写失败测试 `spec Scenario "同代重复触发只发一次请求"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 4.4 编写失败测试 `spec Scenario "同步超时"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 4.5 编写失败测试 `spec Scenario "key 无效的分类"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 4.6 实现：目录同步的触发时机、15s 超时、同代共享进行中的 syncPromise、错误分类、通过注册句柄 replace 发布（design D5），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 4.7 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 5. 模型目录字段映射

- [x] 5.1 编写失败测试 `spec Scenario "字段映射"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 5.2 编写失败测试 `spec Scenario "畸形条目被丢弃"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 5.3 实现：`/models` 到 DSH 模型信息的映射（display_name、reasoning_levels、context、modalities），丢弃畸形条目，使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 5.4 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 6. 生成

- [x] 6.1 编写失败测试 `spec Scenario "两种协议的文本生成与 effort"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.2 编写失败测试 `spec Scenario "Responses 工具往返"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.3 编写失败测试 `spec Scenario "Chat 工具往返"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.4 编写失败测试 `spec Scenario "请求体与 usage 映射（两种协议）"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.5 编写失败测试 `spec Scenario "缺缓存详情、缺 total 与不一致计数"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.6 编写失败测试 `spec Scenario "未选 effort 时不写推理字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.7 编写失败测试 `spec Scenario "带 stop 的请求被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.8 编写失败测试 `spec Scenario "两种协议发送图片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.9 编写失败测试 `spec Scenario "附件读取失败"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.10 编写失败测试 `spec Scenario "流中错误事件不当成功"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.11 编写失败测试 `spec Scenario "首事件与空闲超时"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.12 编写失败测试 `spec Scenario "截断不当成功"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.13 编写失败测试 `spec Scenario "达到输出上限"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.14 编写失败测试 `spec Scenario "取消"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.15 编写失败测试 `spec Scenario "向不可收图模型发图"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 6.16 实现：pi-ai 桥接：createProvider 加两个 API 模块、按 native_endpoints 选协议、`thinkingLevelMap.off: null`、拒绝 stop、图片 data URL、mapUsage 推导 total、看门狗、终止原因映射（design D2），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 6.17 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 7. 只读与传输边界

- [x] 7.1 编写失败测试 `spec Scenario "完整流程只触达白名单"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 7.2 编写失败测试 `spec Scenario "重定向不被跟随"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 7.3 编写失败测试 `spec Scenario "存在全局代理时仍直连"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 7.4 实现：`gatewayFetch`：私有 undici Agent、`redirect: "error"`、origin 与路径白名单、Authorization 和 attribution 头，并作为 `options.fetch` 注入 pi-ai（design D3），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 7.5 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 8. 按 provider 分组的模型可见性

- [x] 8.1 编写失败测试 `spec Scenario "未设置时跟随网关"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 8.2 编写失败测试 `spec Scenario "设置后严格按白名单与目录求交集"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 8.3 编写失败测试 `spec Scenario "形状非法被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 8.4 实现：按 provider 保存的 visibleModels（不存在表示跟随，存在则为严格白名单）、只校验形状、选择器取交集（design D6），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 8.5 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 9. DSH 侧默认 effort

- [x] 9.1 编写失败测试 `spec Scenario "设置与清除"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 9.2 编写失败测试 `spec Scenario "拒绝非法档位"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 9.3 编写失败测试 `spec Scenario "档位失效时不下发，恢复后重新下发"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 9.4 实现：defaultEfforts 存储与校验，只在属于当前档位时下发 `reasoning.defaultEffort`（design D7），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 9.5 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 10. 只读用量卡片

- [x] 10.1 编写失败测试 `spec Scenario "渲染卡片字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 10.2 编写失败测试 `spec Scenario "缺失字段不伪造"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 10.3 编写失败测试 `spec Scenario "带错误的卡片仍显示"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 10.4 编写失败测试 `spec Scenario "无权读取用量"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 10.5 编写失败测试 `spec Scenario "冷启动空集合"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 10.6 编写失败测试 `spec Scenario "卡片字符串按字面渲染"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 10.7 实现：卡片投影与脱敏、按 provider 分组、窗口读数优先级、resets、空状态与受限 key 提示、文本渲染（design D8，client 设置页），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 10.8 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 11. 手动刷新用量

- [x] 11.1 编写失败测试 `spec Scenario "刷新单张卡片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.2 编写失败测试 `spec Scenario "冷启动时刷新全部"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.3 编写失败测试 `spec Scenario "节流期内返回旧读数"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.4 编写失败测试 `spec Scenario "非法刷新目标被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.5 编写失败测试 `spec Scenario "并发刷新复用进行中的那一次"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.6 编写失败测试 `spec Scenario "旧响应晚到不覆盖新结果"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.7 编写失败测试 `spec Scenario "刷新进行中打开的页面得到刷新结果"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.8 编写失败测试 `spec Scenario "单卡刷新进行中时点刷新全部"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.9 编写失败测试 `spec Scenario "等待中的刷新不被跟随者压过"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.10 编写失败测试 `spec Scenario "刷新失败后闸门释放"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.11 编写失败测试 `spec Scenario "受限 key 冷启动刷新全部仍为空"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.12 编写失败测试 `spec Scenario "刷新失败保留原卡片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 11.13 实现：cards 路由：互斥请求形状的校验、目标完全匹配、刷新闸门（覆盖目标时复用，否则串行）、GET 跟随刷新、序号在实际发送时分配（design D8），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 11.14 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 12. Codex 速度切换

- [x] 12.1 编写失败测试 `spec Scenario "快速模式请求带 priority（两种协议）"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 12.2 编写失败测试 `spec Scenario "标准模式与其它会话不带字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 12.3 编写失败测试 `spec Scenario "不支持的模型不显示且不带字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 12.4 编写失败测试 `spec Scenario "host 重启后回到标准"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 12.5 编写失败测试 `spec Scenario "非法 tier 被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 12.6 实现：按会话保存的快速集合、speed 路由、Responses 用 serviceTier、Chat 用 onPayload 写 service_tier、`conversation.input.right` 槽位组件（design D9），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 12.7 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 13. 禁用不删除用户数据

- [x] 13.1 编写失败测试 `spec Scenario "dispose 不删除数据"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 13.2 编写失败测试 `spec Scenario "dispose 时有进行中的请求"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [x] 13.3 实现：dispose：释放 route、路由、事件订阅和 Agent，中止进行中的请求，不删除 key 与设置文件（design D11），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [x] 13.4 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 14. sidebar-session-provider-icon 回归

- [x] 14.1 在 `packages/sidebar-session-provider-icon/test/logos.test.ts` 新增 `spec Scenario "Magpie route 显示 Magpie 品牌"` 中 `dsh-magpie` 的断言，以及 `spec Scenario "相似但不同的 route 名不被识别"`（`dsh-magpie2`）。按 design D1，现有 `normalizeIdentity` 应该直接通过，不改源码。如果没通过，停下来报告，不擅自修改 logos.ts。
- [x] 14.2 给 test-plan 中标为 🟢 的 sidebar 现有场景补上 `spec Scenario` 标题（不改断言），并把 `dsh-magpie` 加入「网关模型 id 按上游 provider 段识别」的断言（仅在模型名无法识别厂商时回退上游段）。为「网关小图标取模型厂商而不是上游平台」「模型名优先于上游段」「网关中转层单独识别」「上游段不是品牌时没有中转层」各补 test-plan 指定的具名回归，对 `dsh-magpie` 和 `dsh-magpie-connect` 两个 route 参数化断言，不改运行时源码；在 sidebar 包下运行 `npm test`，确认全绿。

## 15. 文档、manifest 与仓库集成

- [x] 15.1 编写 `packages/dsh-magpie/README.md` 与 `README.zh.md`：`<!-- problem -->` 段、安装与配置（地址、key，以及 Magpie 端需要局域网共享或 `MAGPIE_ADDR`，key 要有 Quotas 权限）、受限 key 冷启动说明、从 connect 迁移的步骤（旧会话需要手动切换 route）、`## Removal` 加 `<!-- section: removal -->`（手动清理 `MAGPIE_API_KEY` 和设置文件）；如有复制的代码片段，写进 THIRD-PARTY-NOTICES。
- [x] 15.2 在 `dsh.yaml` 中新增 `dsh-magpie` 条目（local，0.1.0，enabled: true；brief 不超过 80 字，note 不超过 600 码位；note 中写明信任面、出站只到配置的 baseUrl、key 存在 credentials、移除方法）；在两个 README 的 Plugins 段、`tests/repo-docs-governance.test.mjs` 的 tier 表中各加一行。验证：仓库根目录 `npm test` 通过。
- [x] 15.3 运行 `npm run check:artifacts` 并确认通过；运行 `node scripts/sync.mjs` 两次，确认第二次输出 no changes。

## 17. AMD2 — 用户确认的菜单分组与设置图标（仅本次 delta 待独立 recheck）

原规划与 AMD-1 的批准记录保留；下列增量不能借用旧 VERDICT 当作已独立评审。实施前先向 lead 报告可行性与待 review 文件列表。

- [x] 17.1 同步 proposal/design/spec/tasks/test-plan，review.md 仅追加 AMD2 pending independent recheck；读取官方 selector/目录/slot 契约，报告真实 route 与展示分组的接缝可行性。
- [x] 17.2 本轮宿主扩展已获授权，不再等待新产品确认：先在 plugin raw-owned_by 投影与 Pet compat 官方链写具名失败测试，覆盖三条 AMD2 group 场景、目录校验/detach、真实 route/model、统一搜索及 `/model`、可见性/effort，不以本包 selector 替身充数；收集各 owner 实际 RED 证据。
- [x] 17.3 先写设置自身行 marker/CSS/observer 生命周期行为测试并记录真正 RED，再用本仓 Pet/Memex 模式实现 Magpie 鸟形图标，保留第三方 notices，确认旧 connect 行不受影响。
- [x] 17.4 实跑本包 tests、typecheck/build 和 strict validate，追加真实 RED/GREEN 与未验收边界；保持 AMD2 independent recheck pending，不将全 change 标 PASS/归档，不改 lock/manifest、不部署/重启/读取真实凭据。

- [x] 17.5 Plugin catalog owner 在 `catalog.ts` 仅按 raw owned_by 输出 displayGroup，保持既有 CatalogModel.provider fallback/设置偏好键，使17.2的本包投影测试 green。
- [x] 17.6 Pet compat 唯一 owner 用受管 pinned-source patch 贯通 optional resolved-model displayGroup 校验/detach→host catalog→原选择器 buckets 和 `/model`；所有 actions 保持原 provider/model，不新增 runtime owner、不手改 generated dirs，使17.2宿主链测试 green。
- [x] 17.7 各 owner 提供 refactor 后 focused/full/typecheck、受管 isolated build/hash/provenance证据；收尾独立实跑 plugin179/Host-source25/原339/continuation161/builder5，按真实标题分层映射三个group为localgreen。owner final2 graph是测试精确断言修改前的快照；后续正式build必须重算fingerprint/重核图，本勾选不表示最终部署图新鲜。

## 18. 本轮批准的 AUTO 兼容与 actual/next effort 显示

- [x] 18.1 读取 current auto-model-routing spec:22–38、主 request 实物与作者测试，纠正旧 out-of-scope/不判档说法，新增本 change auto-model-routing delta、test ledger；保留 legacy 精确语义，AMD2 扩大范围 pending independent recheck。
- [x] 18.2 AUTO owner 先写双 Magpie transport 回归；作者报告 targeted RED 45 tests /39 pass/6 fail，失败落在新 provider 校验、目录、持久化与工具边界；不是把主 actual high/next medium 的 green 调查冒充显示 RED。
- [x] 18.3 AUTO owner 仅修改 policy-v2/policy-store/settings-host/subagent-tool 4src +5tests，保留 capabilities/effort cap/父 captured allowlist 与精确 transport/model，targeted GREEN45；不调用 selectModel、不保存全局默认、不扩大allowlist、不改legacy。
- [x] 18.4 AUTO owner refactor/final full 回归报告31 files/220 tests、typecheck全部通过；本轮仅按作者证据记录，非本会话重跑，非真实网关/部署证据。
- [x] 18.5 Pet compat owner 先写 actual/next 纯显示失败测试：同provider/model actual high与next medium在trigger/root effort行同时可见；pending/check/提交仍next，新手选不被抹除，MANUAL请求不变，不触发selectModel/defaults保存。
- [x] 18.6 同一受管host patch只让ModelDirectory透出已有lastUsed，完成18.5纯显示；不同provider/model、无lastUsed或effort相同保持普通展示，禁止改写projection/current作为显示修复。
- [x] 18.7 宿主owner已交clean source RED24（20fail/4pass）→GREEN24、受管final2 build/hash/provenance；收尾独立source25实测并更新display ledger。新finding2为test gap直接GREEN，不声称新生产RED；正式最终fingerprint/graph仍需后续重建复核。
- [x] 18.8 对扩大后的AMD2（group/icon/AUTO compat+display）完成独立recheck；独立 [AMD2_RECHECK: APPROVE](<review.md#L555-L618>) 已明确两finding closed，仅限冻结源码/规划范围；原唯一VERDICT/CHANGES_APPLIED历史不改，不等于full verify PASS或现场验收。

## 16. 验收与收尾

- [x] 16.1 原85/158仅属baseline；本次重核99行，group3/display3有实际分层证据并更新localgreen，独立plugin29files179 tests/typecheck/build、AUTO31files222、sidebar68、Host-source25/原339/continuation161通过。99 localgreen不等于最终独立review/live GUI/最终部署图通过。
- [ ] 16.2 只读冒烟：用测试脚本（不经过 DSH 宿主）以当前 key 对 CT105 依次执行目录同步、一次短文本生成（Chat 和 Responses 各一次，不带 stop）和一次读卡片。记录 HTTP 状态和关键字段，不记录 key、账号或对话内容；不点刷新，以免访问厂商。
- [ ] 16.3 strict validate 已在本轮通过且 interim `verify.md` 已更新，但新增 group/display/recheck/live gates 未闭合；待证据齐全后重跑 `OPENSPEC_TELEMETRY=0 openspec validate add-dsh-magpie-plugin --strict` 并按 anvil verify 作最终验收，不能把 interim FAIL 当完成。
- [ ] 16.4 询问用户是否重启 DSH，并在 GUI 中验收：设置页卡片与分组、可见性、默认 effort、速度栏，以及一次真实工具回合。之后是否把 dsh-magpie-connect 和 magpie-display-name-shim 设为 `enabled: false` 由用户决定，本 change 不自动执行。

## 2026-10-25 收尾边界（UTC；证据见 verify/implementation-log）

- 17.2 已按 [独立review证据等级](<review.md#L598-L608>) reconcile：Host clean RED24=20fail/4pass 已由此前owner与独立review物理实读；plugin18 fail→18pass为作者90c5ed59…进度/最终消息回执，**author-reported，非本轮raw日志复核/独立重放**。据此勾实现TDD行为，不补造丢失历史日志，current18绿不替代先红证据。
- 18.8 据 [AMD2_RECHECK APPROVE及两finding closed](<review.md#L555-L618>) 已完成；16.3完整验收仍未闭合，旧review状态/冻结规划hash不改。
- 2.5历史无真先RED；16.2净化smoke报告仅preflight（环境key不存在，官方credentials-local初始化可能迁移写入，故0网络/0初始化/0解析）。16.4未真实GUI/工具验收。2.5、16.2、16.3、16.4保持open，115/119 complete；不宣称全objective完成。

## 2026-10-26 只读恢复（无新构建/重启/模型请求）

- 当前正式launcher d1fbbf15…ab279图的model-display、native-effects、isolated-loop probe通过；30项当前fingerprint inputs重算与published相等。五包同physical LLM。证明的是当前编译图与source-input新鲜度，不是丢失deployment584 receipt、clean upstream source、网络Remote或GUI E2E。
- 现成Playwright1.64/Chrome可启动；新incognito仅GET既有3080得401，未读HTTPbody/DOM/boot/cookies，不能勾GUI。官方CLI的token URL仅在新boot首次宣布；未发现安全attach/reprint既有server入口，未执行会boot的命令。
- Responses optional-tools strict兼容由另一GPT owner调查，当前无本收尾验证结果；等待parent独立review后统一部署。本轮不import该plugin lib、不碰其源码/test/build。后续GPT tool实测须用既有initialized宿主和独立临时session，不写全局defaults、不读key、不用旧会话或本机Claude/codex代替。

## 19. AMD3 — 用户新授权的官方同步与单值 effort

旧119条及已勾选历史不改；原18.3/18.5/18.6的no-select/双值要求由本组明确废止，不当作当前待实现目标。仍保留原4个未完成项。

- [x] 19.1 先修订现有规划，废止禁止 selectModel/global-default 与 actual/next 需求；追加有界 review pending/test ledger，不伪造旧审批。
- [x] 19.2 先跑真实 AgentLoop/controller 主请求与官方选择/defaults同 effort、失败告警、无额外 child/MANUAL 写入的 RED；选择器单值 RED，保留分组/search/真实identity回归。
- [x] 19.3 最小接通 policy-v2 主请求官方同路由 effort 同步；删 actual/next 独有 patch/tests/helper，更新 pin/verifier及双方双语README，不增加配置、不改adapter/传输。
- [x] 19.4 实跑 focused/full AUTO、typecheck/build、隔离 pinned Host-source dedicated suite、patch apply check、governance/whitespace/strict；记录source SHA和实际RED/GREEN及未验收边界，不启动fullgraph/restart/sync/deploy。
- [ ] 19.5 parent 独立复核 AMD3 源码/规划及正式图 freshness、GUI验收：parent 源码/构建复核已 APPROVE；最终正式图验证、production sync×2（第二次no changes）完成；只剩用户重启后的GUI验收，不能将该整项或full change标PASS。

AMD3 local snapshot：119/124 complete（旧115/119历史保留；新增19.1–19.4完成，19.5独立复核/正式图/GUI仍pending），不是0pending或全目标PASS。

## 20. AMD4 — 用户 2026-10-27 授权的体验与重试修订

用户要求：删除整体刷新用量栏目；用量条 ≤70 蓝、71–89 橙、≥90 红；参照 dsh-plugin-subscriptions 做失败重试（超时对齐其“任何数据续期、300s 空闲”）；连接默认只要地址与 key，「高级连接」默认展开、接入方式仅「直连 / Cloudflare Access」，README 欢迎 issue/PR。无卡片时在连接面板给「获取模型与用量」。

- [x] 20.1 修订 spec（生成超时、失败分类与重试新 requirement、用量卡片/手动刷新、连接接入方式）与 design D2 超时条款。
- [x] 20.2 adapter：`providerRetryPolicy`、标准错误码分类、300s 任意数据看门狗、删除建连 429/5xx 内部重发、空回复 `EMPTY_RESPONSE`；改写 timeout/retry/generate 测试。
- [x] 20.3 client：删除用量栏目与「刷新全部」，连接面板空状态与「获取模型与用量」，单卡提示归入分组，三档用量条，高级连接接入方式；改写 cards-render/access-ui 测试。
- [x] 20.4 双语 README：重试/超时、用量刷新与颜色、连接方式（含 Tailscale 属直连、Cloudflare 524 提醒、欢迎 issue/PR）。
- [x] 20.5 本包 test（34 files / 248 tests）、typecheck、build 通过；本地 worktree 需 `--fsModuleCachePath` 指向可写目录。
- [ ] 20.6 部署后 GUI 验收：设置页布局、Cloudflare Access 切换、真实长推理请求不再 90s 超时、断网/5xx 时 DSH 显示重试。
