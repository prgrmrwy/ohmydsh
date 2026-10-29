# Design

## Context

见 proposal.md 的 Why。设计只受以下当前事实约束：

- 路由器当前是纯 skill（`dsh.yaml:196-200`，`type: skill`），**没有任何宿主钩子**。它能否被用到，完全取决于 skill catalog 里的 300 字符 description 是否被 agent 选中。对照 `auto-model-routing` 用的是 `ctx.on('agent/created')` 宿主事件（`packages/auto-model-routing/src/index.ts:43`），因此有 213 条记录。
- `dsh-openspec` 另有一条进程内路由契约（`packages/dsh-openspec/src/routing.ts`），但 `activeRoutingProviderId` 硬编码为 `'none'`（`index.ts:47`），spec 明确它是 contract-only、无 production caller、不向会话发布工具。本 change **不启用它**。
- 会话日志 `$DSH_HOME/sessions/<ws>/<session>/session.v4.jsonl.zstd` 是多帧 zstd 流，且 `tool/call` 与 `tool/result` 事件都带毫秒 `time`。实测同一 session 两份 classify 调用的 `call → result` 差为 1801ms 与 1698ms。
- Node 的 `zlib.zstdDecompressSync(buf)` 与 `createZstdDecompress()` **都只解首帧且不报错**（未使用 buffer：996364 字节压成 4.3MB，但只返回 218 字节）。逐帧切分（按 zstd magic `28 B5 2F FD`）后逐帧解压得到完整 4.3MB、418 帧全部成功。这让"多帧"不是理论风险而是当前就在发生的静默失败。
- 本机无 `zstd` CLI，因此 `scripts/jev-readiness.mjs:41` 与 `tests/jev-readiness.test.mjs` 的 fixture 都失效；`node --test tests/jev-readiness.test.mjs` 当前 1 个用例失败。

## Goals / Non-Goals

**Goals:**

- 让路由器从"零产出"变成每次决策点有实际作用的建议，且不给用户增加确认负担。
- 让延迟数据在**不改测量哲学**的前提下变得可信：用系统的真实时间戳，而不是 agent 自我计时。
- 修掉两个已知的静默失败：多帧只解首帧、超长延迟静默截断。

**Non-Goals:**

- 不新增宿主插件或事件钩子。本 change 只靠 skill + 环境指令接线；若实测仍有触发率问题，再另开 change 讨论插件化。
- 不自建 Jev 客户端或绕过 MCP 工具，不改变 `jevProvider`/凭据通道。
- 不引入新依赖：多帧解码用 Node 内置 `zlib`，不装 `@mongodb-js/zstd` 或类似包。
- 不让 recorder 自己去读会话日志（见 D3）。

## Decisions

### D1. advisory 走 skill + 环境指令接线，不做插件

**决定**：在 `instructions/dsh-home.md` 加一条触发规则，把"到达工作流决策点"从"碰巧想起"变成"规则要求"。路由器仍是 skill。

**理由**：插件化需要宿主钩子才能覆盖所有会话，但本 change 的核心问题是"没接线"而非"没有钩子能力"。环境指令是现有已生效的注入通道（`agent-instructions` 事件在本机出现 101 次），改造成本最低且可回滚。另外 `dsh-openspec` 的 routing 契约明确要求"不得向会话发布路由工具/指导直到批准"，本 change 只碰 skill 侧，不与之冲突。

**替代方案**：(a) 启用 `dsh-openspec` 的 routing provider —— 被否决，它硬编码 `none` 且 spec 要求单独 change 与真实 Pet/Locus 样本；(b) 写新插件挂 `agent/pre-step` —— 被否决，超出"修好现有能力"的范围，且 pre-step 外发需要更多边界证明。

### D2. advisory 只在确定性规则判完后才做，且只输出一行

**决定**：先按既有确定性规则算出 eligible 候选集与用户/change 的权威选择；有权威选择则直接跳过（零 Jev 调用）。无权威选择时才 classify，`formal-workflow` 且置信/差值达标时才 decide，最终输出一行中文建议 + 置信度 + "可无视"。

**理由**：这条保留了 Phase 1 最重要的不变量（确定性权威优先），只是把"结果不给你看"改成"给你看一行"。跳过条件写在规则里而不是依赖 agent 判断，可以让"用户已显式指定 → 0 次调用"变成可测断言。

**替代方案**：每次决策点无条件跑两次调用 —— 被否决，用户已指定流程时纯浪费 1.7s 且违背权威优先。

### D3. 延迟由 recorder 从会话事件日志计算，Agent 不再自我计时

**决定**：新增 `node recorder.mjs latency < observationId>` 子命令。它按 `DSH_SESSION_ID` 定位日志、解码、找出本次 observation 时间窗内的 `tool/call`/`tool/result` 对，按 `callId` 配对求差并求和，把结果回填到该记录。删除 SKILL 里"用 `node -e Date.now()` 取两次差"的规定。Agent 只负责在记录里留一个调用序号/时间窗。

**理由**：日志时间戳是系统打的，不受 agent 两侧模型往返污染；实测同一对调用，自我计时得 32095ms、日志得 1698ms，后者才接近 Jev 的实际 HTTP 往返。回填而不是让 agent 先测后写，避免了"agent 必须先知道结果才能写记录"的顺序矛盾。

**替代方案**：(a) 让 recorder 在 `record` 时自己读日志 —— 记录可能晚于日志 flush，且耦合更紧；(b) 继续用自我计时但只统计相邻 tool 调用 —— shell 例程本身的启动开销仍混在里面；(c) 在 MCP 侧埋点 —— 需要改 jev-mcp，越界。均否决。

### D4. 多帧解码用 Node 内置 zlib 逐帧切分，不用外部 CLI

**决定**：写一个共享的会话日志解码工具（`scripts/lib/session-log.mjs`），按 zstd magic 切帧后逐帧 `zstdDecompressSync`，合并结果。`jev-readiness.mjs`、recorder 的 `latency` 子命令、以及测试 fixture 都走它。

**理由**：本机无 `zstd` CLI 且 Node 的整缓冲/流式 API 都只解首帧，这是当前探针失效的直接原因。逐帧切分实测 418/418 成功。用内置 zlib 不增加依赖，符合仓库"不增依赖"惯例。

**替代方案**：(a) 装 `zstd` CLI —— 需要改 `host-prerequisites` 与用户机器，且 CI 环境未必有；(b) 装 npm 的 zstd 包 —— 新增原生依赖，构建成本高；(c) 让日志写成单帧 —— 那是 DSH core 行为，不在本仓控制范围内。

### D5. 超长延迟保留实测值并显式标记，不压平

**决定**：`normalizeLatency` 不再用 `finiteInteger(..., 0, 0, 60_000)` 把值压到 60000。改为保留实测整数，并加 `truncated: boolean`；仅当超出存储上限（`Number.MAX_SAFE_INTEGER` 以内合理区间）时置 `true`。

**理由**：无标识截断会让长尾审计失真，且历史上真实出现过 80057ms。本 change 的 spec 已要求"不静默截断"。

**替代方案**：直接不设上限 —— 会被畸形输入撑爆报告。折中是保留 + 标记。

### D6. 报告删覆盖门槛，保留三项持续健康指标

**决定**：报告保留 `providerFailureRate`、`mismatchRate`（建议 vs 实际路径）、`p50/p95`，删掉 `labelled>=100`、`distinctWorkingDays>=10`、`routeLabels>=15`、`highCostCategoryLabels>=10` 及 `phase2Admission` 的 `not-established` 汇总语义。零样本时三项标"样本不足"。

**理由**：这些门槛是为"要不要晋升 advisory"服务的，advisory 已被用户批准；保留它们只会让报告永远显示 `not-established`，掩盖真实健康度。历史 gate 文件保留为历史证据，不删。

**替代方案**：保留门槛但把结论改成 advisory —— 会造成同一个报告里既有"不可准入"又有"正在用"的自相矛盾，且仍要维护 100 条样本的打标流程。

## Risks / Trade-offs

- **触发率仍可能偏低** → 环境指令给了明确规则，但 agent 仍可能漏；缓解：本 change 的实施任务包含"用真实会话验证至少触发一次"，并把漏触发记入 BACKLOG 以待插件化判断，而不是假装已解决。
- **每次决策点多 1.7–1.8s** → 已用跳过条件（权威选择、既有 change）把常见情况成本降到 0；且 advisory 不阻塞后续步骤。
- **日志时间戳可能被 compaction/prune 影响** → `latency` 子命令找不到配对时明确记 `unavailable` 并给原因，不猜值。
- **一开始就没有 `DSH_SESSION_ID`** → 该子命令明确报缺失并退出非 0，不写假值。
- **逐帧切分的误判风险** → magic 序列理论上可出现在压缩数据内部；缓解：切分后每帧都要求解压成功才算数，失败即视为整体解码失败，宁可 `unavailable` 也不给错数据；测试包含真实多帧 fixture。
- **删覆盖门槛可能被理解为降低质量要求** → 换来的是报告不再撒谎；进一步自动化仍需单独 change，这条已写进 spec。

## Migration Plan

1. 先改 `scripts/lib/session-log.mjs` 与 `scripts/jev-readiness.mjs`，修测试 fixture（去掉 `spawnSync('zstd')`），使就绪检查在本机可跑。
2. 再改 `recorder.mjs`（新增 `latency` 子命令、修 `normalizeLatency`、改报告指标）与 `SKILL.md`（advisory 语义、去掉自我计时）。
3. 最后改 `instructions/dsh-home.md`、`dsh.yaml` note、`README.zh.md`。
4. `dsh build` 后重启 Host，用一次真实决策点验证建议行出现且记录被写入。

回滚：把 SKILL/spec 回退到 shadow 语义即可；`DSH_JEV_WORKFLOW_ROUTER_DISABLED=1` 可在不重新部署的情况下关闭全部 Jev 调用与记录。既有记录文件保持只读兼容，不回填、不改写。
