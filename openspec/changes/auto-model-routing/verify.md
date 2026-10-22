## Verification Results（2026-10-22 修订：判档规则 v6、effort 起点、上一轮上下文、子会话跟随根会话、判档记录与标注、派发规则）

首版与 2026-10-21 的验收记录见 `history/verify.md.2026-10-21`。

### Task Completion
- 第 1–8 组与 9.1 已完成；9.2 除“档位按钮点击标注”外均已在真实 GUI 会话验收（见下）；9.3 即本文件。
- 未完成项：9.2 中的按钮标注一步（`judgements.jsonl` 尚无标注行），见“未覆盖”。

### TDD Integrity
- [x] test-plan.md 66 行的测试名逐一核对存在（脚本按文件与 `it(...)` 名匹配，0 缺失），全部 🟢。
- [x] 33 行 🔴 均先观察到失败再实现；失败原因记录在 tasks.md“实施记录”（新模块不存在、新常量断言、`judged is not a function`、第三个路由未注册、`labelEndpoint`/`label-report.mjs`/`run.mjs` 不存在等）。
- [x] 沿用测试中因新常量（complex：xhigh → high）或新签名（`judge(state, signal)`、工具需 `agents/state`）改断言的，观察到的失败均为值差，已在 tasks.md 逐条说明，未弱化断言。
- [x] 计划外补测：`input.test.ts › redacts_before_bounding`、`content.test.ts › client_sources_stay_browser_safe`（以改回旧导入确认能捕获回归）、派发规则与工具描述的“必调”断言（9.2 修订，先红后绿）。
- [x] package 内零 skip。

### Evidence（均为实际运行）
- package：`npm run typecheck` 通过；`npm test` → **16 files, 94 passed**；`npm run build` 通过，`lib/client.js` 只 `require` react、react-dom 与 `@deepseek-ai/dsh-client-ui-primitives`。
- root：`npm test` → **447 tests, 445 pass, 0 fail, 2 skipped**（既有条件跳过）；首次在新工作树运行有 5 项因 `packages/dsh-openspec/lib/` 未构建而失败，构建后通过，与本 change 无关。
- `npm run check:artifacts` 通过；`openspec validate auto-model-routing --strict` → valid。
- 隔离 DSH_HOME 双 sync：`tests/auto-model-routing-sync.test.mjs`（第二次 `no changes`）与 `tests/sync-agent-instructions.test.mjs` 通过。
- 真实部署：主 checkout `dsh build` 两次，第二次 `no changes`（两轮：合入后一次、派发规则修订后一次）。首次构建因主 checkout `node_modules` 缺新 devDependency 失败，按 lockfile `npm install` 后通过，未改受控文件。
- **9.1 真实回归**（OpenRouter，规则 `dfc94335`，90 × 3）：首跑退出 1（新增 s-26、s-33 两条分票未命中），补抽确认为边界噪声，经用户同意计入基线；重跑 **退出 0**，7 条未命中均在基线内。约 $0.01。

### GUI 验收（9.2，现有 3080 GUI，Host 重启后的新建会话）

| 项 | 会话 | 结果 |
|---|---|---|
| AUTO 判档与 effort | `session-aac1c969` | Pet 排查请求判 complex（51%，standard 42%），请求头 `claude-opus-5-5 · high`，官方选择同步为 high，判档行 `{turn 1, complex, high, rubricVersion dfc94335}`，悬停面板与提示一致，Jev 1.19s ✅ |
| simple 回合 | `session-2bb2e187`、`session-595f6000` | “sayhi”判 simple → low ✅ |
| MANUAL 下委派 | `session-2bb2e187` 回合 3；本会话直接调用 | 子会话按官方默认（opus · high）；工具在 MANUAL 会话中返回 `routed: false`，未请求 Jev ✅ |
| 发现的问题 | `session-2bb2e187` 回合 2 | AUTO simple 回合 Agent 未加载 skill 直接派发，子会话继承 `low`。修订：派发规则改为在环境指令中直接写出必调步骤，工具描述同步（提交 `61e39286`），重启后复验 |
| 复验：小任务委派 | `session-595f6000` 回合 1 | 先调 `route_subagent` → `haiku-5-5 · low`；`subagent` 显式传三项并标注 `[claude-haiku-5-5·low]`；子会话请求头 `claude-haiku-5-5 · low` ✅ |
| 复杂委派与白名单 | `session-595f6000` 回合 2 | 主会话判 standard → medium；`route_subagent` 对评审任务判 complex → `opus-5-5 · high`；子会话请求头 `claude-opus-5-5 · high`，未被白名单拒绝 ✅ |

### 未覆盖 / 证据边界
- **档位按钮标注**：按钮显示依赖回合结束后的插槽渲染，悬停面板已验证，但截至本文件 `judgements.jsonl` 无标注行（`label-report.mjs` 输出 “no labeled turns yet”），点击标注未在真实 GUI 执行。离线有 jsdom 与 Host 集成测试覆盖。
- **codex/sol 路由**：真实会话只走了 claude 路由（haiku、opus）；sol/luna 由代码常量、测试与白名单配置覆盖。
- 真实余额耗尽时 OpenRouter 的状态码仍未验证（沿用首版结论）。
- 脱敏为形态匹配、尽力而为，已写入 README 与 manifest note。

### Review Integrity
- [x] review.md：第 7 轮 `APPROVE_WITH_CHANGES`，定点与最终复核 `CHANGES_APPLIED: yes`；复核的非阻塞措辞项（design D4 补“经 `redact` 后”）已落实。
- [x] 复核后的规格变更只有一处：9.2 验收发现后把“子会话派发”的 skill 指引改为必调步骤（spec、design D14 与 tasks 同步记录，原因与替代方案见 D14）。未另做独立复审。

### Change Delivery
- 实现提交（rebase 后）：第 1–8 组 6 个提交、9.1 基线提交、派发规则修订 `61e39286`；均已快进合入 `main` 并推送，`dsh build` 部署，Host 已由用户重启。
- 未归档；工作树 `.worktrees/auto-router-effort-session-4390e037-f07c-4038-8a` 保留。
