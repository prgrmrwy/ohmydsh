# pet-qa-bind-existing-group Tasks

## 1. 持久层与不变量

- [x] 1.1 `chat_bindings` 增可选来源标记（Pet 建群 / 绑定既有群），加性变更，
      存量行读作「Pet 建群」；domain 版本按加性规则处理
- [x] 1.2 双向 1:1 占用判据实现：群侧（该 chatId 的 qa 行且其 Task 未归档）与
      会话侧（`qa:<sessionId>` 作用域命中未归档 Task）；失效绑定视为未占用并先
      归档其 Task；测试覆盖四种组合（均空 / 群侧占 / 会话侧占 / 失效不占）

## 2. 会话前缀解析

- [x] 2.1 前缀解析器：≥6 位、接受更长前缀、范围限未归档会话；返回唯一命中或
      「不唯一」两种结果，**不返回数量**
- [x] 2.2 排除不可作为源的会话（qa child 自身、executor 会话）；实现时确认 session
      类型可判定，不可判定则记录并放宽为仅排除已知 child
- [x] 2.3 测试：唯一命中、多命中、无匹配三者中后两者的**返回值完全一致**
      （这是不泄露要求的关键断言，不能只测「都失败」）

## 3. 绑定流程

- [x] 3.1 抽出 `createQaGroup` 中 fork + 写绑定的部分供复用，Q&A 路径行为保持不变
      （回归测试须证明既有 18 个用例全绿）
- [x] 3.2 `bindExistingGroup`：校验 1:1 → 解析前缀 → fork child → 写 `kind: qa`
      绑定行（含来源标记、执行根等字段与 Q&A 路径一致）；fork 成功而写绑定失败时
      回收 child
- [x] 3.3 回执出站：成功（含源会话标题、种子以最近完成 turn 为准、群成员数）与
      各类失败（1:1 冲突、前缀不唯一、源会话不可 fork）均发在群内；测试覆盖

## 4. 入站命令识别

- [x] 4.1 pipeline 在既有五道防线**之后**、丢弃/workspace 路由**之前**识别
      `/bind`：仅对无 qa 绑定的群、仅 allowlist 发送者；非 allowlist 静默丢弃
- [x] 4.2 已绑定群中的同形文本 MUST NOT 被解释为命令，作为普通提问投递
- [x] 4.3 测试：命令识别不豁免任何防线（未 mention / 重复 / 早于水位各一例）、
      非 allowlist 静默、已绑定群不再识别命令、单聊与非 qa 群行为零变化

## 5. 客户端

- [x] 5.1 设置页 qa 绑定行展示来源标记，并对「绑定既有群」如实说明 Pet 非群主、
      不具备群管理能力
- [x] 5.2 面板 qa Task 呈现兼容两种来源

## 7. `/unbind`（并入本 change）

- [x] 7.1 `unbindGroup`：仅解除 `qaOrigin === 'bound'` 的绑定；Q&A 创建的群拒绝并
      指向面板归档（入口与出口同侧）；Task 非终态时拒绝而不中断；解除即归档该
      Task（与面板同一机制），child 与历史保留
- [x] 7.2 `/unbind` 命令解析：不接受参数（群自知其绑定对象，接受参数等于开放
      「解除别的群」）；`/unbinding` 之类不误触
- [x] 7.3 pipeline 按绑定状态互斥识别两个命令：`/bind` 仅未绑定群、`/unbind` 仅
      已绑定群；不适用的一侧按普通文本处理，使已绑定群的正常提问不被解析为命令；
      `/unbind` 同样仅限 allowlist，非 allowlist 静默丢弃
- [x] 7.4 回执在群内发出（成员既被告知 agent 加入，也应被告知它退出）
- [x] 7.5 测试：解除后可重新绑定、拒绝解除 created 群、忙时拒绝且不归档、
      非 allowlist 静默、已绑定群的提问不被当作命令

## 6. 验证与收尾

- [x] 6.1 `cd packages/dsh-pet && npm run typecheck && npm test`
- [x] 6.2 仓库级 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs`
      二次运行无新增漂移
- [x] 6.3 真机通过（核心链路四项）：① `/bind` 成功，绑定行 `kind=qa`、
      `origin=bound`、`qaParentSessionId` 正是预期会话；② 上下文继承成立——child
      能准确复述本会话正在做什么（`/bind` 路径首次证明 fork 种子有效）；
      ③ 目录约束在**提问路径**重述（非仅 seed）；④ **非 allowlist 成员提问成立**
      ——`ou_a5fc5404…`（不在 allowOpenIds）@bot 后产生投递记录
      `qa-133f4ef1…`，证明豁免在 `qaOrigin=bound` 上同样生效（此前仅在
      `created` 上验过）。验收中发现并修复 8.2、8.3 两个缺陷。
      遗留：表情 OnIt→DONE 待肉眼确认。

- [ ] 6.4 真机：1:1 冲突两种方向各验一次；前缀多命中与无匹配的回执**逐字一致**
- [ ] 6.5 真机：非 allowlist 成员发 `/bind` 完全静默（不回复、不打表情）
- [ ] 6.8 真机：`/unbind` 解除后 @bot 不再回答；在 Q&A 创建的群发 `/unbind` 收到
      「请在面板归档」；解除后可重新 `/bind`
- [x] 6.6 更新 `dsh.yaml` dsh-pet 条目 note 与 `packages/dsh-pet/README.md`
- [x] 6.7 `openspec validate pet-qa-bind-existing-group --strict --type change` 通过；
      复核 diff 无范围蔓延（不触碰 Q&A 动作、投递/表情/失效链路、非 qa 入站路径）

## 8. 真机发现并修复的缺陷

- [x] 8.1 **`/bind` 从未被识别，消息落到 workspace 路由**。真机现象：在群里发
      `@小小芒果 /bind <会话前缀>`，Pet 却在 nexus workspace 下建了新 session，
      绑定行写成 `kind=workspace`。
      根因：`withoutMentions` 只剥 `@_user_N` 占位符，而真实入站正文携带的是
      **显示名**（`@小小芒果 …`）。剥不掉 mention，`startsWith('/bind')` 永远为假，
      命令被当成普通消息，于是走了二期1 的 default workspace 回退。
      讽刺的是证据一直都在：本仓既有的 pipeline 测试样例就写着
      `content: '@小小芒果 看看这个'`，我却按推断的占位符形态写了正则——正是
      pitfalls 里「按推断的结构解析而非按真实样本」那一类。
      修法：改为剥除**行首连续的 `@token`**（`/^(?:\s*@\S+)+/`），覆盖占位符、
      显示名、`@all` 及未来任何拼法；只剥行首，参数中的 `@` 不动。
      测试：新增显示名、多个 mention、参数含 `@` 三组用例；并把既有 pipeline
      用例统一改为显示名形态（此前用占位符，恰好绕过了这个 bug）。
      已用旧实现回跑验证这批测试确实会失败（7 项），避免写出「修完才通过、
      改坏也通过」的测试。
- [x] 8.2 **`/bind` 的群名与回执取不到会话标题**。真机现象：绑定成功（`kind=qa`、
      `origin=bound`、parent 正确），但群名是 `答疑 · DSH`——即 `qaGroupName(undefined)`
      的回退值。
      根因：`listSessions()` 从 `session.header.title` 取标题，而**该字段不存在**。
      标题由 `dsh-session-title` 服务维护在会话日志里（实测源会话 header 只有
      `{type,version,id,createdAt,cwd,delegationDepth,agentPreset}`，且 title 事件数
      为 0）。读一个不存在的字段不会报错，只会对**每个**会话都返回 `undefined`，
      于是所有 `/bind` 的群名退化成同一个默认值、回执里的标题显示成 id。
      与 8.1 同一形态：按推断的结构取值，而非按真实数据。差别是这次连测试都测不到
      ——它是宿主数据形状问题，只有真机才暴露。
      修法：改用 `ctx.sessionTitle.get(session)?.title`（Pet 早已 inject 该服务，
      `rename` 一直在用）。补一条断言 `header?.title` 不再出现的回归测试。
      发现过程值得记：是 qa child 从自己的 seed 里看到群名是回退值、推断出两种可能
      并要求核实，才查出来的。
- [x] 8.3 **`/bind` 给别人的群写了自拟名**。绑定行的 `chatName` 取
      `qaGroupName(target.title)`（「答疑 · <会话标题>」），但 `/bind` 的群是他人的
      既有群——设置页会显示一个飞书里根本不存在的名字，与「Pet 既非创建者亦非群主、
      不承诺任何群管理能力」相矛盾。
      修法：绑定行的群名改为经 `client.chatName` 读飞书真名，读不到则留空（回落到
      chat id，至少是真的）；`qaGroupName` 仅保留给 Q&A 建群路径——那里群确实是 Pet
      建的。child 的 label 仍用「答疑 · <群名>」，因为 child 是 Pet 自己的对象。
      发现过程：child 对群名提出了一个**错误**的假说（以为沿用了旧绑定行缓存），
      核实调用处后证伪（`chatName` 恒为 undefined），但这个追问促成了对「谁有权命名
      这个群」的检查。
- [x] 8.4 **群内回执泄露完整 session id**（用户指出）。三处会把完整标识送进群：
      群侧冲突回执带 `qaParentSessionId`、会话侧冲突在群名缺失时回落到完整
      `chatId`、源不可 fork 时回落到完整 `target.id`；成功回执的标题回退同样如此。
      回执发在群里，在场每个人都会看到——完整标识既非他们所需也不应由他们持有，
      且跨群打印 chat id 等于在这个群的记录里泄露另一个群的标识。
      修法：一律改用界面同款短 id（`displayShortId`）；会话侧冲突不再打印对方
      chat id，仅说「另一个群」。spec 增加相应 MUST NOT。
      新增 4 个回归测试，其中两条用正则扫描整段回执文本与整个返回值，
      而非只断言某个字段——避免将来新增字段时再次漏出。
