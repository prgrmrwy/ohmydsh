## 1. 包骨架与测试基础设施

- [ ] 1.1 创建 `packages/dsh-magpie/`，参照 auto-model-routing：`package.json` 中 name 为 `dsh-magpie`、license 为 MIT，`prepare` 与 `prepack` 都执行 build，`dsh.bundle.patch`、`dsh.client`、`exports`、`files` 齐全，并设 `ohmydsh.docTier: "C"`；依赖 `@earendil-works/pi-ai@^0.87.1`、`undici`。另建 tsconfig、tsdown、vitest 配置和 `cordis.patch.yml`。验证：`npm run typecheck` 与 `npm run build` 通过，空测试套件能跑。
- [ ] 1.2 先写包元数据自检测试：断言存在 prepare、prepack、files、exports、dsh.client、docTier，而且 `files` 覆盖的实际产物在 build 后存在；再造一个缺 prepare 的负例，确认测试会失败。然后补齐元数据，让测试通过。
- [ ] 1.3 实现 `test/support/`：网关 mock（编排 JSON 和 SSE 响应、延迟、断连、307，记录并发数）、credentials mock、附件 mock、代理 dispatcher mock、卡片和模型 fixture（来自只读实测，全部改为占位值）。验证：给 mock 写一条自测，确认能记录 method、path、body 和最大并发。

## 2. 网关连接与凭据

- [ ] 2.1 编写失败测试 `spec Scenario "保存 key 后不回显"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 2.2 编写失败测试 `spec Scenario "网关反射的 key 被脱敏"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 2.3 编写失败测试 `spec Scenario "环境提供的 key 拒绝修改"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 2.4 编写失败测试 `spec Scenario "非法设置输入被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 2.5 编写失败测试 `spec Scenario "未配置时不提供模型且不发请求"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 2.6 实现：settings 路由的地址与 key 校验、credentials 存取（`MAGPIE_API_KEY`）、key 脱敏、未配置时短路（design D6、D10），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 2.7 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 3. 连接身份与代际隔离

- [ ] 3.1 编写失败测试 `spec Scenario "换地址后不显示旧目录"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 3.2 编写失败测试 `spec Scenario "换 key 后不显示旧卡片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 3.3 编写失败测试 `spec Scenario "旧代晚到的响应被丢弃"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 3.4 编写失败测试 `spec Scenario "已准备的调用按捕获值跑完"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 3.5 编写失败测试 `spec Scenario "进行中的生成不被换代中止"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 3.6 编写失败测试 `spec Scenario "外部改 key 触发换代"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 3.7 编写失败测试 `spec Scenario "未收到事件时新操作发现 key 变化"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 3.8 实现：Generation 代际、换代触发（自身保存、credentials 事件、操作开始时比对指纹）、bgAbort、prepareCall 捕获 origin 与 key（design D4），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 3.9 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 4. 目录同步与发布

- [ ] 4.1 编写失败测试 `spec Scenario "保存地址后自动同步并发布"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 4.2 编写失败测试 `spec Scenario "同步失败保留当前代目录"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 4.3 编写失败测试 `spec Scenario "同代重复触发只发一次请求"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 4.4 编写失败测试 `spec Scenario "同步超时"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 4.5 编写失败测试 `spec Scenario "key 无效的分类"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 4.6 实现：目录同步的触发时机、15s 超时、同代共享进行中的 syncPromise、错误分类、通过注册句柄 replace 发布（design D5），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 4.7 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 5. 模型目录字段映射

- [ ] 5.1 编写失败测试 `spec Scenario "字段映射"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 5.2 编写失败测试 `spec Scenario "畸形条目被丢弃"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 5.3 实现：`/models` 到 DSH 模型信息的映射（display_name、reasoning_levels、context、modalities），丢弃畸形条目，使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 5.4 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 6. 生成

- [ ] 6.1 编写失败测试 `spec Scenario "两种协议的文本生成与 effort"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.2 编写失败测试 `spec Scenario "Responses 工具往返"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.3 编写失败测试 `spec Scenario "Chat 工具往返"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.4 编写失败测试 `spec Scenario "请求体与 usage 映射（两种协议）"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.5 编写失败测试 `spec Scenario "缺缓存详情、缺 total 与不一致计数"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.6 编写失败测试 `spec Scenario "未选 effort 时不写推理字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.7 编写失败测试 `spec Scenario "带 stop 的请求被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.8 编写失败测试 `spec Scenario "两种协议发送图片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.9 编写失败测试 `spec Scenario "附件读取失败"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.10 编写失败测试 `spec Scenario "流中错误事件不当成功"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.11 编写失败测试 `spec Scenario "首事件与空闲超时"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.12 编写失败测试 `spec Scenario "截断不当成功"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.13 编写失败测试 `spec Scenario "达到输出上限"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.14 编写失败测试 `spec Scenario "取消"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.15 编写失败测试 `spec Scenario "向不可收图模型发图"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 6.16 实现：pi-ai 桥接：createProvider 加两个 API 模块、按 native_endpoints 选协议、`thinkingLevelMap.off: null`、拒绝 stop、图片 data URL、mapUsage 推导 total、看门狗、终止原因映射（design D2），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 6.17 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 7. 只读与传输边界

- [ ] 7.1 编写失败测试 `spec Scenario "完整流程只触达白名单"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 7.2 编写失败测试 `spec Scenario "重定向不被跟随"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 7.3 编写失败测试 `spec Scenario "存在全局代理时仍直连"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 7.4 实现：`gatewayFetch`：私有 undici Agent、`redirect: "error"`、origin 与路径白名单、Authorization 和 attribution 头，并作为 `options.fetch` 注入 pi-ai（design D3），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 7.5 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 8. 按 provider 分组的模型可见性

- [ ] 8.1 编写失败测试 `spec Scenario "未设置时跟随网关"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 8.2 编写失败测试 `spec Scenario "设置后严格按白名单与目录求交集"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 8.3 编写失败测试 `spec Scenario "形状非法被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 8.4 实现：按 provider 保存的 visibleModels（不存在表示跟随，存在则为严格白名单）、只校验形状、选择器取交集（design D6），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 8.5 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 9. DSH 侧默认 effort

- [ ] 9.1 编写失败测试 `spec Scenario "设置与清除"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 9.2 编写失败测试 `spec Scenario "拒绝非法档位"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 9.3 编写失败测试 `spec Scenario "档位失效时不下发，恢复后重新下发"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 9.4 实现：defaultEfforts 存储与校验，只在属于当前档位时下发 `reasoning.defaultEffort`（design D7），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 9.5 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 10. 只读用量卡片

- [ ] 10.1 编写失败测试 `spec Scenario "渲染卡片字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 10.2 编写失败测试 `spec Scenario "缺失字段不伪造"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 10.3 编写失败测试 `spec Scenario "带错误的卡片仍显示"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 10.4 编写失败测试 `spec Scenario "无权读取用量"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 10.5 编写失败测试 `spec Scenario "冷启动空集合"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 10.6 编写失败测试 `spec Scenario "卡片字符串按字面渲染"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 10.7 实现：卡片投影与脱敏、按 provider 分组、窗口读数优先级、resets、空状态与受限 key 提示、文本渲染（design D8，client 设置页），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 10.8 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 11. 手动刷新用量

- [ ] 11.1 编写失败测试 `spec Scenario "刷新单张卡片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.2 编写失败测试 `spec Scenario "冷启动时刷新全部"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.3 编写失败测试 `spec Scenario "节流期内返回旧读数"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.4 编写失败测试 `spec Scenario "非法刷新目标被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.5 编写失败测试 `spec Scenario "并发刷新复用进行中的那一次"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.6 编写失败测试 `spec Scenario "旧响应晚到不覆盖新结果"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.7 编写失败测试 `spec Scenario "刷新进行中打开的页面得到刷新结果"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.8 编写失败测试 `spec Scenario "单卡刷新进行中时点刷新全部"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.9 编写失败测试 `spec Scenario "等待中的刷新不被跟随者压过"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.10 编写失败测试 `spec Scenario "刷新失败后闸门释放"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.11 编写失败测试 `spec Scenario "受限 key 冷启动刷新全部仍为空"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.12 编写失败测试 `spec Scenario "刷新失败保留原卡片"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 11.13 实现：cards 路由：互斥请求形状的校验、目标完全匹配、刷新闸门（覆盖目标时复用，否则串行）、GET 跟随刷新、序号在实际发送时分配（design D8），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 11.14 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 12. Codex 速度切换

- [ ] 12.1 编写失败测试 `spec Scenario "快速模式请求带 priority（两种协议）"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 12.2 编写失败测试 `spec Scenario "标准模式与其它会话不带字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 12.3 编写失败测试 `spec Scenario "不支持的模型不显示且不带字段"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 12.4 编写失败测试 `spec Scenario "host 重启后回到标准"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 12.5 编写失败测试 `spec Scenario "非法 tier 被拒绝"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 12.6 实现：按会话保存的快速集合、speed 路由、Responses 用 serviceTier、Chat 用 onPayload 写 service_tier、`conversation.input.right` 槽位组件（design D9），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 12.7 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 13. 禁用不删除用户数据

- [ ] 13.1 编写失败测试 `spec Scenario "dispose 不删除数据"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 13.2 编写失败测试 `spec Scenario "dispose 时有进行中的请求"`（test-plan 对应行），确认失败原因是功能尚未实现，而不是 fixture 写错
- [ ] 13.3 实现：dispose：释放 route、路由、事件订阅和 Agent，中止进行中的请求，不删除 key 与设置文件（design D11），使本组全部测试通过；test-plan 中对应行从 🔴 改为 🟢
- [ ] 13.4 重构；`npm test` 在 `packages/dsh-magpie` 下保持全绿

## 14. sidebar-session-provider-icon 回归

- [ ] 14.1 在 `packages/sidebar-session-provider-icon/test/logos.test.ts` 新增 `spec Scenario "Magpie route 显示 Magpie 品牌"` 中 `dsh-magpie` 的断言，以及 `spec Scenario "相似但不同的 route 名不被识别"`（`dsh-magpie2`）。按 design D1，现有 `normalizeIdentity` 应该直接通过，不改源码。如果没通过，停下来报告，不擅自修改 logos.ts。
- [ ] 14.2 给 test-plan 中标为 🟢 的 sidebar 现有场景补上 `spec Scenario` 标题（不改断言），并把 `dsh-magpie` 加入「网关模型 id 按上游 provider 段识别」的断言；在 sidebar 包下运行 `npm test`，确认全绿。

## 15. 文档、manifest 与仓库集成

- [ ] 15.1 编写 `packages/dsh-magpie/README.md` 与 `README.zh.md`：`<!-- problem -->` 段、安装与配置（地址、key，以及 Magpie 端需要局域网共享或 `MAGPIE_ADDR`，key 要有 Quotas 权限）、受限 key 冷启动说明、从 connect 迁移的步骤（旧会话需要手动切换 route）、`## Removal` 加 `<!-- section: removal -->`（手动清理 `MAGPIE_API_KEY` 和设置文件）；如有复制的代码片段，写进 THIRD-PARTY-NOTICES。
- [ ] 15.2 在 `dsh.yaml` 中新增 `dsh-magpie` 条目（local，0.1.0，enabled: true；brief 不超过 80 字，note 不超过 600 码位；note 中写明信任面、出站只到配置的 baseUrl、key 存在 credentials、移除方法）；在两个 README 的 Plugins 段、`tests/repo-docs-governance.test.mjs` 的 tier 表中各加一行。验证：仓库根目录 `npm test` 通过。
- [ ] 15.3 运行 `npm run check:artifacts` 并确认通过；运行 `node scripts/sync.mjs` 两次，确认第二次输出 no changes。

## 16. 验收与收尾

- [ ] 16.1 确认 test-plan.md 每一行都是 🟢；在 `packages/dsh-magpie` 下运行 `npm test`、`npm run typecheck`、`npm run build`，确认全部通过，并记录实际输出摘要。
- [ ] 16.2 只读冒烟：用测试脚本（不经过 DSH 宿主）以当前 key 对 CT105 依次执行目录同步、一次短文本生成（Chat 和 Responses 各一次，不带 stop）和一次读卡片。记录 HTTP 状态和关键字段，不记录 key、账号或对话内容；不点刷新，以免访问厂商。
- [ ] 16.3 运行 `OPENSPEC_TELEMETRY=0 openspec validate add-dsh-magpie-plugin --strict`，确认通过；按 anvil 的 verify 指令生成 `verify.md`。
- [ ] 16.4 询问用户是否重启 DSH，并在 GUI 中验收：设置页卡片与分组、可见性、默认 effort、速度栏，以及一次真实工具回合。之后是否把 dsh-magpie-connect 和 magpie-display-name-shim 设为 `enabled: false` 由用户决定，本 change 不自动执行。
