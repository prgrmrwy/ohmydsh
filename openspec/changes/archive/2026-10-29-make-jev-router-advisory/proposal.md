# Proposal

## Why

`jev-workflow-router` 上线一个月，实际使用量为零：本机 74 个会话、5225 次 `tool/call` 中，`jev-workflow-router` 被 skill 加载 **0 次**，`mcp__jev__jev_classify` / `jev_decide` 被调用 **0 次**（唯一 2 次是 2026-10-29 排查时的探针），`recorder.mjs report` 的 `realVibe.total` 为 **0**，记录目录 `$DSH_HOME/state/jev-workflow-router/` 不存在。同期已有 62 个会话 catalog 里含该 skill、25 个会话 header 里含 `jev_classify` 与 `jev_decide`，即**能力齐备但从未触发**；而 2026-10-26 以来仓库归档了 19 个 change，全部是它本该观测的决策点。

根因不是遗忘，是 Phase 1 的三条设计互相锁死：skill 只在「agent 已独立到达流程选择点」时使用（无任何接线，环境指令里没有一个 jev 字）、用了也禁止向用户展示任何结果、而它的产出又只服务于一个要求 100 条带标签样本的 Phase 2 门槛。零可见收益 + 每次 2 次 MCP 调用与文件开销，理性选择就是永远跳过。

同时查出两个会污染将来任何测量的缺陷：

1. **延迟口径不可用。** SKILL 要求用 `node -e "console.log(Date.now())"` 在两次 tool 调用前后取差。2026-10-29 实测该口径得到 32095ms，而同一 session 事件日志中 `tool/call.time → tool/result.time` 的真实单次往返是 **1698ms**（该次 classify）与 **1801ms**（另一次探针），相差约 18 倍；该口径主要测的是 agent 自己的推理往返，而非 Jev 耗时。recorder 又把超过 60s 的值静默截断到 60000（`recorder.mjs` 的 `normalizeLatency`），历史上有 80057ms 样本被无标识截断。
2. **就绪探针已失效。** `scripts/jev-readiness.mjs` 用 `spawnSync('zstd', ...)` 解码会话日志，本机没有 `zstd` CLI，当前输出恒为 `currentSession: {available: false, decodeFailed: true}`。10-26 归档时用来验收的探针现已不可用。

用户于 2026-10-29 明确选择：瘦身并接进真实流程，先修测量口径，同时把 zstd 探针缺口一并修掉。

## What Changes

- **Phase 1 shadow → Phase 2 advisory（**BREAKING**，面向用户可见行为）**：到达「直接改还是开 change、开哪种」的决策点时，路由器做一次 classify（仅当推荐正式流程时再做一次 decide），然后用**一行中文**给出建议候选、置信度与「可无视」的说明。不阻断、不追问、不弹选项、不写文件、不创建 change、不切 schema。用户显式指定或已有 change 时直接跳过。
- **接线**：`instructions/dsh-home.md` 增加一条明确触发规则，使该 skill 不再依赖「agent 碰巧想起来」；`dsh.yaml` 的 note 与 SKILL 的 description/whenToUse 同步改为 advisory 语义。
- **测量口径改造**：删除「两次 `Date.now()` 取差」的规定，改为由 recorder 新增的 `latency` 子命令从**会话事件日志**的 `tool/call` → `tool/result` 时间戳计算每次 Jev 调用的真实往返，并用其总和作为一次判断的序列延迟。日志不可解码时明确记 `unavailable` 并给出原因，不猜值。
- **移除静默截断**：`normalizeLatency` 不再把超限值静默压到 60000；改为保留实测值并以显式 `truncated: true` 标记超过上限的样本。
- **准入门槛降级（瘦身）**：advisory 已由用户直接批准，因此删除 Phase 2 的 100 条带标签样本、每条路线 15 条、每类高危 10 条覆盖门槛及其机器判定。报告保留三项持续健康指标：调用失败率、建议与实际路径不一致率、真实样本延迟 p50/p95。
- **修 zstd 探针缺口**：会话日志解码不再依赖外部 `zstd` 二进制；改用 Node 内置 zstd 并逐帧解码（v4 日志是多帧，单帧解码只会取到首帧）。解码不可用时报告具体原因，而不是一个布尔 `decodeFailed`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `jev-workflow-routing`：Phase 1 的 observation-only 要求被 Phase 2 advisory 要求替换（一行非阻断建议、明确跳过条件、失败静默）；晋升要求从「先满足 100 条样本门槛」改为「用户已批准 advisory，任何进一步自动化仍需单独批准」；证据要求中的延迟口径改为基于会话事件日志的真实往返，并移除无标识截断与不可达的覆盖门槛。
- `jev-provider-transport`：就绪检查的会话日志读取要求明确为「不依赖外部 zstd 二进制、必须完整解码多帧日志、失败须给出可操作原因」。

## Non-goals

- 不让 Jev 创建 change、选择或切换 schema、调用 `ssf`、开始实施、授权工具、降低任何安全门禁、合入、归档或清理。
- 不做 Phase 3 自动化，也不把 advisory 扩展为自动执行。
- 不改变候选闭集（`direct` / `standard-openspec` / `anvil` / `spec-superflow`）与确定性规则优先级。
- 不改变 Jev MCP pin、服务方闭集（`typesafe` / `openrouter`）或凭据通道。
- 不修 `weekly-insights` 的 `zstd` CLI 依赖（它另有 `--version` 前置检查与明确报错），仅在本 change 的范围内统一 Jev 侧的解码路径。
- 不删除历史 shadow 记录格式的只读兼容；新记录沿用当前 schema 版本。

## Impact

- 代码：`skills/jev-workflow-router/{SKILL.md,recorder.mjs}`、`scripts/jev-readiness.mjs`、`instructions/dsh-home.md`、`dsh.yaml`（note）、`README.zh.md`，以及 `tests/` 中对应的 router / report / readiness 用例。
- 规范：`openspec/specs/jev-workflow-routing/spec.md`、`openspec/specs/jev-provider-transport/spec.md`。
- 行为：每次到达关键决策点增加约 1.7–1.8s 的一次 MCP 往返（仅当需要正式流程时再增加一次），并新增一行用户可见输出；用户显式指定流程时无额外开销。
- 部署：改 `instructions/dsh-home.md`、`dsh.yaml` 与 skill 后需 `dsh build` 并重启 Host 才生效。
- 回滚：把 `enabled` 语义之外的行为回退到 shadow 需回滚本 change 的 spec 与 SKILL；`DSH_JEV_WORKFLOW_ROUTER_DISABLED=1` 始终可在不改部署的情况下关闭全部 Jev 调用与记录。
