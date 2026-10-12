## Context

现役行为与约束（动机见 proposal.md）：

- 统一 locus 的 child 由 Pet 在固定 preset 下创建，工具面 = 固定非委派底座 + caller-bound Pet 工具；`safe` 档再由按档位的 restrict 收紧层裁掉 `bash`/`skill`（`pet-locus-shell-tier` 在途，7.4 归档待办，其 task 1.2「read 档 child 等价沙箱内真机读取」仍**未完成**，本 change 不声称关闭它）。
- caller-bound 工具白名单是组合 attestation 的唯一解释源：新增工具必须同时进白名单，否则发布被拒（`src/host/locus/composition.ts`）。
- child 的本地读取守卫把 `read/read_image/glob/grep` 限制在「child cwd = parent cwd = sandbox workspaceRoot」内，并对每个 child 无条件安装（`src/host/locus/project-read-guard.ts`）；本 change 不放宽它。
- 投递链路顺序是：`accept()` 持久化接受 → 渲染 prompt → 队列进入 child inbox → `bindQueued` 提交 `inboxMessageId`。绑定失败/进程在绑定前终止会留下 `dispatch-state-unknown`（`src/host/channel/locus-controller.ts`）；启动恢复只在 child 日志能证明某 inbox 消息从未进入 turn 时才重投（`src/host/locus/startup-recovery.ts`）。
- 受管出站会把正文中的 `@显示名` 渲染为平台真实提醒（`src/host/channel/lark.ts`），因此"正文逐字不变"不是可用的契约。
- 应用 `cli_aa14740a43f81cd4` 的 bot 权限 `im:message.group_msg` 已于 2026-10-12 开通并实测：`+chat-messages-list`、`+threads-messages-list`、raw `GET /im/v1/messages` 的 bot 身份均可读。
- 部署要 `dsh build` + 重启 Host 才生效；重启会打断当前会话。

## Goals / Non-Goals

**Goals:**

- locus child 用**自己的入口**以 bot 身份读当前入口（群或绑定话题），`safe` 档也具备结构化只读手段，且"换目标读"在参数与游标两层都不可表达。
- 首投前言在"能证明未送达"时可靠恢复，且对不可判定结果有明确、不阻塞的策略。
- 对外声明的读取能力按有界实测判定，不虚报。
- 守卫拒绝可诊断，但不新增任何工作区外放行。

**Non-Goals（见 Deferred）：**（同 proposal：不做 user 回落、不放宽守卫、不开放跨目标读取、不给 safe 档 shell、不改 DSH core、不装配协作上下文能力。）

## Decisions

### D1 首投前言的送达与歧义策略（所有者 2026-10-12 决策 A）

- 「已证明送达」优先取最强证据：持久 Delivery 行上"内容已进入 child inbox"的绑定事实；实现 **MAY** 用等价对账证据（child 自身会话日志证明某 inbox 消息进入过 turn）来减少重复。
- 不可判定（队列已接受但绑定未提交、回执丢失、绑定前进程终止）→ 视为**未收到**，下一次真正投递带完整前言；**允许重复一次**，且 MUST NOT 因此暂停投递/阻塞 intake/要求重建。
- 绑定已提交而仅控制回执丢失 → 按已送达处理，不重发。
- 语义因此是**"可证明时不再重发"**，而不是无条件"恰好一次"；重复的代价（少量 token）由所有者接受。该策略保证的是：**本次判据缺陷不再持续抑制新 child 的前言**——不可判定时，下一次真正投递即补发完整前言。它**不是对所有 child 的送达保证**：没有后续成功投递时不会补发；已有送达证据的 legacy child 不自动补发（见下条）。
- 补充：每次投递（含后续）都声明当前档位能力，因此即使前言缺失，child 也不会失去"我能不能读"这一事实。

替代方案：无条件"恰好一次"（在绑定失败窗口内自相矛盾）；绑定不可判定即暂停并要求重建（代价最高，一次崩溃就要人工介入）；持久"已发前言"标记（新增 schema 字段与迁移，且仍无法区分"标记已写但内容未进 inbox"）。

### D2 当前入口只读工具

- **目标封闭**：无 chat/群/用户/thread 参数；入口为话题时读取该绑定话题及其回复（从入口事实推导），入口为群时读该群消息列表。未知/多余参数 → **拒绝且不发生任何读取**（不是忽略后照读）。
- **游标**：Host 签发、不透明、绑定 child 代际/入口/方向/窗口；使用时校验，伪造/跨域/过期 fail closed；每次 `await` 后复核代际与入口，变化则丢弃结果。
- **窗口语义**：时间戳用带偏移 ISO 8601 或明确单位的毫秒值；区间开闭明确；同刻消息按消息位置/标识确定排序；预算截断一个传输页时给出续读游标而非静默丢弃。
- **预算**：单页 ≤50 条；整页 ≤16k 字符；单条正文 ≤1k；发送者名 ≤64；截断带标记；发送者不可解析用占位。
- **端口**：话题入口需要支持话题/线程的 bot 端口（`+threads-messages-list` 已实测可用；作者自报不替代 child 沙箱内验证，验收任务保留）。
- **失败语义**：区分"读不到"与"没有消息"；畸形信封按失败处理。
- **装配**：`safe`/`shell` 都装配，并同步 caller-bound 白名单与 attestation 测试。

### D3 能力声明按实测判定（含探测生命周期）

prompt 渲染目前同步。做法：投递控制器在渲染前以**有界期限**完成一次针对该入口的读取探测，把结论作为渲染输入；期限由控制器设定并负责，投递被中止、入口被禁用或 locus 重建时取消探测或丢弃结果；探测返回后复核 child/代际/入口，变化则按"未确认"声明；超时后迟到结果 MUST NOT 被采用。渲染层 MUST NOT 默认 `safe`/可读（当前渲染入参缺档位事实，需一并补齐：档位取自持久 locus 记录）。

替代方案：同步阻塞探测（拖慢投递）；缓存结论（会说过期能力）；只报"bot 身份就绪"（泛化信号，与事故同源）。

### D4 守卫：拒绝可诊断，不放行，且尊重既有受管渲染

拒绝信息补"稳定原因码 + 被允许根 + 申请方式"，并明确边界：Host 自动发送的正文不含诊断；受管出站在既有受管变换（`@显示名` 渲染）之外不改动模型正文、不附加诊断或路径；prompt 不指示模型转述诊断；模型主动转述不由 Host 保证。**评审 round 2 指出**：先前写的"逐字一致"会与强制的 @ 提及渲染冲突（会回退提醒能力甚至暴露 open_id），已改为"只允许既有受管变换"。

### D5 未装配能力不得"可见但必失败"

协作上下文工具在生产未装配时不出现在 child 工具面；装配后（由 `pet-locus-independent-agent-inquiries` 负责）可注册；cold restore 后判定一致。

### D6 反馈类修复（按操作区分）

三个待办工具都要求可执行下一步：登记失败指出缺什么前置；**台账不可用必须与"台账可用但为空"区分**（现状把不可用渲染成 `[]`）；执行请求标识非法时指出先读台账取得合法标识。不引入 `latest` 选择器，不枚举其它标识。登记后的回复以持久状态为 oracle，未确认路径不得当事实。

### D7 评审历史、拆分与规范卫生

- round 1（`review-round1.md`）判 REVISE：C1 spill 可信来源、C2 前言语义、C3 目标/游标、C4 user 回落授权、C5 出站不外泄的过度承诺。经所有者决定拆分 C1/C4（BACKLOG U006/U007），其余在本期解决。
- round 2（`review.md`）判 REVISE 并触发 anvil 的"连续两轮 REVISE 升级给人"：R2-C1（绑定失败窗口的歧义策略）、R2-M1（逐字一致 vs 提及渲染）、R2-M2（探测生命周期）、R2-M3（话题读取未落到端口与验收）、R2-M4（三工具 vs 一任务）。所有者选择策略 A 后，本轮修订逐条落实：C1→D1、M1→D4、M2→D3、M3→D2、M4→D6。
- 引用更正：先前把"不得改用用户凭据"归到 ADR-0008 是错的——该结论在 `pet-locus-shell-tier/design.md`（未决验收说明）；本 change 不改身份策略，也不需要 ADR 变更。
- U006 中"user 身份即所有者本人凭据"改为条件化假设（在完成主体校验前不成立）。
- `openspec/specs/pet-lark-channel/spec.md` 两处重复块已作为规范卫生清理（该校验器按出现次数比对 MODIFIED 的 scenario）。

## Risks / Trade-offs

- [不可判定时重发一次完整前言] → 所有者已接受；代价是少量 token，收益是**新 child 不再被该判据缺陷持续抑制**（对 legacy child 与无后续投递的情形不承诺补发）；补三类故障用例锁定行为。
- [新工具扩大 `safe` 档读取面] → 只读当前入口、无目标参数、游标绑定入口与代际、单次有界；attestation 与单测双向固定。
- [话题读取实现缺口] → 明确端口要求 + 话题夹具 + 话题入口真机验收，避免"只做群路径也能过"。
- [探测拖慢投递或被取消不当] → 有界期限 + 取消/复核/迟到丢弃；必要时超时按未确认声明。
- [既有 child 永远补不到完整前言] → 如实写入 spec；每次投递声明档位能力；需要时所有者显式重建。
- [只读身份仍只有 bot] → 本 change 如实声明不可读；回落拆分到 U006 单独评审。
- [部署需重启] → 所有者决定时机；回滚为 revert + `dsh build` + 重启。

## Migration Plan

1. 出 `test-plan.md`（每个 scenario → 具名测试、红先），再实施。
2. `packages/dsh-pet` typecheck/测试；仓库 `npm test`、`npm run check:artifacts`。
3. `node scripts/sync.mjs` 连续两次，第二次无变化。
4. 经所有者批准后重启 Host。
5. 真机验收：新群 @ 一次确认首投前言与档位声明；`safe` 档 child 读当前入口群**与话题入口**；游标篡改；未知参数拒绝；守卫拒绝文案；能力声明与实测一致。
6. spec 合并与归档（`pet-locus-shell-tier` 7.4 先行）；U006/U007 状态更新。

## Open Questions

- 预算数值（16k / 1k / 64 / 50）是否需要在真机用长群校准。
- 是否需要"线程内独立读取"（调用方选择任意 thread）作为独立能力；本 change 只要求读取自己绑定的话题。
