## 1. 基线与前置

- [x] 1.1 复现并留档三处基线：首投前言被判为"续"（按 `accept → 渲染` 顺序构造夹具）、`safe` 档 child 无任何群读取工具、守卫拒绝只有裸原因码（`proposal.md` §背景与 `design.md` D1）
- [x] 1.2 核对 `pet-locus-shell-tier`（7.4 归档待办，其 task 1.2 真机读取门保持未完成）与 `pet-locus-independent-agent-inquiries` 的 delta，确认本 change 不修改其 requirement 标题，并登记归档顺序（`design.md` §不变量与约束、§收尾第 6 条）
- [x] 1.3 记录 bot 身份读取的现状基线：`+chat-messages-list` 与 `+threads-messages-list` 的 `--as bot` 在当前入口可用（`design.md` §基线第 4 条；作为能力声明实测的对照，作者自报不替代 child 沙箱内验收 → 7.5）
- [x] 1.4 规范卫生：清除 `openspec/specs/pet-lark-channel/spec.md` 中两处重复块（−46 行），`openspec validate --specs --strict` 全绿（已先执行，留痕于此）
- [x] 1.5 round 3 评审通过（`review.md`，`CHANGES_APPLIED: yes`）并生成 `test-plan.md` 后，按 anvil 顺序回填本文件每个任务对应的测试文件与测试名（见各任务行尾 `→`）

## 2. 首投前言的送达与歧义策略（D1）

- [x] 2.1 位置判据改为"该 child 是否存在**已证明送达**的投递（持久绑定已提交的 `inboxMessageId`），并排除本次渲染的这条" （`src/host/locus/context.ts` `preamblePosition`）+ `test/locus-delivery-prompt.test.ts`（`renders the full preamble with the record facts on a first delivery`）+ `test/locus-preamble-durability.test.ts`（`gives the first accepted Delivery the full preamble before any binding exists`）
- [x] 2.2 （可选）实现层对账：仅当存在**幸存的精确证据**（能精确关联到该次投递的 inbox 消息与其 turn）时用于避免重复；不得用 FIFO/正文相似/身份猜测补造证据；缺证据直接按策略 A 处理，对账 MUST NOT 阻塞投递 （本次不实现：无幸存精确证据，按策略 A 处理；见 `design.md` D2）
- [x] 2.3 不可判定（队列已接受但绑定未提交 / 绑定前进程终止）→ 视为未收到，下一次投递带完整前言；MUST NOT 暂停投递或要求重建 → `test/locus-preamble-durability.test.ts`（`keeps the full preamble while the previous Delivery never bound`）
- [x] 2.4 后续投递 prompt 增加当前档位能力声明；档位取自持久 locus 记录，渲染层不再默认 `safe` （`src/host/locus/context.ts`、`src/index.ts`）→ `test/locus-context.test.ts`（`states the safe tier and its limit on a follow-up`）
- [x] 2.5 单测：首投（渲染前已接受）、渲染成功但未入队不消耗首投、backlog 已有已接受投递、**队列已接受但绑定失败→重发一次**、**绑定已提交但回执丢失→不重发**、重启后按证据决定、冷恢复、受既有缺陷影响的 child → `test/locus-preamble-durability.test.ts`（5 例：首投、未入队不消耗、backlog 已接受、绑定失败重发一次、绑定已提交不重发、重启后按证据、冷恢复）
- [x] 2.6 单测：`safe`/`shell` 两态下 prompt 的档位事实与持久记录一致（含渲染入参缺档位时的失败行为） → `test/locus-context.test.ts`（档位事实三例）
- [x] 2.7 更新 `test/client.test.ts` 对该段源码的字符串断言，使其不再作为唯一覆盖 → `test/client.test.ts`（装配断言 + `test/locus-preamble-durability.test.ts` 行为断言）

## 3. 当前入口只读工具（D2）

- [x] 3.1 实现 caller-bound 工具：入参只有窗口（时间/消息游标）、方向与 Host 签发的续读游标；无 chat/群/用户/thread 参数 （`src/host/locus-history-tool.ts`）→ `test/locus-chat-history-tool.test.ts`（`rejects unknown arguments without reading anything`）
- [x] 3.2 目标解析：入口为话题时读取**该绑定话题及其回复**，入口为群时读该群消息列表；不提供"任意选择 thread" → `test/locus-chat-history-tool.test.ts`（`reads the bound topic when the entrance is a topic, never the whole group`）、`test/channel-lark.test.ts`（`reads a topic entrance through the thread shortcut instead of the group`）
- [x] 3.3 未知/多余参数 → 拒绝且**不发生任何读取**（不是忽略后照读） → `test/locus-chat-history-tool.test.ts`（`rejects unknown arguments without reading anything`）
- [x] 3.4 游标契约：Host 签发、不透明、绑定 child 代际/入口/方向/窗口；使用时校验；伪造/篡改/跨域/过期 fail closed （`src/host/locus/history-cursor.ts`）→ `test/locus-history-cursor.test.ts`（8 例）、`test/locus-chat-history-tool.test.ts`（`rejects a forged cursor without reading anything`）
- [x] 3.5 每次 `await` 外部读取返回后复核调用方代际与入口，变化则丢弃结果 → `test/locus-chat-history-tool.test.ts`（`discards the answer when the caller association changes during the read`）
- [x] 3.6 bot 端口：群路径 `+chat-messages-list`；**话题路径 `+threads-messages-list`**（或已证明等价手段）；区分失败与空结果 （`src/host/channel/lark.ts` `readEntranceHistoryWith`）→ `test/channel-lark.test.ts`（含 `returns undefined when the read fails instead of an empty page`）
- [x] 3.7 预算与呈现：单页 ≤50 条、整页 ≤16k 字符、单条正文 ≤1k、发送者名 ≤64、截断标记、确定排序与同刻次序、发送者不可解析用占位、结果标注不可信输入 → `test/locus-chat-history-tool.test.ts`（`bounds the result, marks truncation and hands out a continuation cursor`）
- [x] 3.8 窗口语义（固定工具级规则）：时间参数 ISO 8601 带偏移、窗口左闭右开 `[since, before)`、同时间戳按平台消息位置升序（缺失或相同按消息标识字典序）、预算截断一个传输页时给出续读游标（不静默丢弃） → `test/locus-chat-history-tool.test.ts`（`applies the half-open window and a deterministic order`）
- [x] 3.9 装配：加入 `LOCUS_CALLER_BOUND_TOOLS` 与 `registerPetTools`，同步 attestation 单测与两档可见工具断言 （`src/host/locus/composition.ts`、`src/host/tools.ts`）→ `test/locus-composition.test.ts`、`test/ledger-tool-scope.test.ts`、`test/executor-scope.test.ts`（可见工具数 7→8，含理由注释）
- [x] 3.10 单测：群入口与话题入口各自的夹具（**真实 CLI 信封形态**：纯文本、帖子、卡片、缺字段），话题夹具含无关话题与群本体消息且不得出现；未知参数拒绝且未读取；游标篡改/跨域/过期；等待期间代际变化；窗口边界不重不漏；截断可继续；失败不返回空历史；两档均可见 → `test/locus-chat-history-tool.test.ts`（10 例）、`test/channel-lark.test.ts`、`test/locus-history-cursor.test.ts`

## 4. 能力声明按实测判定与探测生命周期（D3）

- [x] 4.1 投递控制器在渲染前以有界期限完成一次针对该入口的读取探测，并作为渲染输入；超时/不可判定传"未确认" → `src/host/channel/entrance-capability.ts`；`test/entrance-capability.test.ts`、`test/channel-pipeline.test.ts`
- [x] 4.2 生命周期：投递中止、入口禁用或 locus 重建时取消探测或丢弃结果；探测返回后复核 child/代际/入口；超时后迟到结果 MUST NOT 采用 → `src/host/channel/locus-controller.ts`（渲染后二次 fence）、`src/index.ts`（渲染器 await 后复核记录）；`test/locus-settlement-integration.test.ts`
- [x] 4.3 探测使用真实读取或等价探针，且不把消息正文写入任何持久结构 → `LarkClient.probeEntranceRead`（同一条 CLI 读取路径，page-size 1，只回布尔）；`test/channel-lark.test.ts`、`test/entrance-capability.test.ts`
- [x] 4.4 单测：可读/不可读/超时三态声明；探测期间入口重建或禁用；**探测期间 Delivery 被中止→迟到的成功结果不得触发渲染或入队**；超时后迟到结果不改写声明；上一次可读而本次失败不复用旧结论；探测不落持久层
- [x] 4.5 更新 QA 与群提示词的读取能力表述 → `src/host/qa/prompt.ts`、`src/host/qa/delivery.ts`、`src/host/channel/context.ts`、`src/host/locus/context.ts`；`test/qa-prompt-readability.test.ts`、`test/locus-delivery-prompt.test.ts`，使其与实测结论一致

## 5. 守卫拒绝可诊断且不额外放行（D4）

- [x] 5.1 拒绝信息补最小可执行指引（稳定原因码 + 被允许根 + 申请方式）→ `src/host/locus/project-read-guard.ts` `locusProjectReadDenialReason`；`test/locus-project-read-guard.test.ts`（`denial carries the allowed root and how to request more paths`）
- [x] 5.2 断言：受管出站在既有 @ 提及渲染之外不改动模型正文、不附加诊断/路径；纯文本与含提及两种正文都覆盖 → `test/channel-lark.test.ts`（`appends no diagnostics or paths to a plain-text body`、`renders a plain @display-name into a real mention before sending`）、`test/channel-mentions.test.ts`
- [x] 5.3 断言：投递 prompt 不指示模型把诊断转述进飞书正文 → `test/locus-context.test.ts`（`never instructs the model to quote guard diagnostics into the reply body`）
- [x] 5.4 单测：工作区外读取仍全部被拒（本 change 不新增放行）→ `test/locus-project-read-guard.test.ts`（`keeps refusing every outside path once the guidance is attached`）

## 6. 反馈类修复（D5/D6）

- [x] 6.1 未装配的协作上下文工具不出现在 child 工具面；装配后可注册；cold restore 后判定一致 → `src/host/collaboration/assembly.ts`（`composeCollaborationSurface` 缺任一 seam 即返回 `undefined`）；`test/collaboration-assembly.test.ts`（`leaves an eligible agent scope completely untouched when nothing composed`、`adds the circle surface to a locus child beside its own pet_context and reply`、`treats a fresh scope for the same session as a new installation`）
- [x] 6.2 三个待办工具按操作给出可执行下一步；**台账不可用与台账为空可区分**（不得以 `[]` 呈现不可用）；执行请求标识非法时指出先读台账；**登记失败**（参数/前置/依赖）给出操作特定指引且不泄露其它标识
- [x] 6.3 登记待办后的回复与持久状态一致（不得声称未开始的工作已开始）；未确认路径表述为推测 → `src/host/ledger/prompt.ts`（`INTENT_TRIAGE_GUIDANCE` 新增 DURABLE state/未确认路径条款并纳入结构化守卫）；`test/ledger-prompt.test.ts`
- [x] 6.4 单测覆盖 6.1–6.3 的对应 scenario（模型行为类用持久状态与出站文本做 oracle）→ 见 `test-plan.md` 六行映射；工具级反馈用真实 `ToolRuntime` 渲染文本做 oracle

## 7. 验证与收尾

- [x] 7.1 `packages/dsh-pet` typecheck 与全量测试 → `npm run typecheck` 零错误；`npx vitest run` 3021 passed / 0 failed / 43 skipped；`npm run build` 成功
- [x] 7.2 仓库 `npm test` 与 `npm run check:artifacts` → 424 passed / 0 failed / 2 skipped；tracked paths comply with repository policy
- [x] 7.3 `node scripts/sync.mjs` 两次，第二次无变化（幂等）→ 第一次 `3 change(s) applied`，第二次 `no changes — deployment already matches manifest`
- [x] 7.4 `openspec validate pet-locus-feishu-read-and-delivery-fixes --strict` → `Change '...' is valid`
- [ ] 7.5 经所有者批准重启 Host 后真机验收：新群 @ 一次确认首投前言与档位声明、`safe` 档 child 读当前入口**群与话题**、未知参数拒绝、游标篡改、守卫拒绝文案、能力声明与实测一致
- [x] 7.6 生成 `verify.md`（任务完成、test-plan 全绿、全量测试证据）→ 结论 `PENDING_LIVE_ACCEPTANCE`：7.5 真机未做前不勾选 7.5、不归档
- [ ] 7.7 spec 合并（先 `pet-locus-shell-tier` 7.4）与归档；更新 `BACKLOG.md` 中 U006/U007 状态
