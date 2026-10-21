## Verification Results

### Task Completion
- [ ] All tasks marked `[x]` in tasks.md
- Remaining open tasks: **8.4**（现有 GUI 启用验收与一次真实子会话委派）——须用户授权启用插件与 skill 后执行，按设计不另起服务器代替。其余 26/27 已完成。8.5 本身即本文件与严格校验。

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test（43 行，测试名均在 `packages/auto-model-routing/test/` 中）
- [x] Every test-plan.md row flipped to 🟢 green（43/43，0 行 🔴）
- [x] Full suite passes
- [x] Zero skipped/pending/commented-out tests（package 内）
- [x] No test weakened or deleted without REMOVED requirement：首版 `classifier.test.ts`、`skill_tier_table`/`skill_provider_family`/`skill_required_guidance`、`unsupported_and_unclassified_passthrough` 随“本地规则分类器”需求与 skill 档位表需求被整体替换而删除；替代需求均有新测试。
- 新红：content/effort(子会话表)/jev/state(disabled)/router(fail)/host(7 条)/subagent-tool/skill/client(停用显示) 均先观察到预期失败。沿用行为（input、state 锚点、映射、端点、部分 client、selection 三条）首次即绿，已在 test-plan Coverage Notes 如实记录；selection 三条与 `rejected_step_skips_jev` 以定向变异确认能捕获回归（详见 test-plan）。
- 实施中一处 fixture 修正：`main_and_tool_share_questions` 首版用相同任务文本致 `state` 相同；改为不同任务文本，断言未改，非弱化。

### Evidence

- Final full-suite command（package）：`npm --prefix packages/auto-model-routing test` → **11 files, 63 passed, 0 failed, 0 skipped**（续作修复后重新运行）
- `npm --prefix packages/auto-model-routing run typecheck`（源码 + 全部测试严格类型）→ 通过
- `npm --prefix packages/auto-model-routing run build` → Host tsc 与 client bundle 通过；client bundle 不含 `openrouter`/`JevClient`（仅提示文本常量）
- Root：`npm test` → **427 tests, 425 pass, 0 fail, 2 skipped**（2 条为既有真实 MCP bridge 环境测试，与本 change 无关）
- `npm run check:artifacts` → 通过
- 隔离 sync：`DSH_LOCAL_MANIFEST=/nonexistent/... node --test tests/auto-model-routing-sync.test.mjs` → 1 pass；真实 sync.mjs、临时 repo/DSH_HOME，Host/client 与 skill 同批物化，第二次 no changes（安装 CLI 为测试替身）
- `openspec validate auto-model-routing --strict` → valid
- **真实 OpenRouter 冒烟（8.3，计费约 $0.0002）**：以构建后的 `lib/jev.js` 与最终 `TIER_QUESTIONS` 重跑 spike 10 条样本 → **10/10 与预期一致，p50 0.53s，最大 1.14s**；与 spike（10/10, p50 0.81s）一致，无需回到规划。
- Non-executable checks：none

证据边界：自动化测试中 Jev 为本地回环假服务；402 等失败类别按状态码与 `{error:{code}}` 映射测试，**真实余额耗尽时 OpenRouter 的返回未能触发验证**。Host 端点认证由 DSH connection 提供，测试替身只验证注册与业务调用。client 为注册与静态渲染检查，非浏览器交互验收。

### Review Integrity
- [x] review.md：Round 6 `VERDICT: APPROVE_WITH_CHANGES`，定点复核 `CHANGES_APPLIED: yes`
- [x] Verdict not stale：复核后仅改动 n1–n5 措辞（复核意见本身要求，已在 review.md 记录作者回应），proposal/design/spec 之后未再修改
- [x] All findings fixed（M1–M7、m1–m7、n1–n5 均已落实；无 Critical）

### Change Delivery

- 规划提交：`2ef1d01`、`7d58df4`、`026595f`、`33dfe99`
- 实现提交：`34d447d..3b5b1cf`（7 个提交，任务分支 `ws/personal-typesafe-ai-jev`）
- 未合入、未归档、未部署；`dsh.yaml` 中插件与 skill 均 `enabled: false`；现有 GUI 与实时 DSH_HOME 未修改。

### 续作复核（2026-10-20，用户明确不考虑 Magpie）

- 修正原验收遗漏：旧客户端先完整读取正文，再检查字符串长度，**并未落实 64 KiB 流式字节限制**；此前 58 条通过不能证明此边界。重开任务 3.2/3.3，补三条新红测试后修复共享客户端；未修改 proposal/design/spec 或判档策略。
- `response_limit_counts_utf8_bytes`：恰好 65536 字节成功，65537 字节（JS 字符串长度仍小于 65536）拒绝。
- `oversized_stream_is_cancelled_before_eof`：80 KB 不结束的流立即按 `invalid-response` 拒绝并关闭，不等到 timeout。
- `http_error_is_classified_without_waiting_for_body`：402 正文不结束仍按 `insufficient-credits` 返回，取消正文且只请求一次。
- `response_stream_respects_abort` caller/deadline 两条首次即绿保障，核验读正文期间取消/超时类别不变、连接关闭；不是声称新红。
- package 全套新跑 **63/63**，typecheck/build 通过；root 新跑 **425 pass / 0 fail / 2 skip**；artifact、隔离双 sync、严格 OpenSpec 校验、diff check 均通过。构建仍有既有 tsdown external 弃用与 CJS 格式建议警告，不阻塞构建。
- fresh-context 只读子代理独立审查最终源码与测试，并运行 Jev 用例 **9/9**，结论无阻塞项。子代理未做外网或部署；完整 Host 集成由主代理全套运行覆盖。
- 未重跑计费的真实 OpenRouter 冒烟：本次只改响应读取，问题文本、URL 与请求体未变；上述 10/10 仍是先前轮次证据，不冒充本次结果。
- 补勾 8.5（此前报告写完成而 task 未勾）；当前 **26/27**，只有 8.4 待明确授权。未部署、未改启用开关、未合入、未归档。

### 修复版真实冒烟（2026-10-20 20:30，Asia/Shanghai）

用户明确授权“补一轮冒烟”。从当前源码重新构建，经正式 `lib/jev.js` 调用 OpenRouter；不替换 fetch、不重试、不查询余额，凭据仅从既有本机环境注入，未打印。源码修复提交 `c193b68`。

| 样本 | 预期 / 实际 | 耗时 |
|---|---|---|
| 变量 foo 改 userCount | simple / simple | 1.020s |
| 解释 rebase 与 merge | simple / simple | 0.527s |
| Cannot find module react | simple / simple | 0.578s |
| 登录页复选框与单测 | standard / standard | 0.588s |
| 最后一页分页空白 | standard / standard | 0.549s |
| 函数支持超时参数 | standard / standard | 0.512s |
| 跨模块排查与实现测试方案 | complex / complex | 0.528s |
| 持久化读写拆分、向后兼容 | complex / complex | 0.552s |
| MySQL → Postgres 不停机迁移 | escalated / escalated | 0.493s |
| 认证权限绕过审查与修复 | escalated / escalated | 0.551s |

- 判档 **10/10**；p50（中间两项平均）**0.550s**，最大 **1.020s**，均在正式 3 秒期限内。
- 额外走正式 `routeSubagentTool.execute`，任务为同一跨模块排查样本：Claude 返回 `{complex, claude, claude-opus-5-5, xhigh}`（0.497s）；Codex 返回 `{complex, codex, gpt-6.1-sol, xhigh}`（0.695s）。均是工具选配置冒烟，**没有创建实际子会话**，不算 8.4 完成。
- 共 **12 次真实调用**。客户端故意不暴露 usage/cost，本轮未实测账单；按前次单价/用量估算约 $0.0002–0.0003，不能当作实际扣款。未主动查余额。
- 未启用插件/skill、未部署、未重启现有 GUI、未执行 GUI 验收；8.4 仍待授权。

### GUI 验收执行口径（计划，尚未执行）

1. **前置**：明确授权部署后，仅打开本 change 对应插件和 skill 两个 manifest 开关，用受控流程构建/物化并重载 Host，刷新现有 `http://127.0.0.1:3080`；不另起替代服务器。Host 启动须有既有 OPENROUTER_API_KEY。新建专用测试会话，选可用的 Opus 或 Sol，手选 medium；不在当前工作会话直接试。
2. **界面与基线**：新会话默认 MANUAL；芯片在 GPT 速度芯片左侧。发一条简短问答以初始化请求；展开面板查看所选 provider/model 与 medium 锚点。允许状态轮询约 3 秒刷新。官方模型/速度控件不应被插件直接改动。
3. **AUTO**：切 AUTO，分别发送简单问答与仅分析、不修改的跨模块任务。应出现 `reason: jev`，effort 随判档映射且 provider/model 不变；Opus/Sol 对 simple/complex 的映射目标为 low/xhigh，实际以目录支持范围裁剪。工具步骤/重试不应重复判档。面板展示是自报状态，严格验收还要对照持久请求 header 或诊断记录中的实际 provider/model/effort，不能只凭模型回答推断。
4. **MANUAL 与会话隔离**：切 MANUAL 后再发请求，复原 medium；若仍显示正在复原，再发一条以观察官方配置与持久头收敛，完成后提示消失。另一新会话仍为 MANUAL，不能随测试会话切换。
5. **取消与故障**：Jev 等待期间取消，仍 AUTO 且无停用原因。真实服务通常约 0.5 秒，手速可能无法稳定命中，不把取消主模型生成当作已验证 Jev 取消。失败验收须另行受控注入（仅替换该服务测试凭据/隔离启动环境并重载），不耗尽余额、不改全局其它 provider。预期 MANUAL·Jev停用、提示类别/时间、后续不再判断；恢复有效凭据后不会自动恢复，点 AUTO 才重试。真实 402 未触发仍单独列为证据限制。
6. **真实子会话与收尾**：提示 Agent 加载配套 skill，按 route_subagent 返回参数创建一个只读子会话。核对工具调用顺序、官方创建调用的三个显式字段、description 标注、子会话实际配置；失败则停下询问，不猜档。完成后测试会话切 MANUAL 并等待复原；若撤销部署，再禁用两个开关并构建。不得直接卸载一个仍为 AUTO 的会话。

### 修订：切回 MANUAL 不复原、芯片对齐官方选择器（2026-10-21）

- 规划修订：spec/design/proposal/test-plan/tasks 第 9 组；fresh-context 独立复核 `VERDICT: APPROVE_WITH_CHANGES`，M1（有待生效手选时选择器不反映 AUTO）、M2（悬停不可 SSR 测）与 m1–m6 均已落实，范围未扩张。
- 依据：探测测试 + 正式 `dsh-api-session-controller` `selectionFor`（agent.js 约 296–343）：无待生效手选时官方沿用上一请求头 effort；有手选则在头与其相等前保持待生效。
- 红：`manual_keeps_last_auto_effort`（旧代码复原为 medium）、`pending_pick_applies_after_manual`（旧代码 medium≠low）在 HEAD 源码上失败；router/state/endpoints/host/client 新断言均先失败。绿：实现后全部通过。
- 删除：`selection-projection.ts`、锚点、`restore`/`completeRestore`、`manual-restore` 原因、`session/event` 订阅；随 REMOVED 需求删除仅验证复原/锚点的测试。旧状态文件宽松读取（忽略 `restore`/`anchor`），形状非法仍拒绝。
- package **54/54**，typecheck/build 通过；root **444 pass / 0 fail / 2 skip**；artifacts、隔离双 sync、严格校验通过。
- 悬停面板：SSR 断言结构（单按钮、文字在前图标在后、无边框、默认不渲染面板），开关为纯函数单测；真实悬停与 150ms 延迟待 GUI 复验。

### 追加：决策提示、面板去掉历史（2026-10-21）

- 新需求“决策提示（可选）”与 design D10；test-plan 新增 4 行、改写 1 行。
- 红：jev 成功结果缺 confidence/ms；host `main_decision_toast`、`subagent_decision_toast`、`toast_off_or_failure_silent` 无 `decision`；client 面板仍渲染列表、`toastText` 不存在。绿：实现后全部通过。
- 用户追加：提示同时显示四档分布（第二行，固定顺序）与胜出档 `tier → effort`；Jev 客户端保留四档 0–1 概率，置信超范围不显示。
- 独立复核 `APPROVE_WITH_CHANGES`：M1（换会话弹出旧决策）与 M2（状态变化取消隐藏定时器导致提示卡住）先以 jsdom 组件测试（仓库已有 jsdom，未新增依赖）复现为红，再修复为绿；M3 补组件层测试；M4 补 router/host 边界测试（无 effort、丢弃、取消、配置损坏、同回合重映射不重复）；m1 写入 D10；m2 子会话调用方不记录；m3 置信与分布限 0–1；m5 删除未用 `until`；m6 测试夹具不再绕过类型。m4（每次状态读取同步读配置）保留：单个小文件、每芯片 3 秒一次，代价可忽略。
- package **64/64**，typecheck/build 通过；client bundle 不含出站代码。
- **GUI 复验发现提示不可见**：线上状态接口已返回正确的 `decision`（含分布），但官方 composer 在 Agent 运行时把右侧控件容器设为 `hidden`，Jev 正在此时判档，提示随芯片一起隐藏。先加 jsdom 测试复现为红（提示位于隐藏子树内），改为 portal 到 `<body>`、`position: fixed` 定位于芯片上次可见位置后转绿。用户同时要求时长改为 3 秒。package **65/65**。

### AUTO 结果写回官方选择；提示去掉置信（2026-10-21）

- GUI 复验发现：芯片提示 `xhigh`，右侧选择器仍显示 `Medium`。线上状态确认 `lastUsed=xhigh`、待生效手选 `medium`：AUTO 改写后请求头与手选永不相等，官方从不清掉手选。用户选方案 B（design D11）：effort 改变时调用官方 `selectModel`，同时更新显示与下次请求，并接受其保存新会话默认值。
- 红：`auto_syncs_official_selection`、`selection_sync_failure_does_not_block_request`（未调用）、`auto_overrides_pending_pick`（切 MANUAL 后仍为手选 low）；提示含“置信”、未省略 0%。绿：实现后全部通过。
- 依据：官方 `[model changed]` 通知只比较 provider/model（dsh-agent `sameRoute`），只改 effort 不触发；laya 未处理该问题。
- package **68/68**，typecheck/build 通过。

## Overall Decision

DECISION: PASS_WITH_WARNINGS

离线实施、全部 43 个场景、整仓回归与真实 OpenRouter 冒烟均通过。警告：(1) 8.4 现有 GUI 与真实子会话委派验收待用户授权；(2) 真实余额耗尽的状态码未验证；(3) OpenRouter 数据保留条款未确认。
