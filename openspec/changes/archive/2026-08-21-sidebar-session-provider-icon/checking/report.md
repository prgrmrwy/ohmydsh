# sidebar-session-provider-icon 验收报告

> **证据留存说明（2026-08 slim-repository-artifacts）**：本报告与 trails 中引用的 `screenshots/*` 原始截图证据为一次性会话产物，未托管于任何外部 artifact 存储，已按仓库派生资产保留规则移出当前版本树（历史 commit 仍可追溯）——后续 raw evidence 视为 ephemeral。验收结论与检查点台账完整保留于本目录。

## Loop 3 — Real GUI user acceptance

### Verdict

**PASS — user-confirmed on the real GUI**

在 0.1.1 同步到真实 DSH_HOME 后，`http://127.0.0.1:3080` 已服务最终 client bundle revision `ca27035cb9f1`。用户刷新页面并明确确认以下五项全部正确：

1. `deepseek-official / deepseek-v4-flash` 显示 DeepSeek 鲸鱼；
2. `codex / gpt-5.6-sol` 显示 OpenAI 螺旋；
3. `opencode-go / deepseek-v4-flash` 显示 OpenCode，而非被 model id 误判为 DeepSeek；
4. 输入框模型选择器切换后无需发送消息，当前 session 行 icon 立即变化；
5. 官方 StateDot、时间、菜单和拖拽均未受影响。

此 Loop 是真实 GUI 的用户目视/交互验收，不追溯改写 Loop 1/2 的隔离浏览器自动化结果；其 blocked 记录与证据继续保留。特殊失败注入、冷历史冲突数据和 DOM 版本破坏等 T2 场景仍属于报告中声明的人工/专项范围。

### Release evidence

- Main merge commit: `c27c72d`；feature commit: `e4573ec`。
- Installed package: `dsh-sidebar-session-provider-icon@0.1.1`。
- Served bundle contains `modelDirectories`, known-route priority and downloaded brand SVG assets.
- Package checks: typecheck PASS；21 tests PASS；build PASS；OpenSpec strict validation PASS。
- Independent code review high finding（同 session 首次 directory 解析失败后不可重试）已修复并由 lifecycle regression test 覆盖。

---

## Loop 2

### Verdict

**needs-human — BLOCKED**

用户已明确授权在隔离 GUI 3091 添加当前 worktree，但“添加工作区”触发的是原生目录选择器。`agent-browser` 点击后无法看到可自动化的 DOM dialog 或路径 input；页面仍为“选择工作区 / 暂无会话”。依 skill 边界，系统文件选择器属于天然 manual，且不得绕过 GUI 改写隔离 DSH_HOME。因此没有自行创建 workspace，T1 仍被前置条件阻塞。

### Independence

**低**。Oracle 来自 OpenSpec/同源需求和用户确认，无独立 QA oracle。

### 执行策略

- 用户选择：`single_agent`。
- 引擎：`agent-browser 0.23.3`。
- 仅操作 `http://127.0.0.1:3091/`，未访问 3080。
- Loop 2 尝试：点击“添加工作区”；原生目录选择器不可由当前引擎自动化。

### Mock 证据

沿用阶段 2 决策：available 0 / missing 3 / unknown 5 / not_needed 4；missing/unknown 转人工，不补 mock。

### Surface × 数据态覆盖

T1 的当前 session、空白 session、StateDot、时间、菜单和拖拽 surface 仍未加载；T2 保持人工。

### 期望来源缺口

无 `expected_unverified`；但 oracle 独立性低。

### 未覆盖 / 天然盲区

- 原生目录选择器不可由 agent-browser 自动化，必须人工选择获准 worktree。
- Workspace 未加入，因此 CP01、CP02、CP10、CP11 仍 blocked。
- T2 的特殊数据、route、视觉和 DOM 降级项仍为人工。

### 声明 × 证据 × 缺口台账

| Checkpoint | Result | Evidence | Gap |
|---|---|---|---|
| CP01 | blocked | 点击添加工作区后无 DOM dialog/path input | 需人工在原生 picker 选择 worktree |
| CP02 | blocked | workspace/session 仍未创建 | 需人工选择目录后建立空白 session |
| CP03–CP09 | manual | 阶段 2 mock 决策 | 按 T2 人工执行；CP07 不在 interaction focus |
| CP10 | blocked | 无 session row/StateDot | 需 workspace/session |
| CP11 | blocked | 无 session row/time/menu/drag | 需 workspace/session |
| CP12 | manual | 无 DOM 版本 fixture | 专项人工环境 |

### 浏览器证据

- `screenshots/add-workspace-dialog.png`：点击“添加工作区”时的 GUI 证据。
- DOM inspection：`dialogs=[]`，仅有搜索会话 input，无 workspace path input。
- 页面 URL 始终为 `http://127.0.0.1:3091/`。

### 结果汇总

- PASS：0
- FAIL：0
- BLOCKED：4（CP01、CP02、CP10、CP11）
- MANUAL：7（CP03、CP04、CP05、CP06、CP08、CP09、CP12）
- SKIPPED / MANUAL VISUAL：1（CP07）

### 范围声明

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能

---

## Loop 1

### Verdict

**needs-human — BLOCKED**

目标 GUI `http://127.0.0.1:3091/` 可以加载，内测声明也可正常关闭，但隔离环境未配置工作区或 session。页面显示“选择工作区”和“暂无会话”，DOM 统计为 `treeitems=0`、`providerLogos=0`。因此 T1 的模型选择器、侧栏 session 行及 StateDot/时间/菜单/拖拽均不可观察。本轮没有自动 PASS，也没有在已渲染目标 surface 上观察到功能不符，故不判 FAIL。

### Independence

**低**。Oracle 仅来自 OpenSpec/同源需求与用户确认，没有 QA XMind 等独立来源。即使后续自动 trail 全绿，也不等于免人工。

### 执行策略

- 推荐：`single_only`
- 用户选择：`single_agent`
- 实际执行：单 agent 顺序执行 T1；T2 按计划保留人工。
- 浏览器引擎：`agent-browser 0.23.3`（优先引擎检查 exit code 0）。
- 目标：仅 `http://127.0.0.1:3091/`；未访问 3080。
- 阻塞：隔离 GUI 无工作区/session，无法满足 T1 前置条件。

### Mock 证据

- `available: 0`、`missing: 3`、`unknown: 5`、`not_needed: 4`。
- `packages/sidebar-session-provider-icon/package.json` 无 mock script 或环境开关。
- 未找到可用于特殊数据场景的 repository-native handlers/fixtures 及明确启用入口。
- lockfile 中 MSW 痕迹没有已确认的 handler/service-worker/启动入口。
- 用户决定：真实 GUI 可执行项自动跑；missing/unknown 全部人工，不补 mock。

### 浏览器执行事实与证据

| Trail | 状态 | 事实 | 证据 |
|---|---|---|---|
| T1 | blocked | 3091 加载成功，但显示“选择工作区”“暂无会话”；不存在 session treeitem 或 provider logo | `screenshots/T1-blocked-no-workspace.png`; DOM `treeitems=0`, `providerLogos=0` |
| T2 | manual | 按已确认计划不自动执行 | `trails/T2.yaml` |

### Surface × 数据态覆盖

| Surface | 数据态 | 状态 |
|---|---|---|
| Composer + 当前 session 行 | 成功切换模型 | blocked — 无 workspace/session |
| 空白当前 session 行 | 首条消息前选择模型 | blocked — 无 workspace/session |
| 当前 session 行 | 选择失败 | manual — mock missing |
| 历史 session 行 | projection-only fallback | manual — data unknown |
| 当前 session 行 | selector B 覆盖 projection A | manual — data unknown |
| session 行 | 两来源均不存在 | manual — data unknown |
| provider icon | DeepSeek/OpenAI/OpenCode 品牌视觉 | manual；且 interaction focus 下 skipped-not-in-focus |
| provider icon | opencode-go + deepseek model | manual — route unknown |
| provider icon | unknown route model fallback | manual — mock missing |
| 行内状态与控件 | StateDot/时间/菜单/拖拽 | blocked — 无 session 行 |
| session 行 | 官方 DOM 变化安全降级 | manual — mock missing |

### 期望来源缺口

没有 `expected_unverified` checkpoint。所有 expected 均来自阶段 1 已确认 checkpoint；但 oracle 独立性低。

### 未覆盖 / 天然盲区

- T1 全部自动 checkpoint 因隔离 GUI 无 workspace/session 被阻塞。
- CP03 需要可控的 `selectModel` 失败条件。
- CP04–CP06 需要特殊 selector/projection 数据组合。
- CP07 缺可信视觉基准，且不属于本次 interaction focus。
- CP08 需要账号具备 `opencode-go/deepseek-v4-flash`。
- CP09 需要未知 route fixture。
- CP12 需要可控的官方 DOM 版本变化环境。
- 未确定性覆盖 IME、flaky/竞态场景。

### 声明 × 证据 × 缺口台账

| Checkpoint | Claim | Result | Evidence | Gap |
|---|---|---|---|---|
| CP01 | 成功切模后无需发送/刷新，当前行立即显示 B | blocked | 3091 无 session；截图及 DOM 计数 | 需配置 workspace 和可切模 session |
| CP02 | 空白 session 有选择时显示图标 | blocked | 3091 无 session；截图及 DOM 计数 | 需空白 session |
| CP03 | 选择失败保留旧图标 | manual | mock 探测 missing | 需失败注入或人工环境 |
| CP04 | 冷历史使用请求投影 fallback | manual | mock 探测 unknown | 需 projection-only 历史数据 |
| CP05 | selector B 覆盖旧投影 A | manual | mock 探测 unknown | 需冲突数据组合 |
| CP06 | 两来源均无值时不插入 logo | manual | mock 探测 unknown | 需缺字段 session |
| CP07 | 三品牌图标视觉正确 | manual / skipped-not-in-focus | 无可信视觉基准 | 需人工视觉核对及可用模型目录 |
| CP08 | OpenCode route 不被 DeepSeek model 误判 | manual | route availability unknown | 需对应真实账号 route |
| CP09 | 未知 route 根据 model fallback | manual | mock 探测 missing | 需 route fixture |
| CP10 | StateDot 显示、外观和位置不变 | blocked | 无 session row/StateDot | 需可渲染 session 行 |
| CP11 | 时间、菜单、拖拽不受影响 | blocked | 无 session row/controls | 需可渲染 session 行 |
| CP12 | 行结构变化时安全降级 | manual | mock 探测 missing | 需可控 DOM 兼容环境 |

### 结果汇总

- PASS：0
- FAIL：0
- BLOCKED：4（CP01、CP02、CP10、CP11；同一 T1 前置条件阻塞）
- MANUAL：7（CP03、CP04、CP05、CP06、CP08、CP09、CP12）
- SKIPPED / MANUAL VISUAL：1（CP07，not in interaction focus）

### 范围声明

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能
