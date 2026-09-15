# pet-locus-on-demand-tree 真实验收记录（2026-09-15）

对应 change：`openspec/changes/pet-locus-on-demand-tree/`（BACKLOG B036）。

## 结论

三步真实飞书验收全部通过，22/22 任务完成。

## 验收环境

- 所有者用 user 身份新建每个测试群，确保群创建时刻不含 bot——这一点是必要前提：如果用 bot 身份建群，bot 从一开始就是成员，永远不会触发 `im.chat.member.bot.added_v1` 事件，测不出"拉 bot"这一时刻的真实行为。
- 所有验证均直接查询生产 SQLite（`~/.dsh/plugins/dsh-pet/state.sqlite`），且每次都连带拷贝 `-wal`/`-shm` 并执行 `PRAGMA wal_checkpoint(TRUNCATE)`，避免读到未落盘的旧状态。

## 步骤 1：入群零副作用

群「验收-B036-拉bot零副作用」（`oc_2983702a8515d3176ae5a62c6be39bc1`）。

基线（拉 bot 前）：

```
u_dsh_pet_loci            该 chatId: 0 条
u_dsh_pet_locus_indexes   该 chatId: 0 条
u_dsh_pet_locus_operations 该 chatId: 0 条
系统总 loci 数: 4
```

拉 bot 入群后重新核对：三张表仍为 0 条，总数仍为 4。`dsh.log` 在此期间新增的两行与该群无关（另一会话的 `turn-ended`）。全局 `grep bot-added dsh.log` 零命中，确认 `botLifecycleInitializer` 未装配后，`BotLifecycleIntake`/`ChannelSubscription` 确实没有被构造——不是事件到达但被忽略，而是整条订阅链路根本没启动。

## 步骤 2：首个 @ 按需建树

同群内所有者发送「@小小芒果 你好」，机器人正常回复（`reply_to` 精确指向该消息，附 `DONE` 表情）。

建立的 locus：

```json
{
  "parentSessionId": "session-b2f11bae-eedd-4edf-bd27-23baa6c29936",
  "childSessionId": "session-dfb4c72e-b8ea-47da-b08b-a93e70411074",
  "workspaceId": "e81b1ec0-b651-41cb-ba41-108c06593305",
  "source": "auto",
  "state": "active",
  "createdAt": 1789485695432,
  "updatedAt": 1789485708181
}
```

`createdAt`→`updatedAt` 约 12.7 秒，是建树到首轮回复完成的端到端耗时，与话题入口现有体验量级一致，未发现异常延迟。

### 验收中发现的独立问题（不阻塞，已转 BACKLOG B041）

所有者反馈：新建的 main session 在 GUI 侧栏短暂显示为「未分组」，刷新页面后才正确归入 nexus workspace 分组。

排查确认数据层面从一开始就是对的：`createMainSession` 内的 `await workspace.attachSession(sessionId)` 已正确把新 session 写入 `workspace.json` 的 `sessionIds` 列表（已用 `python3` 直接读取该文件核实）。问题在 GUI 侧栏的实时渲染时序，不是数据错误、不是本 change 引入的新逻辑——`createMainSession` 这条路径在旧模型下也存在，只是旧模型的触发时机是「拉 bot 那一刻」（所有者通常不会盯着侧栏看），新模型触发时机是「发第一条 @ 消息那一刻」（所有者大概率正看着页面），因此更容易被注意到。

## 步骤 3：`/bind` 未建入口一次建对

另建群「验收-B036-bind一次建对」（`oc_646eb4b031519fde4c47c41592d348ce`），拉入 bot（未 @，不建树）。

第一次尝试 `/bind 4629eb` 收到「没有匹配到唯一的会话」——**排查后确认是测试目标选错，不是缺陷**：`4629eb` 前缀对应的 `session-4629eb39-c996-4ff6-ad0e-b59ac54337a1` 是本次验收之前遗留的历史会话，用 `zstandard` 库解压其 `session.jsonl.zstd` 直接读到最后一条事件是 `session/end-seed`——它早已结束，`/bind` 只接受未归档主会话，拒绝一个已结束的会话是正确行为。

改用 5.5 步骤中刚建立、确认存活（日志末尾是正常的 `turn/end`，无 `end-seed`）的 `session-b2f11bae-...`，发送 `/bind b2f11b`，回执：

> 群「验收-B036-bind一次建对」已绑定主会话「Locus 主会话 · oc_2983702a8515d3176ae5a62c6be39bc1」（b2f11b）；已创建新的只读子会话。

**回执中没有任何「S0→S1」上下文变更警告文案**。新建的 locus：

```json
{
  "source": "explicit",
  "parentSessionId": "session-b2f11bae-eedd-4edf-bd27-23baa6c29936",
  "generation": 1
}
```

`generation: 1` 证明是首代直建，不是替换出来的第二代；系统总 loci 数由 5 精确增至 6，未混入任何 `source: auto` 的多余记录，确认 D4（"/bind 在无 locus 时直接建立，不走改绑"）在生产环境行为符合设计。

## 方法论备注

- `resolveLocusBindPrefix` 的前缀比较会剥离 `session-`/`task-` 前缀（`comparableSessionId`），所以用户发 `/bind <prefix>` 时不带 `session-`。
- 遇到"和预期不符"的现象时，逐层往下查真实数据（这次是解压会话事件日志找到 `session/end-seed`），而不是停在"可能是 bug"就去改代码——本次两次疑似问题（GUI 未分组、bind 未匹配）都在深挖后确认代码行为正确，真正需要记录的只有 GUI 时序体验（B041）。
