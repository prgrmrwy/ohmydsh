## Context

动机见 proposal.md，行为要求见 specs。本地数据现状如下（本机 2026-10-26 抽查，详见 review.md）：

| 来源 | 本报告如何使用 | 注意 |
|---|---|---|
| `state/auto-model-routing/allocation-feedback.jsonl` | 主要数据：policy-v2 绑定（每条 assistant 消息一行）和反馈，经 `FeedbackBook` 读取 | 早期行无 snapshot；同一决策可能跨多个 requestSeq |
| `state/auto-model-routing/judgements.jsonl` | 只读 `(sessionId, turn)`，用来确定首个 AUTO 记录的位置 | policy-v2 成为默认后（10-25 01:42）停止写入，固定为 152 行 |
| `state/auto-model-routing/sessions/<sha256(sessionId)>.json` | 当前模式，用于统计“AUTO 但无记录”的会话 | 不保存切换历史 |
| `sessions/<cwd 编码>/<sessionId>/session.v4.jsonl.zstd` | 会话头的 `origin`/`isSeeded`；`turn/start`、`user/message.source`、`request/header` config（用于推断参照组 effort）、`assistant/message.{turn,message.id,usage,surfaceOp}`、事件 `time` | 多帧 zstd；请求头不是每个回合都有 |

绑定条件见 `src/policy-host.ts` 162–195：回合内出现与推荐一致的请求头后，才对之后的 assistant 消息执行 `feedback.bind`。

## Goals / Non-Goals

**Goals:** 同一份数据重复运行时，输出字节一致；关联以消息 ID 为准，读取逻辑与插件运行时共用；口径错误能被合成样例测试发现；任何异常都不泄露正文或路径。

**Non-Goals:** GUI、Host 端点、写文件或保存快照、Markdown 输出、费用换算、legacy 时期用量统计（已由 10-24 手工统计与 `label-report.mjs` 覆盖）、子会话与 Jev 用量、补记未生效决策、因果结论。

## Decisions

### D1 作为插件源码 `src/usage-report.ts`，编译到 `lib/` 随包发布
运行方式：`node <pkg>/lib/usage-report.js [--since YYYY-MM-DD]`，输出 JSON。
- 和插件共用 `FeedbackBook`，避免另写一份“首个绑定不可替换、按顺序折叠反馈”的规则。若另写一份，`feedback.ts` 再次变化时，报告会悄悄与插件口径不一致。
- 交给现有 `tsc` 构建，有类型检查；`lib` 已在 `files` 中，不用单独维护发布清单。
- 它不会被 `index.ts` import，因此不会进入 Host 运行时。`content.test.ts` 现有的“相对 import 不出包”约束会自动覆盖它。
- 备选方案：沿用 `label-report.mjs` 那样的零依赖 `.mjs`。它更独立，但必须复制反馈读取逻辑，所以不采用。
- 代价：`FeedbackBook` 依赖 `zod`，所以 `node --permission` 测试需要同时允许读取 `zod` 所在目录；在本仓库中它被提升到了根目录 `node_modules`。

### D2 按 magic 切段，逐段解码
`zlib.zstdDecompressSync` 只解第一帧，因此需要先按 `28 b5 2f fd` 切段。只有最后一段失败时，计为 `tail-incomplete`；其余任何一段失败时，计为 `decode-failed`。不处理“帧内容恰好含 magic”的情况：本机抽查的 1133 个命中全部是真实帧起点；即使将来出现，结果也会显示为读取失败，而不是悄悄算错。此前设计的“向后扩展重试”规则因此删除。

### D3 关联
- policy-v2：先遍历日志中的 append 调用，对每次调用执行 `FeedbackBook.lookup(sessionId, messageId)`。命中的调用归入 `(sessionId, decisionId)`；账本中存在但日志里找不到的绑定，计为未关联。
- 不按 requestSeq 校验配置：绑定只在配置一致时才会写入，这项校验对带 snapshot 的行几乎恒真，对不带 snapshot 的行又无法完成。
- 会话内按 `message.id` 去重；子会话和 seeded 会话整体排除，因此不做跨会话去重。

### D4 参照组只看 effort 起点
分界是两个账本中最早一条记录所在的回合；legacy 的 turn 直接来自账本。这样可以把旧版 AUTO 时期（例如 f0 第 1–40 回合）排除在参照组外。参照调用的 effort 取“该调用之前最近一个请求头”的 config。参照组只输出调用数、会话数和 effort 分布，不输出 token：报告规定两组 token 不可比较，并排展示 token 只会诱导误读。

### D5 时间
`--since` 按本地时区当日 00:00 起算，包含该时刻；决策按首次关联调用的时间整体归属。不提供 `--until`：策略升级会自然产生新的版本组，旧数据会自动分组。

### D6 输出与隐私
- 只输出 JSON。`conclusion` 和 `caveats` 使用固定标识，由 skill 负责解释，并要求 agent 转述时保留它们的含义。
- 所有 `try/catch` 只返回固定类别，不保留 `err.message`。
- 报告不含会话标识。
- 键名和组名按顺序排序，保证输出字节一致。

### D7 测试
- 用代码在临时目录生成合成 `DSH_HOME`，覆盖：多帧日志、尾帧截断、中间帧损坏、replace、会话内重复 messageId、子会话、seeded 会话、无请求头的缺口回合、跨 requestSeq 决策、无 snapshot 行、legacy 记录在前的会话、反馈冲突与撤销、跨 `--since` 边界的决策（固定 `TZ`）、参照组为空、含 `SECRET-TEXT` 的正文与损坏行、敏感 cwd。
- 只读和访问范围用 `node --permission` 运行验证。由于 permission 模型不拦截网络，“不联网”另用静态扫描验证。
- 不提交任何真实日志。

## Risks / Trade-offs

- [policy-v2 记录是非随机子集] → `caveats` 固定说明，并给出无记录回合数；真正补记需要走方案 B，届时改用 anvil。
- [样本聚集] → 门槛同时要求决策数和会话数，并列出每决策调用数的中位数与最大值。
- [日志格式随 DSH 升级变化] → 读取失败按类别计数；skill 要求失败数或未关联数明显升高时，先停下来核对格式，不直接下结论。
- [`FeedbackBook` 语义变化] → 报告随插件一起更新，不会出现两份规则漂移；行为变化由插件自身测试覆盖。
- [用户删除旧会话日志后无法重算历史] → 已与用户确认不做快照；skill 写明这一前提。

## Migration Plan

只新增文件，不改运行时；随下一个插件版本发布。回滚方式：删除 skill 目录和 `src/usage-report.ts`，或直接禁用插件。脚本不产生任何持久文件。
