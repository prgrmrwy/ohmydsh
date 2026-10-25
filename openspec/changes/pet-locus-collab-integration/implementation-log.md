# implementation-log

## 0.1 迁移前基线（2026-10-25，main @ ffc2f3a7a）

| 包 | typecheck | test |
|---|---|---|
| collab-kernel | exit 0 | 44 files / 272 passed / 0 skipped |
| dsh-collab | exit 0（需先 `npm run build` collab-kernel；首次运行时 lib 为 10-21 的旧产物，报 30 处类型错误，重建后消失） | 9 files / 152 passed / 0 skipped（vitest）+ node:test skipped 0 |
| dsh-pet | exit 0 | 202 files passed / 3 skipped，3430 passed / 8 skipped |

基线前修复一处既有缺陷：`packages/dsh-pet/test/fixtures/locus-snapshot.ts:36` 一行 `toolTier` 声明被重复粘贴在同一行（c907ede80 引入），导致 `locus-surface`、`locus-view` 两个测试文件解析失败。删除该重复行，两文件 69 个测试通过。不属于本 change 的行为改动。

8 个 skip 均为既有真实 runtime 探针（`inquiry-runtime-probe` 4、`independent-runtime-probe` 3、`locus-turn-observer-runtime` 1），之后每组对比不得增加。

## 第 1–3 组（kernel、dsh-collab 句柄）

- task-1/2（kernel）：commit-time-01..03、dispose-01..05 均先红于"字段/方法不存在"，再实现。`auth.test.ts` 两个覆盖清单守卫随授权表新增一行而按设计变红，补一行用例，断言不变。提交 3f6c8ae85。
- task-3（dsh-collab 句柄）：接缝门 3.1 以真实 sessionController 会话、模型空闲时作 exec 验证成立（`establish-00`，controller-seams）。establish-01..04、handle-06 先红于"方法不存在"。额外 handle-07。提交 da2a05e2b。

## 第 4 组（dsh-collab 戳、投影、授权、cmdId）——TDD 顺序偏差与补证

**偏差**：stamp-01..19 一次写完、同时看到红、一次实现，没有按 4.1/4.3/4.5 分三轮。19 条的先红原因相同：替身 adapter 返回对象戳，旧代码只认字符串，调用者解析为 `COLLAB_CALLER_UNAVAILABLE`。对授权组与投影组来说，这个红因不能证明测试能抓住各自要防的缺陷。

**事后补证（变异核验）**：每次只改 `src/stamp.ts` 一处，跑 `stamp-projection.test.ts`，结束后还原并 `cmp` 逐字节一致。

| 变异 | 变红 | 失败原因 |
|---|---|---|
| 关掉写目标授权（`refusal()` 恒放行、去掉收件人检查） | 08、10、11、14、15、16、h1 | 修订/确认主会话条目被接受；引用他人消息成功；命令进内核并泄露 `currentRevision`；`to:'pet'` 时内核收到命令；子会话推进登记待办得到内核 `FORBIDDEN` 而非插件 `ITEM_NOT_FOUND` |
| 关掉投影（读取返回内核原始结果） | 03、04、05、06、07、10、13、h1 | 读到兄弟条目；兄弟消息与投递事件可见；状态文本能传话；`itemSeq` 泄露隐藏 ID；`pending.acks` 列出主会话条目；members 带出 `wakeCount`/`joinSeq` |
| 关掉 cmdId 命名空间 | 01、02、h1 | 两戳共用收据得 `COLLAB_CMD_CONFLICT`；收据 cmdId 无前缀 |

未变红：09、12 是正例（确认不误拦）；17、18、19 测戳解析与守卫，不在上述变异范围，它们最初的红因（戳不被识别）正属其范围。还原后 dsh-collab 178/178、typecheck 通过。

## Apply 期间规范修订

- AMD-1（2026-10-25）：`visible` 增加同步 `lookup.recordAt`，原因与评审复核见 review.md 末节；新增 `stamp-20`。
- task-7（AMD-1）：`stamp-20` 先红于"`visible` 只收到 2 个参数、lookup 未传"（插桩确认后撤掉），再实现；另对写授权单独变异（不传 lookup）确认 `stamp-20` 变红。dsh-collab 179/179。
- AMD-2（2026-10-25）：戳 `locusId` 改为由规范化入口键派生（第 1 版追 `replacesLocusId` 根被评审驳回：重建链不补、前驱不保证可达）；第 2 版评审复核接受。

## 第 6 组（Pet 代理）

- 顺序：先写 proxy 再写集成测试，集成用例没有经历"模块不存在"的红；纯函数 `collab-routing-pure.test.ts` 15 条覆盖命名、戳、路由、可见性。实际出现的红：routing-01 原 GIVEN 不可构造（→ AMD-3，评审接受）；scope-03 所有者处置须走 `disposeRequest`（内核不许 assignee 外 open→done，符合 D8）；scope-04 子会话推进自己登记的待办得到内核 `COLLAB_FORBIDDEN` 而非插件 `ITEM_NOT_FOUND`——因为该条目戳相等通过插件写检查，再被内核以"非 assignee"拒绝。scope-04 断言改为"新增 kind 前后拒绝结果完全相同"。
- 待处理：triage delta 场景"子会话不能推进待办状态"写的是插件层 `COLLAB_ITEM_NOT_FOUND`。经 `pet_locus_track` 登记的待办 ext 含来源事实，不等于戳，因此插件判"不是自己的"并返回 `ITEM_NOT_FOUND`（stamp-h1 已证）；scope-04 的条目是测试直接用原生 create 写的、ext 恰为戳，属于另一类。第 7 组用真实 `pet_locus_track` 登记后应得到 `ITEM_NOT_FOUND`，以 lifecycle-04 验证，不改规范。
- scope-06 的 `pet_locus_track` 部分为 `it.todo`，等第 7 组。
- 结果：dsh-pet 206 files / 3457 passed / 8 skipped / 1 todo；typecheck 通过。

## 第 7 组（collab TodoBackend、track 迁移、子会话工具面）

- 先红：track-01..06、lifecycle-01..06 红于"collab todo backend not implemented"（先放空壳，避免 import 错误）；toolface-03 红于 attest 判 8 个 collab_* 为 leaked。scope-06（track 部分）与 availability-01（登记 + Delivery 部分）为实现后补写，补做变异：撤掉 track.ts 新 reason 映射后两条红于 `store-error`，恢复后绿。toolface-04 与"dsh-collab 缺失时工具面无 collab_*"写完即绿（前者由 task-4 的 dsh-collab 实现，后者在 child-tools 之后写），如实记录无先红。
- 7.5 契约：保留的 4 条在 collab 上首跑即过，断言零改动；"无原子事务拒写"与 decoupling e2e 是 legacy 介质特性，移回 legacy-only，断言不变，collab 侧对应 availability-01。
- D6 实现方式：
  - 子会话的 8 个协作工具经 own 层委托注册（`src/host/collab/child-tools.ts`），定义逐字取自 dsh-collab 全局定义、execute 原样委托；原因见 `docs/architecture/dsh-plugin-integration-pitfalls.md` own 层与 filter 一节：继承层 `LOCUS_BASE_TOOL_FILTER` 是持久化 allow 列表，直接加名字会在 dsh-collab 缺失时令 child 创建失败、且已存在 child 恢复后仍看不到。不改规范语义。
  - D6 写"读取用 readSince 游标"；实际句柄 `readManaged` 每次返回全量，游标在 Pet 侧折叠（只处理 seq > 游标的新记录）。效果相同。
  - TodoRecord.locusId 保持旧语义（登记那代的记录 id，取自 ext.pet.recordId），稳定身份在 ext.pet.locusId（AMD-2）。
- `pet_locus_ledger_read` 退役（依据 D6 与 delta "兄弟子会话读不到彼此登记的结论"），断言改动逐条：
  1. todo-dispatch.test.ts:529、544、582：指引 `pet_locus_ledger_read` → `collab_read`；失败原因、`port.calls` 为 0、状态不变的断言未动。
  2. ledger-tool-scope.test.ts:189：可见 → 不可见；:204、248：常量删除后改为字面名，语义不变。
  3. ledger-tool-scope.test.ts 原 327–352 三条 ledger_read 执行用例随工具删除；兄弟不可见由 scope-01 承接。
  4. ledger-tool-scope.test.ts 原 395、439：指引文本改为 `collab_read`（439 对应 tools.ts 畸形 itemId 提示，同属退役指引）；isError 与不泄露 id 的断言未动。
  5. executor-scope.test.ts:306–309：计数 9 → 8，并新增断言被移除的恰为 `PET_LOCUS_LEDGER_READ_TOOL`，其余 8 个常量仍在。
  6. 删除 test/ledger-read.test.ts 与 src/host/ledger/ledger-read.ts；删除前 grep 确认唯一调用方是 tools.ts 注册与 index.ts:541 装配。
- 结果：dsh-pet 208 files / 3465 passed / 8 skipped / 0 todo，typecheck 通过（lead 独立复跑一致）。

## 第 8 组（迁移前后等价）

- equivalence-01..04 在真实 legacy 与真实 collab（真实 dsh-collab 插件 + collab-kernel + 临时目录 file store）上跑同一脚本，同一假时钟，只归一化 itemId；比较工具返回文本、跟进正文、受理回执（outcome/reason/executionTarget）、管理面视图。首跑红于夹具（scope key 与 execute 用了不同对象），修夹具后全绿；未暴露 collab 实现差异，8.2 无需改实现。
- 8.1 注入差异（collab backend 证据 detail 末尾多一个空格）：第一次只有 01–03 红，04 未比较证据字段——补上管理面视图后第二次 4 条全红，失败均落在证据（管理面 detail 与跟进正文末段）。撤回后 cmp 逐字节一致。
- 指引文本：规范允许 `pet_locus_ledger_read` → `collab_read` 的唯一差异；由于两边共用 `dispatch.ts`，实际两边失败文本逐字节相同，比规范更严（equivalence-04 注释已写明）。

## 第 9 组（降级与存量）

- 先红后绿：availability-02、legacy-01、legacy-02、无法路由管理面可见、面板渲染（旧版只读无动作、不可用说明、无法路由列表）、ledger-view 的 `availableTodoActions` legacy 分支。
- 写完即绿（如实记录）：availability-01（行为在第 7 组已实现；本 Host 回复工具为 `pet_locus_finish`，无独立 `pet_locus_reply`）、availability-03（恢复逻辑在第 6/7 组已实现）、装配守卫测试（事后变异：删 guard 行即红）。
- 实现中发现并修复：协作层不可用时待办块折叠摘要显示"0 条，都已处理"，即"把不可用显示为空"；改为显示"协作层不可用"并补断言。
- 范围说明：收件登记（含无法路由）只在内存，Host 重启清空，符合 D4"本期不持久"。

## 9.3 结果（lead 独立复跑）

| 包 | typecheck | build | test | 0.1 基线 |
|---|---|---|---|---|
| collab-kernel | 0 | 0 | 281 passed / 0 skipped | 272 / 0 |
| dsh-collab | 0 | 0 | 179 passed / 0 skipped（vitest） | 152 / 0 |
| dsh-pet | 0 | 0 | 210 files / 3482 passed / 8 skipped | 202 files / 3430 / 8 |

无新失败、无新 skip（dsh-pet 的 8 个 skip 为既有真实 runtime 探针）。

## 10.1 配置与仓库检查

- `managedChannels: ['pet-locus']` 写在私有 overlay 的 `patches/dsh-collab-local.yml`，而不是公开 `dsh.yaml`：dsh-collab 的本机 config 由该 overlay 整行覆盖（含 denySessionIds），公开 manifest 只放开关与说明。公开 `dsh.yaml` 的 dsh-collab note 已更新。偏离 tasks 10.1 原文"dsh.yaml 中增加"，效果相同。
- 仓库 `npm test`：首跑 `repo-docs-governance` 失败，原因是评审者写的 review.md 链接相对仓库根而非文件本身；改为相对文件路径（不改内容）后 447 tests / 445 pass / 0 fail / 2 skipped（既有 MCP bridge 探针，与基线同）。`npm run check:artifacts` 通过；`openspec validate --strict` 通过；`git diff --check` 通过。

## 10.2 部署（2026-10-25，用户授权 sync；重启由用户手动做）

- 主 checkout @ fa38cd644，载入 `.env.local`（含私有 overlay 路径）后 `node scripts/sync.mjs`：exit 0，`done — 6 change(s) applied`，其中 dsh-collab、dsh-pet 本地包内容变化、原子重装；生成的 `~/.dsh/profiles/web/cordis.patch.yml` 中 dsh-collab config 已含 `managedChannels: [pet-locus]`。另有两条既有 WARN（agent-team profile、voice-input bundle 未在 dsh.yaml 声明），与本 change 无关。
- 第二次 sync：exit 0，`no changes — deployment already matches manifest`，幂等。
- 尚未重启 Host；重启与刷新 GUI 由用户执行，10.3 在新会话中进行。

## 10.3 真实 Host 验收（进行中，2026-10-25，重启后）

环境：主会话 = 当前会话（…476b88a5），Locus 群「迁移 Pet Locus 共享台账至协作层」（oc_c98ce…，safe 档，read 权限），子会话 …571266a5。

- 空间建立：重启后主会话加载即建 `pet-locus-e513fbf9993de3e9`；seq1 `space/created`+`member/joined main`，seq2 `manager/allowed pet-locus`（actor main），seq3 `member/joined pet`（actor manager:pet-locus）。成员恰为 main 与 pet。其余 9 个主会话未加载，未建空间（D2 不唤醒）。
- 旧版只读：管理面 18 组均 `collab=available`，9 条旧待办全部 `legacy`；经真实 `/dsh-pet/api/locus-todo-action` 对旧待办 accept/done/drop 均 400「旧版待办（迁移前登记），只读保留」；`ledger_item` 表前后逐行一致。
- 登记：用户在群内 @机器人后，子会话调用 `pet_locus_track` 返回"已登记待办（状态为待处理，尚未开始）"，随后 `pet_locus_finish` 回复。空间 seq4 只含 `item/created`（无 `dispatch/intended`，未唤醒任何人）：author `pet`、assignee `main`、progress open；ext.pet 含 locusId `locus-0c3af9d398667401`（入口派生，AMD-2）、recordId、generation、endpoint、triggerMessageId、requestedBy；body 为 `{summary, detail}` JSON；receipt cmdId 带戳前缀 `c5c429942c16a52a:`。
- 子会话工具面（取自其真实 request header）：恰含 8 个 `collab_*`，不含 `collab_space/invite/member` 与 `pet_locus_ledger_read`。
- 主会话视角：`collab_status` 列出该 open 待办并建议 `advance_request`（D8 已知风险：主会话可见）；本会话未自行受理。
- 受理：管理面 accept → 200，seq5 `request/progressed accepted` actor `manager:pet-locus`，cmdId `accept-<itemId>-<attemptId>`；再次 accept → 400"待办当前不是待处理（accepted），未投递"。跟进正文以 `next-turn` 排入主会话 inbox（未 steer 当前轮）。
