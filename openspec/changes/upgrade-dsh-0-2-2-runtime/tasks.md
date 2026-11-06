<!-- 每组的 TDD 三步都针对 test-plan.md 中该组列出的场景行；每个场景行转绿时同步更新 test-plan.md。 -->

## 1. 基线（现役 0.2.1-rc.5）

- [ ] 1.1 在现役运行体上跑 `npm test`、`npm run check:artifacts` 和各 local package 的 build/typecheck/test，结果记入 `checking/summary.md`
- [ ] 1.2 列出没有自动化覆盖的人工验收项及步骤，并记录它们在现役上的结果：AUTO 主/子路由（含状态面板）、Pet Locus 子任务回传、memex 召回/写卡/eval 自检、Automation 任务列表、btw、better-sidebar 各 tab、cockpit-bridge 上报、四个商店包的可见功能

## 2. pin、依赖与 Node（D7）

- [x] 2.1 `ws promote`；用 `scripts/check-update.mjs --rewrite-to 0.2.2-rc.1` 改写 `dshVersion` 与 skill-filesystem、mcp-client provider pin 及 integrity
- [x] 2.2 local package 的 `@deepseek-ai/dsh-*` devDependencies 改为 `^0.2.2-rc.1`，peer 尾段改为 `|| ^0.2.2-rc.1`；`npm install` 更新根 lockfile，确认运行体包单实例 hoist、无缺失 peer
- [x] 2.3 编写失败测试：bootstrap 工具链检查在 Node 24.8 时拒绝、在 24.9 时通过（断言当前 `>=22.0.0` 下测试失败）
- [x] 2.4 实现：根 `package.json` 的 `engines.node` 改为 `>=24.9.0`，使 2.3 通过
- [ ] 2.5 重构；`tests/local-package-peers.test.mjs` 与全量测试通过（auto-model-routing 的下界在 3.x 中调整）

## 3. AUTO 主会话：pre-step 中设定本步 effort（D1）

- [ ] 3.1 编写失败测试：`runtime-selection.e2e.test.ts` 中「本步选择改写依赖运行体核验」三个场景，使用 `dshVersion` 精确版本的真实 agent loop（确认在现有实现下因 `agent/request` 改写抛错而失败）
- [ ] 3.2 编写失败测试：test-plan 中「AUTO 主 effort 同步官方选择」「模式与改写规则」「决策提示」各行，以及「用户回合与 Jev 输入」中的主会话行（调整 `policy-host.integration.test.ts:401-409` 等旧时序断言）
- [ ] 3.3 实现：主会话 `agent/pre-step` 每一步按 depth、`modelSelection` 的模型和实时 cap 计算 effort；不同时先 await 官方 `selectModel`，再改写 `payload.modelSelection.reasoningEffort`；赋值抛错时捕获、告警并退回下一步生效；删除主会话的 `agent/request` 改写，使 3.1、3.2 通过
- [ ] 3.4 重构；包内全量测试通过

## 4. AUTO 子会话：created 中判断并写入 route，request 只核验（D2）

- [ ] 4.1 编写失败测试：test-plan 中「AUTO 决策与执行」「子任务路由退化链」各行，以及「用户回合与 Jev 输入」的子会话行、「Jev 判断请求与脱敏」「判档预设的采样与归属」中涉及子任务时机的行；created/resume/取消/重试/参数校验失败场景使用真实 loop + subagent 链路夹具
- [ ] 4.2 实现：`tools/execute` 绑定窗口记下 `args.prompt`；`agent/created`（startup）绑定后用该事件的 signal await Jev，按退化链得出 route 并同步 `agent.model.select(route)`；取消时记 `unsupported/jev-cancelled`；`agent/created`（resume）对合法已有 route 且 `current()` 不一致的子会话同步补写 route；`agent/request` 只做核验并返回 `await next()`，保留全部 fail closed 检查；使 4.1 通过
- [ ] 4.3 重构；同时断言目标运行体在重试时仍派发 `agent/request`；包内全量测试通过

## 5. auto-model-routing 兼容声明与文档（D3）

- [ ] 5.1 编写失败测试：`tests/local-package-peers.test.mjs` 断言 auto-model-routing 的 `engines.dsh` 与 dsh peer 下界为 `0.2.2-rc.1`，其它 local package 保持 `0.2.0-rc.2`
- [ ] 5.2 实现：改写该包的 `engines.dsh`、peer；README/CHANGELOG 写明版本线（0.2.0–0.2.1 用已发布的 0.7.x/0.6.x，0.2.2 起用新的 minor，版本号发版时确定，不复用 0.7.0）与抬下界的理由
- [ ] 5.3 重构；全量测试通过；`docs/` 中描述 `agent/request` 改写的内容与 policy-v2 说明同步更新

## 6. memex 裁判工具投影（D4）

- [ ] 6.1 编写失败测试：`eval-judge-runtime.test.ts` 在目标运行体上启用 Team 时裁判成功路径（现有 `assembly.tools.filter` 抛 TypeError 而失败），并保留污染注入时首请求零调用断言
- [ ] 6.2 实现：删除 `judge-boundary.ts:22-25` 的 `system-prompt/assemble` 监听，使 6.1 通过
- [ ] 6.3 重构；dsh-memex 全量测试通过；成功路径不通过时停在未通过，不以全部拒绝或全部 unknown 收尾

## 7. 文件观察策略（D5）

- [ ] 7.1 编写失败测试：`tests/fs-observation-policy.test.mjs`（「启用后有效配置含策略行且未禁用」「禁用后恢复官方默认」）与 `tests/fs-observation-policy-runtime.test.mjs`（「未读先改被拒绝」「读后被外部修改再编辑被拒绝」）
- [ ] 7.2 实现：新增 `patches/fs-observation-policy.yml`（整行覆盖 `disabled: false`）与 manifest `type: patch` 条目，note 写明升级复核要重跑 `--dump-config`，使 7.1 通过
- [ ] 7.3 重构；sync 连续两次第二次无变更

## 8. 其余逐项复核（D6、D8）

- [x] 8.1 `dsh.yaml` 写明 Web Fetch 可访问非公网地址的信任面变化（2026-11-06 由用户接受）
- [ ] 8.2 dsh-pet：核对按步骤启用工具后 `ctx.tools.schemas(scope)` 的读回结果，Locus 工具上限等价性测试在目标运行体上通过
- [ ] 8.3 sidebar-session-provider-icon：`sessionProjections.register` 改为在启动时持有其异步返回值，测试通过
- [ ] 8.4 检查官方 connection 行的 `inject` 是否已含 `webServer`：已含则删除 fragment 与 patch，否则在 note 记录复核结论
- [ ] 8.5 按 0.2.2-rc.1 重新生成 noPet 官方模块名册
- [ ] 8.6 全仓 `npm test`、`npm run check:artifacts` 与各 local package 的 build/typecheck/test 通过；结论写入 `checking/summary.md`

## 9. 隔离候选验收

- [ ] 9.1 `dsh build` → `ws prepare-preview` → `dsh`，按分组（裸运行体 → local package → remote 插件）组合，记录启动清单、loader 结果与基线差异；观察策略重跑 `--dump-config`
- [ ] 9.2 复跑 1.2 的人工项；重点看 AUTO 主会话 step 1 请求头 effort、带图首消息的 fresh 子任务、状态面板，以及 Locus 子会话写文件受观察策略约束
- [ ] 9.3 按精确 commit 在 devbox 跑清洁构建 gate，结果写入 `checking/summary.md`

## 10. 备份与恢复演练（生产切换准入）

- [ ] 10.1 由用户执行 `dsh stop` 并确认没有残留 Host 进程；按目标运行体 `--dump-config` 得出数据根并离线复制（sessions、attachments、Pet SQLite、profiles/web、state、storages），生成 sha256 清单，路径写入本 task
- [ ] 10.2 在隔离 `DSH_HOME` 中用副本以 0.2.2 打开、继续写入、重启，按 runtime-api-migration `:96-107` 逐项断言；停止全部写入方，恢复快照，以 0.2.1 启动并按同一组断言读回；结果写入 `checking/summary.md`

## 11. 上游反馈（D9）

- [ ] 11.1 重新搜索 deepseek-harness discussions（上游已关闭 issues），选定已有热度的相关帖（当前首选 #7179），找不到时才准备在 Ideas 新建
- [ ] 11.2 起草留言：插件需要在本步选择固定前可等待地设定模型/effort（或把 pre-step 的 `modelSelection` 正式定为可写），以及 `agent/request` 弃用后缺少逐次请求核验点；不含本机路径、会话数据或凭据
- [ ] 11.3 经用户确认后发布，链接与后续回应记入 `checking/summary.md`；上游回应不阻断合入

## 12. 切换与收尾（需用户批准）

- [ ] 12.1 把 `checking/` 中的结论汇总进会被版本控制的 `checking/summary.md`，提交并经用户批准合入
- [ ] 12.2 从主 checkout 执行 `dsh build`，连续第二次无变更；由用户决定启动或重启，之后用 `dsh history` 核验，刷新 3080 完成验收
- [ ] 12.3 提示用户：商店上的 AUTO 0.7.0 在 0.2.2 Host 上不可用，需另走 publish 流程发布新的 minor
- [ ] 12.4 `openspec validate upgrade-dsh-0-2-2-runtime --strict`，同步 delta 到 current specs；更新记忆卡 `dsh-022-upgrade-blockers-agent-request-and-prompt-tools`；归档 change
