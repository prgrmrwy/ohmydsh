# Pet Locus 串行队列与并发调研：auto-thread 模式与父会话争用

调研日期：2026-09-15。针对两个真实问题：**（1）父会话成为争用热点**、**（2）群级 locus 独占队列导致队头阻塞**。
结论优先，来源可点击；无公开答案的地方明确标注「没找到」，推断标注「推测」。

> 本仓库现状锚点：`openspec/specs/pet-locus-collaboration/spec.md` 第 181 行规定「每个 locus 至多一个 current Delivery，后续进 backlog」；第 261/263 行规定子会话可经 `agent-message` 向 caller-bound 主会话定向提问，且该消息**只补充上下文、不参与 Delivery 路由**。下文所有方案都以这两条不变量为边界。

## TL;DR（五条结论）

1. **方向是对的，粒度是错的。** 「同话题串行、跨话题并发」被 Kafka / SQS / Akka / Orleans / Temporal 五家共同验证；飞书生态已有同构实现（群=项目、话题=session）。业界没有一家在同频道多人提问时做全局串行排队。
2. **但必须先解问题 1，再解问题 2。** 拆话题会让 N 个 child 同时涌向同一个父会话——按 HTTP/2 的教训，**只拆上层通道而下层资源仍独占，HOL 只会从群队列搬到父会话队列**。落地顺序必须是 1 → 2 → 5 → 3。
3. **问题 1 的根因是「读」被迫排进了「写」队列。** 读父会话历史（不可变、可并发、零争用）与让父会话推理（消耗 turn、必须独占）是两种操作，今天被压成了同一个 inquiry。分开后父会话负载只剩真正需要推理的那一小部分。
4. **「不打断」是实现选择，不是固有代价。** Claude Code 的 cross-session messaging 明确在 tool call 之间投递、永不打断运行中的命令，Copilot SDK 的默认值是 `enqueue` 而非 `immediate`。
5. **auto-thread 本身没被否定，被否定的是缺少 follow-up 归属与生命周期回收。** 反向证据确凿（GitHub 提供 per-channel 关闭开关、飞书官方承认话题群开太多会全面失败、Cursor 因 follow-up 归属缺失被报 bug），但三者都指向「怎么做」而非「做不做」。

---

## A. 「每条消息自动开 thread」：业界现状

### A.1 这个模式有名字，而且已经产品化了

开源 IM agent 生态里的通用名就叫 **`autoThread`**：OpenClaw（Discord 渠道）提供
`channels.discord.<guildId>.channels.<channelId>.autoThread: true`，语义是「该频道收到的消息自动创建 Thread 来回复，而不是直接在频道回复」
（[Agent Trainer Discord 指南](https://zhixian.io/en/posts/agent-trainer-discord-guide/)）。
配套还有 **thread binding**：线程绑定 session target，该线程后续消息始终路由到同一 session，支持 `/focus`、`/unfocus` 改绑与 `threadBindings.ttlHours` 过期
（[OpenClaw Discord 文档](https://docs.openclaw.ac.cn/channels/discord)、[ACP agents](https://openclaw-ai.com/en/docs/tools/acp-agents)）。
**这与 Pet Locus 的「话题 locus 绑定专属 child session」是同一设计**，只是我们多了持久 Delivery 队列。

更激进的一步是 Slack 官方的 **Code channels（Slack Code）**：agent 不是开 thread，而是**自动创建一个临时频道**。
> "Slack Code creates a temporary channel, called a code channel... An agent creates one when it starts working, giving you and your team a dedicated place to collaborate **without cluttering your main channels**. When the work is done, the code channel gets **archived automatically**, while the context stays searchable."
> —— [Introducing Slack Code](https://slack.com/intl/fr-fr/features/code-channels)

已批准的 agent 名单是 Claude (Anthropic)、Devin (Cognition)、GitHub Copilot、Vercel；频道「由 agent 在 channel 或 DM 中被 @ 之后自动创建」，可公开或私有
（[Slack 帮助中心](https://slack.com/intl/en-sg/help/articles/54310833022355-Build-with-AI-as-a-team-using-Slack-Code)）。
Anthropic 侧的描述尤其值得抄：
> "Claude Tag can invoke a code channel – a home for the work **so it doesn't get lost in a thread** – and separates it from other chats. Everyone can follow progress at a glance through the feature **in the original thread**... Claude Tag **archives the room once the work lands**."
> —— [Slack Code blog](https://slack.com/intl/en-sg/blog/news/slack-code-channels-for-agents)

Slack Code 的**回收机制是一等公民而非可选项**，共三重：活跃 code channel 收在 sidebar **专属分区**、**7 天无活动自动移出 sidebar**、任务完成**自动归档但保持可搜索**
（[帮助中心](https://slack.com/intl/en-ie/help/articles/54310833022355-Build-with-AI-as-a-team-using-Slack-Code)）。
Devin 侧还提供**显式逃逸关键字**：`@Devin !new <task>` 另起频道/thread、`!channel #name` 指定频道、`mute`/`(aside)` 让 Devin 忽略嘈杂消息
（[Devin Slack Marketplace](https://app.slack.com/marketplace/A06A3TU8H39-devin)、[docs.devin.ai/fr](https://docs.devin.ai/fr/integrations/slack)）。

**四条可直接借鉴的设计约束**：(a) 拆出去的现场要**自动归档 + 空闲超时回收**；(b) 原始消息处留**进度摘要锚点**；(c) 归档后**仍可搜索**；(d) 提供**显式逃逸/静音关键字**，让用户能手动控制拆不拆。

Slack 另有原生 **app threads**（启用 Agents & AI Apps 后自动把 app 会话归组为 thread，可用 `assistant.threads.setTitle` 命名，
[文档](https://docs.slack.dev/ai/developing-ai-apps/)；changelog 已出现 **multi-agent stacking**，[changelog](https://docs.slack.dev/changelog/tags/announcement/)）。
Discord forum channel（type 15）更是**强制**形态：不接受直接消息，每帖必须是 thread
（[Hermes Discord 文档](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/discord)）。

飞书这边能力齐备：`POST /im/v1/messages/{message_id}/reply` 带 `reply_in_thread=true` 即「在该消息下创建话题并回复」
（[飞书回复消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/reply?lang=zh-CN)、[话题概述](https://open.feishu.cn/document/im-v1/message/thread-introduction?lang=zh-CN)，thread_id 形如 `omt_`）。
飞书官方 Aily 平台早在 2024-12 就把它做成了**机器人渠道配置项**：「普通对话群的回复方式支持『在原消息中创建话题并回复』」
（[Aily VOL.19 更新](https://bytedance.larkoffice.com/wiki/J3KLwSn36iTAg6kVg4vcpO6bnib)）。
**即：我们设想的解法在飞书生态里是一个已被平台方做成开关的成熟选项，不是新发明。**

### A.2 各家在「同频道多人同时提问」时的真实行为

| 产品 | 行为 | 来源 |
|---|---|---|
| **Devin** | 会话与 Slack thread **双向同步**，一个 session 绑一个 thread；@Devin 在已归档 session 的 thread 里会**自动 unarchive**；session 数无硬性上限但受**并发 session 限额 + ACU 月度额度**约束 | [Devin Slack 集成](https://docs.devin.ai/integrations/slack)、[release notes](https://docs.devinenterprise.com/release-notes/overview)、[并发/ACU 限额](https://usagebar.com/blog/devin-rate-limit-exceeded) |
| **Cursor** | 频道里 `@Cursor <prompt>` **每次启动一个 Cloud Agent**；已有 agent 的 thread 内 `@Cursor` 是**追加 follow-up**；要并发需显式 `@Cursor agent [prompt]`。**独有 `Team follow-ups` 开关：关闭时只有发起者能插话**。并发无公开上限，唯一闸门是 spend limit | [Cursor Slack 文档](https://cursor.com/docs/integrations/slack)、[cloud-agent](https://cursor.com/docs/cloud-agent) |
| **Claude Tag** | **每频道一个 Claude 实例、全频道共享上下文**（"任何人都能接续别人未完成的任务"），与「每 mention 一 session」是相反取舍；每 session 只能开一个 PR | [claudeapi.com](https://claudeapi.com/zh/blog/seo/claude-tag-team-ai-workflow-guide/)、[how-it-works](https://claude.com/docs/claude-tag/concepts/how-it-works) |
| **GitHub Copilot** | **任务间并发**（多 issue 同时指派，每次一仓库一分支恰好一个 PR，59 分钟硬上限）。另：**Copilot Studio**（agent 平台侧，非确认为同一代码路径）有错误码 `CONVERSATION_BUSY`："The agent processes **one turn at a time** within a single conversation" | [coding agent 文档](https://docs.github.com/en/enterprise-cloud@latest/early-access/copilot/coding-agent/using-copilot-coding-agent)、[Copilot Studio 错误码](https://learn.microsoft.com/es-es/microsoft-copilot-studio/agents-experience/troubleshooting-error-codes) |
| **Mastra Slack 模板** | thread 级会话记忆：同 thread 共享上下文，**不同 thread 互不干扰** | [模板详解](https://blog.csdn.net/gitblog_00775/article/details/152775606) |

**共性结论：没有一家在「同频道多人提问」时做全局串行排队；但所有人都在「单个会话内」严格串行。**
Copilot 的 `CONVERSATION_BUSY`（"one turn at a time within a single conversation"）是这一点的唯一明确文档证据，
**它恰好就是 Pet Locus「每 locus 至多一个 current」的同构物——说明我们的单队列不变量是对的，错的只是分片粒度（群 → 话题）。**

**另一个已被独立实现的验证**：飞书生态已有人做出与我们完全相同的模型——
`peterpren-feishu-codex-bridge` 设计为「**群 = 项目**（绑定本地目录）、**话题 = 会话**（话题内连续 Codex 会话，自动 resume）、多话题群**每话题一个独立可写目录**」
（[npm](https://www.npmjs.com/package/peterpren-feishu-codex-bridge)）。通用 bridge 则把 session scope 抽象为 `user | thread | single`（[channel-base](https://www.npmjs.com/package/@boryslav-golubiev/channel-base)）。

### A.3 已知副作用（这部分才是决策关键）

**（1）真实反向案例：Cursor 的「每条消息都开新 agent」被用户当 bug 报。**
Cursor 论坛有一个标题就叫 *"Slack Assistant pane: every message spawns a new cloud agent, with no way to follow up on an existing one"*：
> "every message I send inside a single assistant thread spawns a brand-new cloud agent instead of following up on the existing one. A single assistant thread with three of my messages produced three separate cloud agents... **Answer quality is not the problem.**"
> —— [Cursor forum #165947](https://forum.cursor.com/t/slack-assistant-pane-every-message-spawns-a-new-cloud-agent-with-no-way-to-follow-up-on-an-existing-one/165947)

**这是对我们方案最直接的警告。** 注意它的精确边界：用户抱怨的**不是**「@ 一次开一个现场」，而是
「**同一个现场内的后续消息也被当成新请求**」。**auto-thread 本身没被否定，被否定的是缺少 follow-up 归属**。
Cursor 正确的那一半设计（thread 内默认 follow-up、要并发必须显式说）恰好就是解药。

**（1b）自动线程化的产品级 backlash：GitHub 自家 Slack 集成专门做了关闭开关。**
GitHub for Slack 默认把 issue/PR 通知自动归入 thread，但提供 `/github settings` → **"Disable threading for pull request and issue notifications"，且可按频道单独关闭**
（[GitHub 官方文档](https://docs.github.com/fr/integrations/how-tos/slack/use-github-in-slack)），社区甚至有专门教程教人关掉它（[Qiita](https://qiita.com/savoury/items/60e0da570a5ca4418855)）。
**一个功能需要 per-channel kill switch，本身就是「有人被它惹毛了」的产品级证据。**

**（1c）飞书官方承认「话题群开太多会失败」——这是最贴近我们场景的一手证据。**
> 「最开始开通的话题群数量太多，人力有限，无法精细化运营每个话题群…最终导致所有话题群都用得不好」，
> 官方方案是「**先精细化运营 1 个话题群，跑通运营模式，再大范围普及**」
> —— [飞书 helpdesk·话题群实践与经验总结](https://helpdesk.feishu.cn/hc/zh-CN/articles/360049068004-%E8%AF%9D%E9%A2%98%E7%BE%A4%E5%AE%9E%E8%B7%B5%E4%B8%8E%E7%BB%8F%E9%AA%8C%E6%80%BB%E7%BB%93)

**直接推论：灰度上线（先一个答疑群跑通）是平台方自己给出的建议，不是保守，而是已被验证的必要步骤。**

**（1d）多 agent 同群的真实事故：agent 把彼此的输出当输入。**
中文实测记录了把多个 bot 放进同一飞书群的后果：三个 bot 因广播**同时抢同一任务**，且「Hermes A 处理完发回群里，Hermes B 看到结果以为是新任务又开始处理…死循环」，群被瞬间刷屏
（[AI 折腾日记](http://m.toutiao.com/group/7658213956678320683/)）。
CSCW 论文亦记录用户对 bot 刷屏的典型反应："Your bot has spammed the thread like ten times or more… Can you change it to only post once per thread?"
（[ACM DL](https://dl.acm.org/doi/pdf/10.1145/3025453.3025830)）。
**对我们**：话题内的 bot 消息必须严格来源过滤（本仓库 spec 263/298 行的 fail-closed 已覆盖此风险，拆话题后仍须保持）。

**（2）上下文碎片化有学术与产品双重证据。**
CSCW 研究观察到「keeping up with multiple threads of conversation」是群聊规模化的一致困难
（[Challenges of Online Group Chat at Scale](https://echolab.cs.vt.edu/wp-content/uploads/sites/105/2024/05/CSCW__20_Poster___Scalable_Chat__Copy_.pdf)）；
产品评测侧："Threads make it worse in their own way. **If you're not actively following one, you won't see what was said.**"
（[Slack Pros and Cons](https://www.workvivo.com/fr/internal-communications/slack-pros-cons/)）。
Slack 承认这一张力，故回复框下设 **"also send to channel" 勾选框**
（[Use threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions)）——
**这是「群 vs 话题」可见性矛盾的官方缓解手段，应当照抄：话题内关键结论回灌一条到群。**

**（3）「该在哪回复」的混淆已有标准解法。**
Moltbot 做成三档 reply mode：`off`（除非原消息已在 thread 否则回频道）/ `first`（首条进 thread，后续回频道）/ `all`（总在触发消息下开 thread），
并直言 "Slack threads are polarizing. Some teams live in them. Others ignore them."
（[Moltbot Slack 集成](https://lumadock.com/tutorials/moltbot-slack-integration?language=italian)）。
**启示：auto-thread 必须是每群可配的策略开关，不是全局硬编码。**

**（4）资源与写冲突：N 个话题 = N 个并发 agent 写同一 workspace。**
这是我们方案里**最硬的风险**，业界已统一到一个答案：**每 agent 一个 git worktree**。
> "We use git worktree to ensure that each engineer then works in **its own worktree** and modifies files only within that workspace."
> —— [Effective Strategies for Asynchronous Software Engineering Agents](https://arxiv.org/pdf/2603.21489)

它已被编入 AI 模式手册作为 **Worktree Isolation** 模式（[aipatternbook.com/worktree-isolation](https://aipatternbook.com/worktree-isolation)）；
失败模式很具体：silent file overwrites、stale context、**git lock 争用**（[Augment Code 指南](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)）。
商业产品用更重的隔离：Devin 每 session 一个云端 VM，Copilot 每次运行一仓库一分支一 PR（见上表）。

> **对 Pet Locus 的直接推论**：答疑群的话题 locus 如果只做**只读答疑**，N 并发无写冲突风险，可以放心并发；
> 一旦话题 locus 可以改代码，就**必须**先有 worktree 隔离，否则 N 并发 = N 倍数据损坏面。
> 本仓库已有 `source-workspace-worktree-session` spec 与 `ws` 工具，这条路径是现成的。

**（5）成本随并发线性增长，且长 thread 的 token 成本非线性。**
Cursor 的 Slack agent 会读整个 thread 作为背景，"线程越长，上下文消耗越大"
（[Cursor Slack 任务实践](https://blog.csdn.net/weixin_42593549/article/details/165282058)）。
**推测**：话题拆分在这一点上其实是**省钱**的——每个话题各自短上下文，好过一个群 locus 背着全群历史。

---

## B. 父会话争用：业界怎么解

### B.1 Claude Code cross-session messaging：明确「不打断」

这是与我们 `agent-message` inquiry 最接近的现成实现，官方语义非常清楚：

> "If that session is **idle**, Claude starts a new turn on it right away. If it is **mid-turn**, the message **waits until between tool calls**, so **a running command is never interrupted**."
> —— [Claude Code sessions that message each other](https://www.ssdnodes.com/learn/claude-code-sessions-message-each-other)（本环境 DNS 不可达，经搜索摘要）

官方文档补充：接收端在活跃 turn 中**于 tool call 之间**读取消息（[cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)）。

**三态由接收端配置决定**：`accept` 正常投递 / `hold` 暂存不投递直到用户批准 / `refuse` 直接拒绝（[中文解读](https://juejin.cn/post/7671566399079022632)）。
拒绝条件有三：超 size cap（**在发送端**拒绝，消息不离开发送方）、**对目标 session 的快速突发达到其 inbox 上限**（并提示发送方「合成一条或等待」）、回复目标未通过安全检查
（[control inbound messages](https://code.claude.com/docs/en/cross-session-messaging#control-inbound-messages)）。
另有一个可直接抄的原语：**「对方下次 idle 时给我一条通知」**——"send back one notice when that session **next goes idle or exits**. Idle here means the session finished a turn with nothing queued."（同上）

> **对问题 1 的三条硬结论**：
> 1. **业界共识是「不打断」**：inquiry 应当在父会话的 turn 间隙投递，而不是 steer 进当前 turn。这正面否定「子会话提问会打断开发者节奏」的必然性——**打断是实现选择，不是固有代价**。
> 2. **突发保护要在发送端做**，并且拒绝时要给出「合批或等待」的明确指令，而不是静默排队。
> 3. **「idle 通知」是比「轮询等待」更好的等待原语**：子会话先做能做的，父空闲再被唤醒。

### B.2 GitHub Copilot SDK 的双模 steering

| Mode | Behavior | Use case |
|---|---|---|
| `"immediate"`（steering） | 注入**当前** LLM turn | "Actually, don't create that file—use a different approach" |
| `"enqueue"`（默认，排队） | 排队，**当前 turn 结束后**处理 | "After this, also fix the tests" |

—— [Steering and queueing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/steering-and-queueing)、[Java SDK 文档](https://github.github.io/copilot-sdk-java/1.0.0-beta-10-java.0/documentation.html)（`enqueue` 为默认值）

**评估：这个双模设计能否解决父会话争用？能解决一半。**
它给了「不打断」的正确默认值（`enqueue`），但它**只区分时机，不区分优先级也不区分读/写**。
子会话的 inquiry 全是 `enqueue`，仍然会在父会话 turn 之间排成一条长队，开发者仍要一条条看着它们被应答。
**真正的解法必须叠加「优先级」与「读写分离」**，见 C 节。

### B.3 Agent SDK 的 subagent：默认根本不回头要上下文

Claude Agent SDK 的子代理是**单向、一次性**的：
> "Each subagent runs in its own **fresh conversation**. Intermediate tool calls and results stay inside the subagent; **only its final message returns to the parent**."
> —— [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents)

Claude Code 内部有两条 spawn 路径：**Fork**（不指定 `subagent_type`）给子代理**父的完整历史 + 相同 system prompt + 逐字节相同工具池**（为共享 prompt cache）；
另一条是隔离的全新上下文（[Multi-Agent Orchestration 逆向分析](https://y-agent.github.io/inside-claude-code/07-multi-agent-orchestration.html)）。
Anthropic 的 managed orchestration 同样强调 "Agents can act in parallel with **their own isolated context**"（[文档](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration)）。

微软 Copilot Studio 甚至把「是否传父上下文」做成显式开关，并说明了关掉的理由：
> "A subagent that receives the parent's conversation context can act on it. If that context contains **a request the parent hasn't yet answered**, the subagent might answer it, repeat something the parent already handled, or assume the wrong role."
> —— [Design subagents that avoid duplicate messages](https://learn.microsoft.com/ms-my/microsoft-copilot-studio/guidance/generative-orchestration-subagents)

> **关键发现**：**「子代理运行中向父代理反向索取上下文」在主流 SDK 里基本不存在。**
> 标准做法是**创建时单向传递足够的 prompt**（fork 全量 / 隔离 + 精心构造的 brief），运行中不回头。
> Pet Locus 的 inquiry 能力是**超出业界主流的设计**——这既是我们的差异化，也意味着**争用问题没有现成答案可抄，必须自己设计**（这一点本身「没找到」反例或先例）。
> 直接推论：**减少 inquiry 发生率，比优化 inquiry 调度更接近业界主流**。

### B.4 把父会话知识做成可并发读的快照

趋势明确，但**没找到**「对 LLM agent 会话状态做 MVCC 式快照读」的正式实现或论文。相邻证据：

- **共享选择性持久记忆**：保留任务规格/数据 schema/工具配置/输出约束四类可复用上下文，**丢弃 session 特有的推理轨迹**，可跨用户带 RBAC 转移 —— [arXiv](https://arxiv.org/pdf/2607.09493)
- **AWS "shared cross-agent memory" 状态面**：多 agent 读写的共同事实/任务记录存储，明确区别于 session memory 与向量语义记忆 —— [Agent memory systems](https://aws.amazon.com/marketplace/build-learn/ai-agent-learning-series/agent-memory-systems)
- **可搜索归档而非摘要**：「硬切窗口 + 结构化交接文档 + **完整旧对话归档不摘要、新窗口按需检索**」 —— [上下文管理全景](https://blog.csdn.net/abcefg_h/article/details/163592210)
- **Handoff 命名模式**：产物是双方都可检视的 externalized state —— [aipatternbook.com/handoff](https://aipatternbook.com/handoff/)
- **会话检索工具已存在**：Docker Agent 的 `list_sessions` / `read_session` 读取过往转录（**当前 session 永不可被自己读取**）—— [Session Context Tool](https://docs.docker.com/ai/docker-agent/tools/session_context/)；社区有只读扫描本地 agent 记录的 [agent-historian](https://www.npmjs.com/package/agent-historian)
- **反面约束**："Load on-demand: fetch reference material **when the task requires it, not at startup**" —— [The Infinite Context 反模式](https://www.agentpatterns.ai/anti-patterns/infinite-context/)

> **综合**：把父会话做成「只读可检索物化视图」在技术上完全可行，Docker 的 `read_session` 就是现成证明；
> 但它**不能覆盖全部 inquiry**——需要父**推理**（"这个设计当初为什么这么定？"）的问题无法靠检索回答。
> 所以它是**降载手段**而非替代品。**推测**：按本仓库 QA 场景，多数 inquiry 是事实型（路径、锚点、约束），检索可吃掉大部分。

### B.5 人类协作类比：「专家成为瓶颈」

| 方案 | 机制 | 来源 |
|---|---|---|
| **Office hours 批处理** | 固定窗口集中答疑（如每日 11:00–12:00），窗口外 async，「otherwise async via Slack or I'll respond by end of day」 | [Context Switching Time Audit](https://ruchitsuthar.com/blog/developer-productivity/hidden-cost-context-switching-time-audit/) |
| **Handbook-first / Document Answers** | GitLab 内部沟通四原则含 "Async First"、"Public Over Private"、**"Document Answers: Add Q&As to the handbook immediately"**；并按 Tier 定义响应时限（Tier 1 24h / Tier 2 3d / Tier 3 1w） | [GitLab handbook](https://gitlab.com/gitlab-com/content-sites/handbook/-/blob/c309ee909f3b6c5a00b7afdff450400cb535071d/content/handbook/communication/internal/_index.md) |
| **先搜再问 / 别问能不能问** | "Don't ask to ask, just ask"——把「有人在吗」换成直接给出完整问题，消除一个无谓 round-trip | [dontasktoask.com](https://dontasktoask.com/) |
| **Maker vs manager schedule / 保护块** | 深度工作块内 DND 默认开启，**urgent flags bypass**——即「默认静音 + 优先级穿透」 | [Deep Work Schedules](https://pandev-metrics.com/docs/blog/deep-work-schedules-developers) |

> **最可移植的三条**：(a) **Tier 化响应时限**——inquiry 不是都要立刻答；(b) **Document Answers**——答过的 inquiry 沉淀成可检索资料，等价于 B.4；
> (c) **默认静音 + urgent bypass**——正是 C.4 的优先级设计在人类侧的同构。

---

## C. 串并行调度理论

### C.1 Head-of-line blocking：问题 2 的标准名称与标准解

问题 2 就是教科书级的 **HOL blocking**。HTTP/2 在应用层做了多路复用但阻塞下沉到传输层——**规范自认**：
> "Note, however, that **TCP head-of-line blocking is not addressed by this protocol**." —— [RFC 9113 §1](https://httpwg.org/specs/rfc9113.html)

HTTP/3 换到 QUIC 才真正解决。RFC 9114 措辞：
> "Each request-response pair consumes a single QUIC stream. **Streams are independent of each other, so one stream that is blocked or suffers packet loss does not prevent progress on other streams.**"
> —— [RFC 9114 §](https://httpwg.org/specs/rfc9114.html)

**教训：只在上层拆逻辑通道是不够的，必须让下层的"资源单元"也真正独立。**
对应到我们：只把群拆成 N 个话题队列，如果 N 个话题**仍然共用同一个串行父会话**，HOL 只是从「群队列」搬到了「父会话队列」——
**这正是问题 1 和问题 2 的耦合点，也是本调研最重要的判断。**

### C.2 「同 key 串行、跨 key 并发」——与我们高度同构的两个工业实现

**Kafka partition key**：
> "Kafka guarantees message ordering **within a partition** but not across partitions. Therefore, if message ordering is important, select a partition key that ensures related messages are routed to the same partition."
> —— [Confluent: What is a Partition Key?](https://www.confluent.io/ko-kr/learn/kafka-partition-key/)

关键约束：**消费者组的并发度上限 = 分区数**，「one partition can only be assigned to one consumer in a consumer group」
（[Red Hat Kafka tuning](https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/3.1/html/kafka_configuration_tuning/con-consumer-config-properties-str)）。
**直接映射：话题数 = 分区数 = 并发上限。话题太少则并发不足，话题太多则资源爆炸——分片粒度就是这个权衡本身。**

**SQS FIFO MessageGroupId**：
> "In FIFO queues, messages are ordered based on their message group ID... Within a message group ID, all messages are sent and received in strict order. **Messages with different message group IDs may arrive out of order** [i.e. 可并行]."
> —— [AWS FIFO delivery logic](https://docs.aws.amazon.com/he_il/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html)

AWS 更把「并发度 = 组数」写死进了 Lambda 事件源：
> "For FIFO queues, concurrent invocations are capped either by the **number of message group IDs** or the maximum concurrency setting—**whichever is lower**."
> —— [SQS event source scaling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)

代价明示：默认 FIFO 每 partition 300 TPS/API，high throughput mode 可到 30k TPS，但**「放宽消息组内的顺序要求」**
（[SQS 队列类型](https://docs.aws.amazon.com/zh_cn/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html)）。**天下没有免费并发：要更高吞吐就得交出一部分顺序保证。**

> **⚠️ 一条必须避开的官方坑：热点组会饿死其他组。**
> SQS FIFO 只扫描前 **120,000** 条在途消息来发现可用 message group，
> **单个 group 堆积过大会占满扫描窗口，把其他 group 一起饿死**
> （[Avoid large backlogs with the same message group ID](https://docs.aws.amazon.com/en_en/AWSSimpleQueueService/latest/SQSDeveloperGuide/avoid-backlog-with-the-same-message-group-id.html)）。
> **注意 120,000 是 SQS 特定实现数字，不是普适规律；可迁移的是机制**——热点 key 会吃掉其他 key 所需的发现预算。
> **直接映射**：拆成 N 个话题 locus 后，若某话题长期堆积（或某 child 卡死），不能让它吃掉全局 child session / 并发预算。
> **结论：必须给单话题设独立配额上限，而不是只设全局上限。**

同族模式：Akka Cluster Sharding 保证「每 entity identity 全集群唯一实例」从而无需并发原语（[Lightbend](https://www.lightbend.com/blog/the-database-is-the-bottleneck)）；
Temporal 用确定性 Workflow ID（`alert-{fingerprint}-{route}-{app}`）把「ID 本身当路由层」，同 ID 天然串行（[groundcover](https://temporal.io/blog/how-groundcover-built-a-durable-alert-dispatch-system-with-temporal)）。

> **结论：Pet Locus「同话题串行、跨话题并发」是 Kafka/SQS/Akka/Temporal 四家共同验证的主流模式，架构方向正确，无需犹豫。
> 需要谨慎的只有两点：分片键的选择（= 话题粒度）与分片数的上限（= 并发与成本上限）。**

### C.3 读写分离：父会话能否「读并发、写独占」

PostgreSQL MVCC 的核心承诺：
> "each SQL statement sees **a snapshot of data**... MVCC, by eschewing the locking methodologies of traditional database systems, minimizes lock contention"，且读取时 "**The reader never needs to acquire a lock on the tuple**"
> —— [PostgreSQL 13.1 MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html)、[MVCC deep dive](https://www.praneshnikhar.site/posts/postgres-mvcc/)

**这正是我们要的语义，而且它在我们的场景里有天然的类型区分：**

| 操作 | 本质 | 是否需要父会话「跑起来」 | 可否并发 |
|---|---|---|---|
| 读父会话**历史上下文**（"上次定的锚点是什么"） | **读** | 否——历史是已落盘的不可变事实 | **可以完全并发**，零争用 |
| 让父会话**推理/决策**（"这个改法你同意吗"） | **写**（消耗父的 turn） | 是 | 必须串行独占 |

> **这是本调研对问题 1 的核心判断**：今天 Pet Locus 把两者都压成了同一个 `agent-message` inquiry，
> 于是**本可以零成本并发的「读」被迫排进了独占的「写」队列**。
> 分开之后，父会话的争用负载**只剩下真正需要父推理的那一小部分**。
> 可行性已被 Docker 的 `list_sessions` / `read_session`（B.4）与 Orleans `[ReadOnly]`（C.5）双重证明。
> **我们其实不需要完整 MVCC：会话历史是 append-only 的，天然就是不可变快照，读它甚至不需要版本管理。**

**学术侧有新兴工作，但需自行核验。** 有预印本明确主张「多 agent 系统的失败**根本上是并发控制问题**」，
把常被归因于「协作/沟通崩溃」的失败模式直接映射到经典并发异常，并引用 MVCC 与 Snapshot Isolation；
相邻工作还有 CoAgent（MTPO 协议：固定序列化顺序 + 推测性写 + saga 式撤销）、ChronoMem（commit-on-write 快照 + HEAD 指针用于 agent memory 回滚）。
**⚠️ 但这些 arXiv 编号（2606/2607/2608 区间）本环境无法直连核验，且编号落在异常月份区间——引用前必须二次核验编号与作者是否真实存在。本报告不将其作为决策依据。**

### C.4 优先级反转：问题 1 的精确命名

开发者本人（高优先级）被答疑 inquiry（低优先级）阻塞在父会话（共享资源）上，这是标准的**优先级反转**。
经典案例是 1997 年 Mars Pathfinder：低优先级气象任务持有信息总线互斥量，中优先级通信任务抢占了它，
导致高优先级总线管理任务被无界阻塞、系统反复重启；JPL 用 18 小时复现，最终**上传补丁开启该互斥量的优先级继承**
（[kernel-internals.org](https://kernel-internals.org/sched/pi-mutexes/)、[embeddedsoft.net](https://www.embeddedsoft.net/priority-inversion-and-inheritance-in-rtos/)）。

两个标准协议：**PIP（优先级继承）**「将低优先级任务提升到被它阻塞的最高优先级任务的优先级，退出临界区时恢复」；**PCP（优先级天花板）**给资源预设天花板优先级
（[讲义](https://advembsof.isc.heia-fr.ch/lecture/cours.08.Scheduling-PriorityInversion.pdf)）。

Actor 世界的对应物是**优先级邮箱**：Akka 的 `UnboundedControlAwareMailbox` 「以更高优先级投递 `ControlMessage`」，底层用两个队列实现
（[Akka Mailboxes](https://doc.akka.io/libraries/akka/snapshot/typed/mailboxes.html)）。
Erlang 的 selective receive 可「处理邮箱第三条而把前两条留在原地」，但有明确警告：**它是 Erlang 系统性能退化的头号原因**——邮箱十万条时不匹配的 receive 会扫描全部
（[Erlang Mailbox](https://www.cosmiclearn.com/erlang/mailbox.php)）。

> **对我们**：父会话的 inbox 应当是**双队列 control-aware mailbox**——开发者 GUI 输入走高优先级道，子会话 inquiry 走低优先级道。
> 并且要吸取 Erlang 的教训：**用双队列（O(1)）而不是扫描式选择接收（O(n)）**。
> PIP 的对应物则是：**当某条 inquiry 阻塞了一个高优先级 Delivery（如 SLA 将到期的用户请求）时，临时提升该 inquiry 的优先级**，避免无界等待。

### C.5 Actor 热点的标准解法

- **Stateless Worker grain（Orleans）**：「普通 grain 身份全集群至多一个激活，**stateless worker 身份可有多个激活**」，繁忙时运行时自动增建，单 silo 上限默认 = CPU 核数（可用 `maxLocalWorkers` 指定）。官方列出的适用场景第一条就是 **"Scaled-out hot cache items"** —— [Stateless worker grains](https://learn.microsoft.com/EN-US/dotnet/orleans/grains/stateless-worker-grains)、[Grain placement](https://dotnet.github.io/orleans/docs/grains/grain-placement/)
- **`[ReadOnly]` 请求调度（Orleans）——actor 版读写锁，与方案 1 直接同构**：grain 默认非重入（串行），但标记 `[ReadOnly]` 的**只读方法可与其他只读方法交错执行**；另有 `[Reentrant]`、`[AlwaysInterleave]`、`[MayInterleave]` —— [Request scheduling](https://learn.microsoft.com/en-us/dotNET/orleans/grains/request-scheduling)。**这证明「读读并行、遇写串行」在 actor 体系里是一等公民机制，不是我们的独创。**
- **Sharding**：Akka 用集群分片支撑数百万 entity，每 identity 唯一实例 —— [Lightbend](https://www.lightbend.com/blog/the-database-is-the-bottleneck)
- **避免阻塞调用**：Akka 明确警告 "blocking calls have a **ripple effect** tying up resources across multiple clusters... A single operation can tie up multiple threads" —— [Akka Cell-Based Architecture Guide](https://akka.io/hubfs/collateral/technical-documents/akka-cell-based-architecture-guide.pdf)

> **Stateless Worker 是 B.4「只读副本」在 actor 世界的正式对应物**：无状态 → 可任意复制 → 并发无争用。
> 父会话的**只读历史**恰好满足「无状态」——它是不可变数据，天然可被 N 个 child 并发读取。

### C.6 Little's Law、Kingman 公式与背压

**Little's Law（L = λW）的工程推论**：
> "at a fixed throughput λ, **bounding queue length L strictly bounds latency W** — and vice versa. So a bounded queue is not just OOM protection but a way to set an upper bound on latency: want a predictable tail — bound L and shed the excess."
> —— [Backpressure and Flow Control](https://system-design.space/en/chapter/backpressure-flow-control/)（同页提及 Netflix concurrency-limits）

**什么时候该加并发而不是优化单次速度**——Kingman 公式（VUT）给出定量答案：
等待时间 ≈ **V（变异性）× ρ/(1−ρ)（利用率因子）× S（服务时间）**
（[Kingman's formula](https://steinacker.name/articles/kingmans-formula/)、[Queuing Theory](https://hongyu.nl/queuing/)）。
利用率因子是**双曲线**的：低利用率时近乎平坦，逼近容量时爆炸式增长
（[The Utilization-Delay Curve](https://www.capabilitygraph.com/operations-research/queueing/utilization-delay-curve)）。

> **定量判据（对问题 2 的直接回答）**：
> 答疑群一个独占队列意味着 ρ 逼近 1，此时 W 不是线性变差而是**爆炸**。
> 在 ρ→1 区间，**把 S 优化 2 倍换来的收益远小于把 c 从 1 提到 N**——因为 ρ = λS/c，增加 c 是直接把工作点推离双曲线的爆炸段。
> **所以「拆成 N 个话题队列」在排队论上是比「让单个请求跑得更快」正确得多的投资。这是支持我们方案的最强定量论据。**
> 同时 Kingman 提醒：**V（变异性）也是乘性因子**——agent 请求的服务时间方差极大（30 秒 vs 30 分钟），
> 这进一步放大了单队列的等待，也进一步加强了拆队列的理由。

**但必须诚实记录一条反向论据——pooling 效应。**
排队论同时指出：「**1 条共享队列喂 c 个服务台** ≫ **c 条独立队列各喂 1 个服务台**」——
"pooling servers reduces wait time far more than adding the same capacity in isolated queues"
（[Queueing Foundations](https://www.capabilitygraph.com/operations-research/queueing/foundations)；M/M/c vs c×M/M/1 的对比见 [M/M/1 vs M/M/c](https://metricgate.com/blogs/queueing-theory-mm1-mmc-models/)）。
即：方案 3 把群拆成 N 个**独立**话题队列，在纯等待时间上其实**劣于**「一个群队列 + N 个 worker」（= 方案 4）。

> **那为什么仍然推荐方案 3？** 因为我们买的不是最优等待时间，而是三样东西：
> **① 顺序与归属正确性**（同话题串行 = `pet_locus_finish` 能靠唯一 current 解析目标，不破坏 spec 181/325 的不变量）；
> **② IM 层的可见性隔离**（用户看得见自己的请求在哪）；**③ 上下文不互相污染**。
> 这笔交易必须是**有意为之**，不能假装方案 3 在排队论上也最优——它不是。
> **推测**：答疑场景下请求量不大（个位数并发），pooling 损失远小于正确性与可见性收益。

**实操判据（该动哪个参数）**：
- **ρ 低（<0.7）但 W 高** → 服务时间 S 本身太长，去优化单次处理，别加并发。
- **ρ 高（→1）** → 先加并发度 c；此时 S 砍半的收益远不如 c 翻倍。
- **ρ 中等但 p99 炸** → 问题在 Kingman 的**波动项**，去削峰或压缩服务时间方差。

注意 **Little's Law 是恒等式不是因果模型**：它只说 L、λ、W 三者互相约束，**不告诉你该动哪个**——该动哪个由 ρ 决定。

**背压与准入控制的标准策略**：Google SRE 的 load shedding——「当负载开始超过容量时，让组件对**超额请求返回错误**而不是崩溃」，
因为崩溃会让**全部**容量不可用而不只是超额部分（[Building Secure and Reliable Systems ch.8](https://google.github.io/building-secure-and-reliable-systems/raw/ch08.html)、
[CRE life lessons](https://cloud.google.com/blog/products/gcp/using-load-shedding-to-survive-a-success-disaster-cre-life-lessons)）。
配套是**显式优先级分层**：`CRITICAL_PLUS / CRITICAL / SHEDDABLE_PLUS / SHEDDABLE`，从最低层开始丢弃，在入口打标并沿 RPC 传播
（[Graceful Degradation](https://sujeet.pro/articles/graceful-degradation)）。
队列侧则有 CoDel：用滑动窗口内的**最小排队延迟**判断「坏队列」，无需配置
（[IETF CoDel](https://www.ietf.org/blog/codel-improved-networking-through-adaptively-managed-router-queues/)）。

**Adaptive LIFO（Facebook，最经典表述）**——队列满时该丢谁的反直觉答案：
> "During normal operating conditions, requests are processed in **FIFO** order, but **when a queue is starting to form, the server switches to LIFO mode**. Adaptive LIFO and CoDel play nicely together — CoDel sets short timeouts, preventing long queues from building up, and adaptive LIFO places new requests at the front of the queue, maximizing the chance they will meet the deadline set by CoDel."
> —— Ben Maurer, ["Fail at Scale", CACM 58(11)](https://cacm.acm.org/practice/fail-at-scale/)

直觉：队列已形成时，队头的老请求**大概率提问者已经放弃或重新问过了**，处理它是纯浪费。
AWS 同样建议「给请求在队列中的停留时间设上界，**太老就直接丢弃**」（[Using load shedding to avoid overload](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/product-categories/developer-tools/approved/pdfs/using-load-shedding-to-avoid-overload.pdf)）。

> **注意我们已有的正确设计**：spec 第 331 行「超过 `acceptedAt + 24h` 的 backlog SHALL 在投递前直接过期」
> 本质上就是**基于年龄的 load shedding**，方向正确但 **24h 太长**——按 CoDel 思路应当**按驻留时延而非绝对年龄**动态判断。
> **⚠️ 但 Adaptive LIFO 不能照搬到答疑场景。** CACM 的前提是**客户端有自动超时与重试**——队头老请求「已经没人要了」。
> IM 答疑**没有自动重试**：一条 30 分钟的老问题背后可能仍有真人在等。
> **因此 LIFO 与按驻留时延丢弃都必须以「明确的放弃信号」为门控**（话题被关闭、提问者已在别处得到答复、被后续消息取代），
> **而不能仅凭停留时间**——否则会静默丢弃用户仍然在意的问题。
> **可安全采用的部分**：CoDel 式「按驻留时延**告警与降级**」（例如提前告知排队位次），以及在确有放弃信号时才跳过。

---

## D. 候选方案

### 方案 1：inquiry 读写分离 —— 只读上下文检索工具 + 真·提问降级为少数

**机制**：给 child 增加一个**只读**的 `pet_parent_context_search`（或直接 `read_session` 式转录检索），
可并发、无锁、不消耗父的 turn，读取父会话已落盘历史与已确认锚点。
只有检索无法回答、确实需要父**推理或授权**的问题，才降级为现有的 `agent-message` inquiry。
可配合「答过的 inquiry 自动沉淀为可检索 FAQ 条目」（= GitLab "Document Answers"）。

- **解决**：**问题 1（主要）**。把父会话负载从「所有 inquiry」削到「需要推理的 inquiry」。
- **复杂度**：中。需要会话转录的只读索引与权限边界（不能跨 locus 泄漏兄弟 child 历史——spec 265 行已禁止）。
- **风险**：检索结果可能过时或被误当作授权（spec 261 行已明确「主会话回复只是对话事实，不构成持久授权」，只读检索必须继承同一约束）；索引质量差会让模型退回提问，白做。
  **⚠️ 关键实现约束**：Orleans 在同一份文档里警告 grain 默认非重入、**调用环（A→B→C→A）会死锁**（[Request scheduling](https://learn.microsoft.com/en-us/dotNET/orleans/grains/request-scheduling)）。
  **因此读路径必须是纯数据读取（直接读已落盘转录/索引），绝不能重新进入父会话去「问一下」**——否则读路径会退化成写路径并可能成环。这是方案 1 成立与否的分界线。
- **先例**：[Docker `list_sessions`/`read_session`](https://docs.docker.com/ai/docker-agent/tools/session_context/)、[agent-historian](https://www.npmjs.com/package/agent-historian)、[PostgreSQL MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html)、[Orleans Stateless Worker](https://learn.microsoft.com/ar-sa/%20dotnet/orleans/grains/grains/stateless-worker-grains)、[GitLab Document Answers](https://gitlab.com/gitlab-com/content-sites/handbook/-/blob/c309ee909f3b6c5a00b7afdff450400cb535071d/content/handbook/communication/internal/_index.md)

### 方案 2：父会话 control-aware 双队列邮箱 + idle 投递 + 优先级继承

**机制**：父会话 inbox 拆成两条道：**高优先级**（开发者 GUI 输入、SLA 临期的 inquiry）与**低优先级**（普通 child inquiry）。
低优先级消息**只在父 turn 之间**投递（绝不 steer 进当前 turn），并提供「父下次 idle 时唤醒我」的通知原语。
叠加 PIP：当某条 inquiry 阻塞的 Delivery 接近 deadline，临时提升其优先级。

- **解决**：**问题 1**。直接消除优先级反转与「打断开发者节奏」。
- **复杂度**：中低。本质是 Host 侧的投递调度，`agent-message` 语义不变（spec 263 行的「不参与 Delivery 路由」不受影响）。
- **风险**：低优先级 inquiry 可能**饥饿**（父长期忙）——必须配合 deadline 兜底（spec 331 行已有）与老化提升；双队列增加 Host 状态机复杂度。
- **先例**：[Akka ControlAwareMailbox](https://doc.akka.io/libraries/akka/snapshot/typed/mailboxes.html)、[Claude Code「mid-turn 时等到 tool call 之间，绝不打断运行中的命令」+ idle 通知](https://code.claude.com/docs/en/cross-session-messaging)、[Copilot SDK `enqueue` 为默认](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/steering-and-queueing)、[PIP](https://advembsof.isc.heia-fr.ch/lecture/cours.08.Scheduling-PriorityInversion.pdf)

### 方案 3：答疑群 auto-thread per request（原设想），但补齐三个必要条件

**机制**：Host 对**配置为答疑模式的群**，对每条 @ bot 消息调用 `reply_in_thread=true` 自动建话题 locus。
**必须同时满足三条**，否则不要上：
1. **follow-up 归属明确**：话题内后续消息默认是 follow-up（不新建 locus）；要并发必须显式语义（照抄 Cursor 的 `@Cursor agent [prompt]`）。**这是 Cursor 被投诉的那个 bug 的解药。** 进一步可照抄 Cursor 的 **`Team follow-ups` 开关**（关闭时只有发起者能插话），同时解决「误起新 session」与「别人打断我的任务」。
2. **生命周期回收 + 群内锚点**：话题创建时在群里留一行「已为 X 的问题开话题」，结论回灌群（Slack "also send to channel"）；**空闲超时自动收敛 + 完成后归档仍可搜索**（Slack Code 的三重回收）。**缺此项即为 channel sprawl 加速器。**
3. **每群可配的策略开关 + 显式逃逸关键字**：`off / first / all` 三档不做全局硬编码（Moltbot）；并提供 `!new` / `mute` 一类用户显式控制（Devin）。

- **解决**：**问题 2**。把群级单队列拆成 N 个独立队列，消除 HOL blocking。
- **复杂度**：中。飞书 API 已就绪（`reply_in_thread=true`），本仓库已有话题 locus 与 `pet-group-quote-reply-entry` 相关 change。
- **风险**：话题爆炸与上下文碎片化（有 CSCW 与产品双重证据）；**若话题 locus 可写代码则必须先做 worktree 隔离**；成本随并发线性增长；需要话题数上限 + 空闲自动收敛。
- **先例**：[Slack Code channels（自动建临时频道 + 自动归档）](https://slack.com/intl/fr-fr/features/code-channels)、[飞书 Aily「在原消息中创建话题并回复」渠道开关](https://bytedance.larkoffice.com/wiki/J3KLwSn36iTAg6kVg4vcpO6bnib)、[OpenClaw `autoThread`](https://zhixian.io/en/posts/agent-trainer-discord-guide/)、[Moltbot 三档 reply mode](https://lumadock.com/tutorials/moltbot-slack-integration?language=italian)、**反面**：[Cursor forum #165947](https://forum.cursor.com/t/slack-assistant-pane-every-message-spawns-a-new-cloud-agent-with-no-way-to-follow-up-on-an-existing-one/165947)

### 方案 4：群级队列有界并发（不拆话题，把 c 从 1 提到 k）

**机制**：不改 IM 形态，只把群 locus 的「至多一个 current」放宽为「至多 k 个 current」（k 可配，如 3），每个 current 仍绑各自触发 `messageId` 回复。

- **解决**：**问题 2**。ρ = λS/c，c 从 1 到 k 直接把工作点推离 Kingman 双曲线爆炸段。
- **复杂度**：**高**。spec 181/325 行的「至多一个 current」是当前并发正确性的**核心不变量**，多处 fail-closed 逻辑（263、298 行）依赖「唯一 current」来解析 `pet_locus_finish` 的不可变目标。放宽它需要重做目标解析。
- **风险**：**最高**。同一 child session 并发处理多请求会导致上下文互相污染；`pet_locus_finish` 无法再靠「唯一 current」推断目标。若改为 k 个 child session，则与方案 3 的资源代价相同却**失去了 IM 层的可见性隔离**。
- **先例**：[Kafka 消费者组并发度 = 分区数](https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/3.1/html/kafka_configuration_tuning/con-consumer-config-properties-str)、[SQS FIFO high throughput mode（代价：放宽组内顺序）](https://docs.aws.amazon.com/zh_cn/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html)
- **判断**：**不推荐**。方案 3 用同样的并发收益换取了更低的不变量破坏成本——话题天然就是分片键，而 k 路并发要凭空造一个。

### 方案 5：准入控制与背压（配套，非独立解）

**机制**：入口处显式优先级打标（开发者 / 高优先级用户 / 普通答疑）；队列超阈值时**快速失败并如实告知**（"前面还有 N 个请求，预计 M 分钟"）而非静默排队；
CoDel 式基于排队延迟动态判断过载；话题并发数达上限时拒绝开新话题并降级回群队列。

- **解决**：**问题 1 与 2 的尾部风险**（不解决平均情况）。
- **复杂度**：低。spec 331 行的 24h 过期已是雏形。
- **风险**：拒绝体验差；阈值需实测调参。
- **先例**：[Google SRE load shedding](https://google.github.io/building-secure-and-reliable-systems/raw/ch08.html)、[criticality 分层](https://sujeet.pro/articles/graceful-degradation)、[CoDel](https://www.ietf.org/blog/codel-improved-networking-through-adaptively-managed-router-queues/)、[Claude Code 突发拒绝并提示「合批或等待」](https://code.claude.com/docs/en/cross-session-messaging#control-inbound-messages)

---

## 方案候选对比表

| # | 方案 | 解决问题 | 复杂度 | 主要风险 | 业界先例 | 建议 |
|---|---|---|---|---|---|---|
| 1 | **inquiry 读写分离**：只读父上下文检索 + 真·提问降级 | **问题 1**（根因） | 中 | 索引过时；只读结果被误当授权 | [Docker read_session](https://docs.docker.com/ai/docker-agent/tools/session_context/)、[MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html)、[Orleans StatelessWorker](https://dotnet.github.io/orleans/docs/grains/grain-placement/) | **最高优先级**。唯一从根因削减父负载的方案 |
| 2 | **control-aware 双队列 + idle 投递 + PIP** | **问题 1** | 中低 | 低优先级饥饿（需老化/deadline 兜底） | [Akka mailbox](https://doc.akka.io/libraries/akka/snapshot/typed/mailboxes.html)、[Claude Code 不打断语义](https://code.claude.com/docs/en/cross-session-messaging)、[Copilot enqueue 默认](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/steering-and-queueing) | **与 1 同期做**。1 削总量，2 管调度 |
| 3 | **auto-thread per request**（+ follow-up 归属 + 群内锚点/归档 + 每群开关） | **问题 2** | 中 | 话题爆炸；上下文碎片化；**可写场景须先有 worktree 隔离**；N 倍成本 | [Slack Code](https://slack.com/intl/fr-fr/features/code-channels)、[飞书 Aily 渠道开关](https://bytedance.larkoffice.com/wiki/J3KLwSn36iTAg6kVg4vcpO6bnib)、[OpenClaw autoThread](https://zhixian.io/en/posts/agent-trainer-discord-guide/)；反面[Cursor #165947](https://forum.cursor.com/t/slack-assistant-pane-every-message-spawns-a-new-cloud-agent-with-no-way-to-follow-up-on-an-existing-one/165947) | **推荐，但三个前置条件缺一不可**；先在答疑群灰度 |
| 4 | **群队列 k 路并发**（放宽「至多一个 current」） | 问题 2 | **高** | 破坏核心不变量；`pet_locus_finish` 目标解析失效；上下文污染 | [Kafka 分区并发上限](https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/3.1/html/kafka_configuration_tuning/con-consumer-config-properties-str)、[SQS 高吞吐模式](https://docs.aws.amazon.com/zh_cn/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html) | **不推荐**。收益同方案 3，代价高得多 |
| 5 | **准入控制与背压**（优先级打标 / 快速失败 / CoDel / 话题数上限） | 1、2 的**尾部** | 低 | 拒绝体验差；阈值需调参 | [Google SRE load shedding](https://google.github.io/building-secure-and-reliable-systems/raw/ch08.html)、[CoDel](https://www.ietf.org/blog/codel-improved-networking-through-adaptively-managed-router-queues/) | **作为 1–3 的配套**，不单独成立 |

### 落地顺序建议

**1 → 2 → 5 → 3**。理由：方案 3（拆话题）会**同时放大**父会话争用——N 个话题 = N 个 child = N 倍 inquiry 涌向同一个父会话。
按 C.1 的 HTTP/2 教训，**只拆上层逻辑通道而下层资源仍独占，HOL 只是从群队列搬到了父会话队列**。
因此必须**先做 1 和 2 把父会话从争用点上解下来，再拆话题**，否则问题 2 的解法会把问题 1 恶化到比现在更糟。

### 明确「没找到」的部分

- **没找到**指名道姓、完整的「我们上线 auto-thread 后又整体关掉」团队复盘。现有反向证据是**间接但有力**的三条：GitHub 为自动线程化提供 per-channel 关闭开关（[docs](https://docs.github.com/fr/integrations/how-tos/slack/use-github-in-slack)）、飞书官方承认话题群开太多导致全面失败（[helpdesk](https://helpdesk.feishu.cn/hc/zh-CN/articles/360049068004-%E8%AF%9D%E9%A2%98%E7%BE%A4%E5%AE%9E%E8%B7%B5%E4%B8%8E%E7%BB%8F%E9%AA%8C%E6%80%BB%E7%BB%93)）、Cursor 论坛把 follow-up 归属缺失当 bug（[#165947](https://forum.cursor.com/t/slack-assistant-pane-every-message-spawns-a-new-cloud-agent-with-no-way-to-follow-up-on-an-existing-one/165947)）。
- **没找到** Devin / Cursor / Claude Tag 在「同一 thread 内同时收到两条 @」时的确切行为（排队 vs 并行 vs 拒绝）；只有 Copilot 的 `CONVERSATION_BUSY` 是明确的。
- **没找到** Slack Code 对单 workspace 并发 code channel 数量的限制与真实用户规模反馈（功能较新，多为官方宣传材料），也没找到「自动归档」的精确触发条件（agent 声明完成 vs 无活动计时）与 7 天 sidebar 移除如何交互。
- **没找到**「auto-thread per request」的统一业界专名。注意 **"thread-per-request" 一词在软件工程中已被占用**（每请求一 OS 线程），其经典结论恰是「直觉上好用直到它崩」；建议内部改用 **session-per-thread** 或 **auto-thread-per-request** 以免术语碰撞。
- **没找到**已被公认、已落地的「MVCC-for-agent-state」成熟成果。存在若干 arXiv 预印本（见 C.3），但**编号无法在本环境核验且落在异常月份区间**，本报告不将其作为决策依据。工业侧可依赖的只有 Docker `read_session`、Orleans `[ReadOnly]` 这类既有机制。
- **没找到**主流 Agent SDK 中「子代理运行中向父代理反向索取上下文」的实现——主流是创建时单向传递（fork 全量或隔离 brief）。Pet Locus 的 inquiry 在这一点上超出业界主流，**争用问题没有现成答案可抄**。

### 来源可靠性说明

本次调研环境对 slack.com、docs.github.com、open.feishu.cn、code.claude.com、arxiv.org、httpwg.org、learn.microsoft.com、docs.aws.amazon.com 等大量域名 **DNS 不可达**（`web_fetch` 一律返回 non-public IP 错误），
全部引用来自 `web_search` 返回的这些权威页面的**内容快照**，链接本身指向原始权威 URL。

**因此的可靠性边界**：
- **可信**：被引用的精确字符串与专有名词（`CONVERSATION_BUSY`、`reply_in_thread`、`!new`、`[ReadOnly]`、`autoThread`、7 天 sidebar 移除、120,000 扫描窗口）——快照返回的是原文片段而非摘要。
- **不可信**：这些页面**其他位置是否另有前提或例外**，以及页面是否为最新版本。**「没有看到反例」不等于「不存在反例」。**
- **唯一显式存疑项**：C.3 提到的 arXiv 预印本编号，见该节标注。

本报告由 3 个调研线程并行完成（主线 + 2 个子代理），共执行约 45 次检索；跨线程冲突处已按更强证据改写并在文中标注。
