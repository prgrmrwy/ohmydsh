# 伙伴对话调整 2 期 · 答疑群协作摩擦复盘（Pet 统一 locus）

> 对象：session `session-85620d77-e1a8-4d80-b5d9-66a481bda3c5`（cwd `/Users/prgrmrwy/corp/nexus`）
> 及其关联 locus 树 —— 群级 locus `locus-runtime-1789492017560-5eb2c5c3c07d38` + 4 条话题 locus。
> 群：`oc_3c57889c7808eae69b5ad1dd9ddc8ace`（「答疑 · 伙伴对话调整2期」），2026-09-15 10:06 由 bot 建群，
> 264 条群消息 + 151 条话题消息，09-15 10:06 → 09-18 06:02。
> 日期：2026-09-18。全部结论附证据（时间戳 / 原话 / 状态字段）；无法判定的地方显式标注不确定。

## 0. 结论先行

1. **本期最大的卡点不是"模型能力不够"，而是一张投递票据在它仍然有效时被宿主拒收。**
   `pet_locus_finish` 在 15 次群交付中被拒 5 次（33%）；其中 3 次发生在**该投递仍处于 `current`、距 deadline 还有 14–59 分钟**的时候。
   被拒后模型自述"Delivery already settled"，改走 `bash` + `lark-im-live` 技能脚本**直发飞书**——这条路径完全绕开 Delivery 契约。

2. **一次未结算的投递会把整条串行队列一起拖死。** 租约自 `acceptedAt` 起算（spec 明文），但 child 只有在队列轮到它时才开始干活。
   于是 delivery-8 卡住的 1 小时里，后续三条消息在排队中白烧各自的 1 小时租约：delivery-9 排队 44 分钟（只剩 16 分钟工时）、
   delivery-10 排队 12 分钟、delivery-11 排队 26 分钟。**4/20 条投递最终记为 `expired`，是这条链的必然结果。**

3. **台账在说谎。** 群里其实收到了答复（模型用旁路发出去了），但 Delivery 因从未 `finish` 而超时，记录为 `expired`。
   也就是说：Owner 从台账上看到"20 条里 4 条没人答"，而群里的真实体验是"答了，但慢且没按协议回"。

4. **只读档没有可写暂存区，导致本群最主要的证据形态（截图/录屏）根本无法解析。**
   群消息里 26 条媒体全是图片；read 档下 child 连 `/tmp` 都写不了（10 次 `Operation not permitted`，覆盖 8 个不同工具/路径），
   话题里那 3 张关键截图因此**没被纳入**给主会话的纪要，视频也只能靠临时找 `-module-cache-path /tmp/swiftcache` 硬解。

5. **本期已修的 5 项都命中真实卡点，日志与群记录可以逐条对上**（§2.1）：`-s write` 不可达、写范围=child cwd、
   @ 发成纯文字、群内「引用+@bot」被静默丢弃（含 Owner 自己 00:16 那条被丢、问题延误 34 分钟）、入群即建空 locus。
   这些不需要再做。

6. **额外可做的优化集中在 4 处**（§3）：投递票据不该被同一 turn 内的良性流量整体作废（P0）；
   只读档需要一个受控 scratch（P0）；到期/排队对请求方与 Owner 都不可见（P1）；内网凭据与工具链缺一次 preflight（P1）。

---

## 1. 本期协作的实际形态（回顾）

这一期不是"人工验收"而是**真实生产协作**：通过 GUI Q&A 流程创建了默认答疑群（system 消息：bot 建群并指定 Owner 为群主），
同事（赵鸿珂 QA、林旭浩 后端、黄鹏、游磊、宋凯文、王博宏、黎星）陆续进群，群里同时跑着 4 个 bot（`小小芒果`=本 Pet、
`aaa金雷竹批发韩总`、`AI研发`、`智能纪要助手`），围绕豆包「伙伴对话二期」做 issue 分诊、接口对齐、发布协调。

- **建群与绑定**：2026-09-15 10:06 bot 建群并指定 Owner 为群主（system 消息），同时 `ensure-default-qa` 建立群级 locus 与专属 child
  （`session-680611d7`）。23:33 另一个 bot 完成 `/bind` 到主会话「豆包-伙伴对话调整（二期）」。
- **4 条话题 locus** 由首个 @ 按需建立：09-16 00:20（`omt_19cfc89238cf5bb5`）、09-16 08:40（`omt_19cff005788e5a5f`）、
  09-17 21:00（`omt_19c9af0e430f1a47`）、09-18 01:29（`omt_19c96cb3100f1b83`），与 `pet-locus-on-demand-tree` 的行为一致。
- **权限**：群级 locus 09-16 01:23:35 核验为 `write`；4 条话题 locus 全程 `read`。
- **投递账**：本 locus 树共 20 条 Delivery —— 15 `replied`、4 `expired`、1 `no-reply`；发送人 17 条来自 Owner、3 条来自赵鸿珂。
- **正常时的表现是好的**：15 条已回复投递里 10 条一次 `finish` 成功，耗时 12 秒 ~ 3 分 47 秒（中位数约 1 分钟）；
  `llm/retry` 仅 1 次（TRANSPORT，1.1 秒恢复）；无空 tool result、无上下文截断（末轮 input≈427k/1M）。

---

## 2. 卡点清单

### 2.1 已在本期改造中处置（核对结论：命中真实卡点，无需再做）

| 卡点 | 本期改造 | 本群证据 |
|---|---|---|
| `-s write` 永远失败，且原因被折叠成"控制命令执行失败，请稍后重试。" | `pet-locus-write-grant-reachable`（09-18） | 群 #52 `控制命令执行失败，请稍后重试。`；#57 才吐出真实原因"缺少所有者已确认的 execution root"；#59 成功。permission 操作 09-16 00:58:57 / 01:01:46 两次成对失败，01:23:35 才核验通过 |
| 写档 = `workspace-write`，边界是 child cwd，改不到真正的 worktree | `pet-locus-write-full-access` + ADR-0005 | child 自述"feat/doubao-workmate-chat-phase2 在 `nexus-2`，我的沙箱只放开了 `nexus`，写 nexus-2 直接被拒（Operation not permitted）"；Owner 被迫 7 轮追问"我怎么做可以让你直接用那个 worktree"，最终 01:48:45 放弃改写 handoff |
| 群回复开头的 `@名字` 是纯文本，对方收不到提醒 | `pet-reply-mention-rendering`（09-18） | 群 #5 `上面这条补一下真实提醒（刚才 @ 没生效）`；#82 又一次补发；01:58:48 发出的卡点汇总 @ 全失效 → `msg.py recall` 撤回 → 01:59:23 用 `<at user_id=…>` 重发 |
| 群内「引用一条消息 + @bot」被静默丢弃（`ambiguous-thread`） | `pet-group-quote-reply-entry`（09-18） | Owner 自己 09-16 00:16 那条 `@小小芒果 看下这个问题`（`reply_to` 有值、`thread_id` 为 `None`）**没有产生任何投递**，child 直到 00:35 读群历史才发现，该问题 00:50 才答（延误 ~34 分钟）；`~/.dsh/dsh.log` 中 `admission-rejected:ambiguous-thread` 累计 16 次（该日志为全局计数，未按群拆分） |
| 拉 bot 入群即建空 locus（固化尚未表达的归属） | `pet-locus-on-demand-tree`（09-15） | 本群建群与建树同时发生（10:06），4 条话题 locus 均为首个 @ 按需建立，行为一致 |

### 2.2 尚未处置的卡点（按影响排序）

#### 【P0-A】`pet_locus_finish` 在投递仍 `current` 时被拒，模型改走旁路直发飞书

**证据（1）拒绝本身**

`Error: This child has no current caller-authorized Feishu Delivery.`
群级 child（`session-680611d7`）15 次 `pet_locus_finish` 中 5 次被拒：00:50:33、01:48:06、02:48:58、03:08:50、05:24:56。

与 Delivery 台账逐条对齐（`u_dsh_pet_locus_deliveries`）：

| 拒绝时刻 | 当时 current 投递 | 距 deadline | 判定 |
|---|---|---|---|
| 00:50:33 | 无（delivery-7 已于 00:37:56 finish） | — | 合理拒绝 |
| **01:48:06** | delivery-8（01:47:06 → deadline 02:47:06） | **59 分钟** | **异常** |
| **02:48:58** | delivery-9（02:47:06 起 current → deadline 03:03:06） | **14 分钟** | **异常** |
| **03:08:50** | delivery-10（03:03:07 起 current → deadline 03:51:04） | **42 分钟** | **异常** |
| 05:24:56 | 无（delivery-11 已于 04:51:44 expired） | — | 合理拒绝 |

**证据（2）模型的反应**

被拒后模型的原文推理（turn 16 step 9，01:48:17）：`Delivery already settled. Sending via the group directly.`
随后改为 `bash` 调用 `nexus/.agents/skills/lark-im-live/scripts/msg.py reply/send` 直发群。
群级 child 累计 `msg.py` 调用 15 次（`send` 4、`reply` 10、`recall` 2），另有 `read.py chat` 14 次、`mentions` 12 次。
话题 child `session-b56b2bb7` 同样在 08:44:59 被拒（该次其上一条 Delivery 已 finish，属合理拒绝），
并且 09-16 03:51:05 那次投递**完全没有调用 `finish`**，直接 `msg.py reply` 后 `turn/end completed`。

**证据（3）代码与规范**

- 判据在 `packages/dsh-pet/src/host/tools.ts:278-283`：`lifecycle.currentCapability?.(childSessionId)` 返回 `undefined` 即抛该错。
- 能力由 `packages/dsh-pet/src/host/locus/turn-observer.ts:715` 的 `currentCapabilityForChild` 计算，要求该 child **恰好一个未结束 turn**，
  且 `!mixed && !saturated && deliveries.size === 1 && unresolved.size === 0 && foreign.size === 0`（:722-724）。
  代码注释（:258-263）写明 `mixed` 是 **PROVEN 污染的粘性熔断**："第二个 Delivery 共享该 turn、一次查询失败、
  或**解析不到 Delivery 的参与者流量**"。
- 规范要求的是"GUI/user steer MUST NOT 消费 current"（`openspec/specs/pet-locus-collaboration/spec.md:296`、场景 :330-331）。
  但实现把"GUI 流量不能结算"扩大成了"GUI 流量进入后，本轮**谁都不能**结算"——
  而 child 此时正持有并正在处理那次 current。**规范没有覆盖这个副作用。**

**不确定项**：01:48:06 之前 7 秒（01:47:58）确有一条 Owner 从 GUI 注入的消息（`那不要你在当前沙箱写了，你准备一个 handoff 交给 父 agent 跟进吧`），
但其 `agent/inbox/spliced` 的 `target` 是 `next-turn`，因此它是**候选成因之一**而非已证实的因果；
02:48:58 与 03:08:50 两次恰好紧跟在前一条 Delivery 到期、队列推进的同一秒（02:47:06 / 03:03:06），
怀疑与 turn/队列推进竞争有关。**三条异常需要一次定向复现才能定性**，本复盘只主张"投递仍 current 时被拒"这一事实层结论。

#### 【P0-B】一次未结算的投递会把后续每一条的租约一起烧掉

租约自 `acceptedAt` 起算（spec:362「初始 deadline SHALL 为 `acceptedAt + 1h`」），而 child 只在队列轮到它时才开始处理：

| 投递 | acceptedAt | 成为 current（queuedAt） | deadline | 排队白耗 | 实际工时 |
|---|---|---|---|---|---|
| delivery-8 | 01:47:06 | 01:47:06 | 02:47:06 | 0 | 60 分钟（因被拒而未用） |
| delivery-9 | 02:03:06 | **02:47:06** | 03:03:06 | **44 分钟** | **16 分钟** |
| delivery-10 | 02:51:04 | **03:03:07** | 03:51:04 | 12 分钟 | 48 分钟 |
| delivery-11 | 03:25:11 | **03:51:04** | 04:25:11 | 26 分钟 | 34 分钟（模型 41 秒就发出去了，但没调 finish） |

即：**delivery-8 未结算 → 后续三条在等待中消耗自己的租约 → 4/20 记 `expired`**。
用户可见后果：02:03 的提问到 02:49 才在群里看到内容（46 分钟）；02:51 那条 03:09 才回（18 分钟）；
Owner 在 03:25 只能再 @ 一次。整段 01:47–03:51 是本期体验最差的两小时。

#### 【P0-C】只读档没有可写暂存区，图像/视频证据无法解析

- 群消息 26 条媒体**全部是图片**，这是本群最主要的证据形态；录屏（`20260916-160622.mp4`，13.8MB）是定案关键。
- read 档下 child 写不了任何临时文件：群级 child 出现 **10 次 `Operation not permitted`**，覆盖 8 个不同工具/路径
  （`/tmp/_dsh_probe.txt`、heredoc temp file、`/Users/prgrmrwy/.agent-browser` socket dir、qlmanage、clang ModuleCache 等）。
- 话题 child `session-b56b2bb7` 08:41:06 `PermissionError: [Errno 1] Operation not permitted: '/private/tmp/mango_shots'`，
  随后三次自述 `话题里那 3 张截图我这边是只读沙箱、没法落盘解析，图里的终版名单没纳入`；
  主会话只能 08:54:36 回一句 `图片不用再取了`——**证据链断在这里**。
- 视频最后靠 `-module-cache-path /tmp/swiftcache` 的临时绕法（ffprobe 未安装、`cv2`/`av` 无、qlmanage 被拒、clang 缓存目录被拒）
  才解出 12 帧；**这条绕法不可依赖**（再往前一步 `/tmp` 也被拒时就没有 Plan B）。

#### 【P1-D】"到期"和"排队中"对请求方完全不可见

- 4 条投递 `expired` 时，群里**没有任何信号**；状态机只做 `status: 'expired'` 并推进队列
  （`packages/dsh-pet/src/host/locus/delivery.ts:436-442`），规范也只要求"标记 expired 并推进"（spec:364）。
- 也没有"已受理/排队中"回执：消息进入队列时请求方看到的仍是沉默，无法区分"没收到"和"排在别人后面"。
- 本期 Owner 的应对方式就是**再 @ 一次**（03:25、02:51），而这恰好又给队列增加一条会烧租约的条目。

#### 【P1-E】`pet_locus_wait` 在 5 个子会话里 0 次调用；租约感知不可达

- 09-15 引入的长任务入口 `pet_locus_wait` 在本期 **0/22 次调用**（5 个子会话全为 0）。
- 子会话只有在主动调用时才知道剩余租约；它无法在接近 deadline 时收到提示，也就无从判断"要不要声明继续等待"。
- 结果回到 P0-B：真实耗时（看 13.8MB 录屏约 46 分钟、单轮调研 11 分 54 秒）与 1 小时默认租约处于同一量级，一旦被拒就必然过期。

#### 【P1-F】内网凭据 / 证据读取缺一次可诊断的 preflight

- **同一件事有 5 种互不相同的失败形态**，child 只能逐条试（话题 child 为此烧掉 11 次调用、约 9 分钟）：
  `✗ Unknown command 'work-item'.` → `✗ Meegle CLI authentication is required.` → `no local token` →
  `ERROR: 缺少环境变量 MEEGO_PLUGIN_ID / MEEGO_PLUGIN_SECRET / MEEGO_USER_KEY。` →
  `Error: URL hostname "meego.larkoffice.com" resolves to a non-public IP address`。
- **单点失败被当成定论**：群级 child 00:37:56 在群里断言 `这个单子我打不开…三条路都断了`，
  Owner 00:44:45 只说了一句「bytedcli 应该是可用的」，00:45:24 `meego status` 就显示已认证、一次拉取成功；
  00:50:33 群里更正 `我其实读得到，是我上次一条命令失败就下了结论，抱歉`。Owner 不得不向同事解释「他身份挂了」。
- **只读 `description` 就判定"无附件"**：02:48:58 `我上一轮说 7375520107「无截图、无附件、评论为空」——那是我只读了 description 字段就下的结论`；
  附件实际在 `multi_attachment` 字段（13.8MB 录屏）。该错报直接发给了同事，03:08:50 才撤回。
- 02:47 再次掉线（内建 `attempt 1/2/3 failed` 全败），要 Owner 手动 `bytedcli meego login` 才恢复。
- `pet_context.contextAnchor.status` 在其中 4 次调用里**恒为 `unknown`**——恰好缺的就是这类"我的证据通道现在是否可用"的事实。

#### 【P2】低影响项（可一并收）

- **只读档的升级提示与权限模型矛盾**：拒绝时附带 `[sandbox: escalation available — retry … with sandbox_permissions … the approval prompt asks the user]`，
  但 locus child 的 `approval/policy=never`，升级不可能发生——提示在诱导无效重试。
- **`no-reply` 的成功文案含混**：返回 `当前请求未发送正文。`，child 无法区分"按指示不回"与"空回复失败"。
- **两条发送路径渲染语义不一致**：同一内容走 `finish` 与走 `msg.py` 必须重写——05:24 那条 `finish` 文本 1716 字符含 16 处 `**`，
  `msg.py` 版 1847 字符、`**` 全被剥掉；01:48 的 `msg.py` 版保留 `**` 与 `@赵鸿珂`，直接导致 @ 失效。
  child 自 12:19 起就知道「Feishu text messages render markdown literally」，但**无法自证自己发出的消息渲染成什么样**，只能事后 `read.py mentions` 复核。
- **旁路依赖的三份状态根本不存在**：`~/.cache/lark-im-live/state.md` 不存在（4 次 `No such file or directory`），
  导致 `msg.py` 查不到 open_id，这正是 4 次 @ 失效的直接原因；
  该 skill 的必读步骤 `MUST read '~/.cache/lark-im-live/state.md'` 又因 `read` 不展开 `~` 而 100% 失败。
- **`pet_collaboration_context` 对 locus child 不可用**：`Error: No current collaboration scope is available for this caller.`
- **群回复过长**：bot 群消息中位 **836 字符**（最长 1640），人类中位 **22 字符**；Owner 三次要求精简
  （01:24 `尽量简明扼要`、03:26 `简单点讲`、03:30 `简单回复有问题还是没问题，有问题原因是啥`），精简后确实缩到 13 秒。
- **`rg` 不在 child 环境**（2 次 `rg: command not found`）。
- **群历史里的已撤回消息**被 lark-cli 渲染成 `[Invalid text JSON]`（本群 5 条，其中 1 条是 bot 自己撤回的），
  读取群历史时会静默丢内容；同源问题：CLI 的 `updated` 字段在同分钟内也置 `true`（本群 168/264 误报），做证据统计时不可用。
- **跨 locus 无共享记忆**：`pet-locus-intent-triage`（09-18）已建"共享事实台账"，但本期 0 条（全库仅 1 条，属另一会话），
  同一批文件在 09-16 与 09-18 被两个话题 child 各查一遍；`pet_locus_parent_lookup` 返回 39,515 字符并溢出 146,479 字节到 spill 文件，
  模型必须 `grep` 溢出文件才拿到主会话已有口径。

---

## 3. 额外可做的优化（建议 + 验收判据）

> 排序依据：本期实际损失（4/20 投递作废、2 小时体验塌陷、证据链断裂）× 修复面大小。

### P0-1 投递票据不得被同一 turn 内的良性流量整体作废

- **改法（择一或组合）**
  a. 把授权粒度从"整个 turn 干净"下沉到"该 turn 已认领的那一条 claim"：GUI steer 只应让**它自己**拿不到 finish 能力，
     不得剥夺已持有 claim 的那次投递的结算能力（`turn-observer.ts:715-724`）。
  b. 若必须 fail closed，则 Host 应在下一次投递/续投时**重新签发**票据（`restoreCurrentCapability` 已有此路径，但显然没覆盖本场景）。
  c. 报错必须可行动：区分 `no-current-delivery`（真的没有）与 `capability-lost:<reason>`（有 current 但本轮不可结算，附原因与恢复动作），
     现有文案会让模型断定"投递已结算"。
- **验收判据**：新增 spec 场景——「current 存续期间收到 GUI/user steer，child 对**同一 current** 调用 `pet_locus_finish` MUST 成功，
  且该 steer MUST NOT 消费/终结 current」。定向复现本期 3 次异常（01:48:06 / 02:48:58 / 03:08:50）作为回归用例。

### P0-2 只读档给 child 一个受控 scratch（否则图像证据永远读不到）

- **改法**：read 档预留 per-child 临时目录（如 `$DSH_HOME/tmp/locus/<childId>/`）可写但仅本 child 可见、投递结束即清理；
  或在管理面把"read 档不支持图像/附件解析"如实呈现，并把该限制写进 locus 初始化任务书。
- **验收判据**：read 档 child 能把群消息中的一张图片落盘并 `read_image` 成功；`/tmp` 之外不再出现 `Operation not permitted` 的
  临时文件路径（本期 10 次，覆盖 8 个工具/路径）。

### P1-1 到期与排队必须对请求方可见（并且台账不许说谎）

- **改法**
  a. `expired` 时给请求方一条最小出站（"这条没能在期限内答复，要的话请重新 @ 我"）或至少一条管理面通知；规范目前只写"标记并推进"。
  b. 队列非空时给一次"已受理，排在当前任务后"的回执——本期 Owner 的应对方式是重复 @，反而增加队列压力。
  c. 若检测到旁路直发（同 endpoint 出现非 Host 发出的消息），台账应记为 out-of-band 而不是 `expired`。
- **验收判据**：连续投递 3 条，前一条不结算时后两条不会在无任何外部信号的情况下过期；台账能区分"未答复"与"旁路已答复"。

### P1-2 租约应按"可用工时"计量，并让 child 感知剩余时间

- **改法**：deadline 自 `current` 起算（或按排队时长补偿），硬上限仍是 `acceptedAt + 24h`；
  接近 deadline 时给 child 一条 system reminder（"剩余 N 分钟"），让 `pet_locus_wait` 从"没人用"变成"用得上"。
  另外到期本身要准时：`delivery-11` 的 deadline 是 04:25:11，实际 `expiredAt` 是 04:51:44（晚 26 分钟）。
  到期由内存定时器驱动（`locus/expiry-scheduler.ts` 头注释），Host 重启后应确保从持久行重新武装，
  否则"已到期但仍是 current"的窗口会与新的投递重叠。
- **验收判据**：delivery-9 类型的场景（排队 44 分钟后开始处理）不再出现"成为 current 后 16 分钟即过期"；
  一个跨 1 小时的真实调研任务不再被记为 `expired`；`expiredAt` 与 `deadlineAt` 的偏差在秒级。

### P1-3 内网凭据与证据读取收敛为一次 preflight

- **改法**：把 Meego / 内网/浏览器登录态的可达性做成一次探测，返回结构化状态 + **唯一的恢复动作**，
  并把该事实注入 `pet_context`（当前 `contextAnchor.status` 恒为 `unknown`，缺的正是这类事实）；
  读取 Meego 单时默认带附件元数据（`multi_attachment`），避免"只读 description 就宣称无附件"。
- **验收判据**：凭据不可用时 child 一次就能给出唯一恢复动作，不再出现 5 连试错；
  多附件工单不再被判定为"无附件"。

### P1-4 长回复默认收敛为"结论先行"

- **改法**：在 locus 初始化任务书里明确群回复体例——首行结论、正文行数上限、细节进话题或卡片；
  当前中位 836 字符 vs 人类 22 字符，Owner 三次要求精简。
- **验收判据**：同一问题的群回复首行即结论；Owner 的"简单点讲"类追问不再出现。

### P2 顺手项

`no-reply` 文案区分"按指示不回"与"回复失败"；只读档不再提示不可能的升级路径；
把"发送后渲染自证"（mentions/markdown 实际落地的样子）做成 finish 的可选回执；
跨 locus 共享事实台账在 `finish` 时给出"这条结论可登记"的引导（能力已建、本期未被使用）。

---

## 4. 证据底座与复现方式

本次复盘的原始证据为**临时数据**（依仓库约定不入库），落在 `/tmp/locus-2qi/`：

```
raw/             loci / deliveries / operations 全量 JSONL；5 个 child session 解压后的 jsonl
pages/           群历史 6 页原始响应（page-000..005）+ _pages-index.json
threads/         9 个话题的完整回复（_index.json + 每话题一个 json）
structured/      messages.ndjson（264 条规范化群消息）、media-index.ndjson（26 条媒体打标，未下载）、
                 timeline.txt（可读时间线）、summary.json
findings-*.md    两个子会话的摩擦证据目录
```

关键查询：

- locus 树：`u_dsh_pet_loci` 全量 → 筛 `parentSessionId = session-85620d77-e1a8-4d80-b5d9-66a481bda3c5`（1 群级 + 4 话题）。
- 投递台账：`u_dsh_pet_locus_deliveries`（`acceptedAt / queuedAt / deadlineAt / status / finishOutcome`）。
- 操作账：`u_dsh_pet_locus_operations`（162 条，全 `committed`；`delivery-expired` 4 次、`permission` 12 次、`anchor` 1 次）。
- 宿主日志：`~/.dsh/dsh.log` 的 `admission-rejected:*` / `control refused:*` 计数。

**媒体处理约定**：26 条图片只做打标（`structured/media-index.ndjson`），未下载；本复盘未发现必须下载图片才能定性的卡点，
唯一的视频证据（`20260916-160622.mp4`）通过 child 会话日志中的解码记录间接取证，未重新下载。

## 5. 不确定项

1. 01:48:06 / 02:48:58 / 03:08:50 三次"投递仍 current 却被拒"的**确切触发条件**未定性：
   01:47:58 的 GUI steer 是候选成因，但其 splice `target` 为 `next-turn`；后两次与前一条投递到期同秒，疑似队列推进竞争。
   需要一次定向复现（建议直接写成本次的回归用例）。
2. `05:25` 那次回复挂在 `03:51` 的旧 trigger id 上是否为"误绑目标"，无法从 child 日志断定——该请求来自父会话 `send_message`，本身不是 locus 投递。
3. 01:40:11 用户所说"刚才会话挂了"在事件流里只表现为 `turn/end {kind: interrupted}` + `session/end-seed`，
   无法区分宿主崩溃与外部中断（群级 child 共 3 次 `interrupted`）。
4. `pet_locus_parent_lookup` 溢出的 spill 目录 `session-227d22b8d900` 既非父也非子会话 id，归属不明。
5. 本期"模型行为"侧的多数问题（单点失败即下结论、把注释当实现证据、首版交付物形态不合预期）
   在 5 个子会话里共出现 7 次自陈更正；本复盘不主张它们已修，因为它们属于提示/工具设计面而非状态机缺陷。
6. `delivery-11` 的到期晚于 deadline 26 分钟（04:51:44 vs 04:25:11）。怀疑与"内存定时器 + Host 重启后重新武装"有关
   （`~/.dsh/dsh.log` 在该时段有 `subscription stopped` / `ready — routes registered` 的重启序列），
   但未做定向验证，因此只作为 P1-2 的一条改法线索而非结论。
