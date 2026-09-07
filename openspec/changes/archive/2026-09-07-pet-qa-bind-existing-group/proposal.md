# pet-qa-bind-existing-group Proposal

## Why

`pet-qa-group` 打通的是「从 DSH 出发」：在会话里点 Q&A，Pet 建一个新群把这段上下文
开放出去。但真实场景常常反过来——**群已经在那儿了**：一个项目群、一个协作群，讨论
到某个问题时，想让 bot 带着某段已有的排查上下文加入回答，而不是再拉一个新群、再把
人请一遍。

本 change 补上入站方向的绑定：在既有群里 `@bot /bind <会话前缀>`，把该群与一个已存在
的 DSH 会话关联，fork 出子代理，此后该群的提问与 `pet-qa-group` 完全同路——投递、
表情、失效、目录约束全部复用，不新增第二套语义。

## What Changes

- 新增 `/bind` 入站命令：`@bot /bind <前缀>`（≥6 位会话 id 前缀，与 UI 上的短 id
  徽章一致）。显式动词而非裸 token——绑定后群里正常聊天中出现的六位十六进制串
  不应被当成命令。
- **BREAKING（准入模型）** `/bind` 命令本身 MUST 仅由全局 allowlist 发送者触发：
  既有群的成员不是本人拉入的，`pet-qa-group` 赖以豁免 allowlist 的「成员即可信」
  前提在此不成立。绑定**成功之后**该群才继承 qa 的群成员提问权。
- 新增 1:1 不变量：**一个群至多绑一个会话，一个会话至多绑一个群**。任一侧已被占用
  即固定失败，判据是对应 scope 存在**未归档** Task；归档是解绑的正式手段。
- 前缀解析 fail closed 且**不泄露**：无匹配与多匹配返回同一句回执，不透露匹配数量，
  也不透露任何未命中会话的存在。
- `/bind` 建立的绑定与 Q&A 建立的绑定共用同一 `kind: qa` 行与全部下游链路，仅
  `boundBy` 与新增的来源标记不同：Pet 不是该群的创建者也不是群主，因此不承诺任何
  群管理能力（本能力也不需要）。
- 回执发在群内（群成员有权知道本群接入了 agent），并说明 child 以源会话最近一个
  完成 turn 为准。
- 明确不做：解绑命令（用归档）、跨群迁移、`/bind` 之外的任何斜杠命令、让非
  allowlist 成员发起绑定。

## Capabilities

### New Capabilities

- （无）本能力是 `pet-qa-group` 的入站入口，共用其全部模型与链路，不构成独立
  capability。

### Modified Capabilities

- `pet-qa-group`: ① 绑定来源新增「既有群 `/bind`」一途，与 Q&A 动作并列，且两者
  产出同一形态的绑定；② 建群 Requirement 的 1:1 约束由「每个源会话至多一个群」
  扩展为群、会话**双向** 1:1；③ 新增 `/bind` 的准入 Requirement（命令限 allowlist、
  绑定后群成员继承提问权）与前缀解析 Requirement（fail closed、不泄露）。
- `pet-lark-channel`: 入站判定新增命令识别一步——qa 绑定尚不存在的群，其
  `@bot /bind …` 消息 SHALL 被路由到绑定流程而非按未绑定丢弃；其余防线不变。

## Impact

- 代码：`packages/dsh-pet/`（host：`/bind` 命令解析、会话前缀解析器、绑定事务复用
  `createQaGroup` 的 fork 与写绑定部分但跳过建群、双向 1:1 校验、回执出站；
  channel：pipeline 在未绑定群上识别 `/bind`）。
- 数据：`chat_bindings` 复用现有 `kind: qa` 形态，新增一个来源标记字段区分
  「Pet 建群」与「绑定既有群」（加性，不改既有行）。
- 规范：`openspec/specs/pet-qa-group/spec.md` MODIFY；
  `openspec/specs/pet-lark-channel/spec.md` MODIFY。
- 不改：Q&A 动作与轮盘、投递/表情/失效/目录约束链路、非 qa 入站路径、
  provider 凭据边界。
