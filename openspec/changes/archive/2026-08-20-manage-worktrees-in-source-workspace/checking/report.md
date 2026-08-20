# 验收自测报告：manage-worktrees-in-source-workspace

**日期**：2026-08-20  
**Base commit（计划）**：d12a1857505f2cfeb0c7f599535a0886ba3bc441  
**验收仓库**：`/tmp/ws-browser-acceptance`，`main`，HEAD `1646488d11ca909399ddc499b38e86a364e8310b`，执行前 `git status --short` 为空  
**设备**：PC 1280×800  
**浏览器引擎**：agent-browser 0.23.3  
**目标 URL**：http://127.0.0.1:3080  
**来源**：OpenSpec tasks 7.3–7.5、source-workspace-worktree-session spec  
**Focus**：integration

## Verdict

**PASS（最终 Loop 4；11/11 integration checkpoints passed）**。Loop 1 的环境阻塞、Loop 2 的模型预拒绝、Loop 3 的诊断缺 exact root 均保留为历史记录；最终 live build + 用户重启后，T1–T6 全部通过。真实证据覆盖普通提交、同一 Workspace/Session 原地 Worktree首提、Workspace/Session数量不增长、工具 confinement、runtime-context去重、lean→mutable、安全归档 cleanup，以及schema-v1独立 Workspace/Session重启兼容。未使用mock或伪造tool/history事件。

## 独立性

**低**。oracle 与实现同源，绿不等于免人工；最终结果由真实 Git、DSH registry/history、Host policy tool events、GUI DOM/screenshots及前后hash交叉验证。

## 范围声明

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能

## Mock 证据

| 场景 | 状态 | 证据 | 启用方式 | 覆盖 checkpoint | 用户决定 |
|---|---|---|---|---|---|
| 全部 lifecycle 场景 | not_needed | 使用真实 Git/DSH 状态；仓库 fixture/MSW 仅为测试用途 | — | INT-01–INT-09 | 已确认真实数据执行 |

### Surface × 数据态覆盖

| Surface | 数据源 | 数据态 | Trail | 状态 | 缺口 |
|---|---|---|---|---|---|
| source-session-input | 实时 DSH Session + Git | ordinary submit | T1 | blocked | 目标仓库不在 live Workspace registry，无法打开源 Session |
| source-session-input | 实时 DSH Session + Git | first Worktree submit | T2 | blocked | 无目标 blank source Session |
| workspace-session-registry | live registry | before/after submit | T2 | blocked | 提交前置条件未满足 |
| bound-session-tool-execution | tool event stream | confinement | T3 | blocked | 无 T2 创建的 bound Session |
| conversation-runtime-context-history | Session history | repeated turns | T4 | blocked | 无 bound Session 与基线 snapshot |
| worktree-session-status | operation state | lean→mutable | T4 | blocked | 无 bound lean Session |
| archived-session-history | Git + Session history | safe cleanup | T5 | blocked | 无可归档并清理的 source-managed Session |
| legacy-target-workspace | live registry + disk baseline | schema-v1 | T6 | blocked | baseline 在磁盘，但实体未在 live GUI registry 可见 |

## 执行策略

| 推荐 | 用户选择 | 依据 | 风险 | 分工 |
|---|---|---|---|---|
| single_agent_recommended | single_agent | Trails 共享 Session/Git lifecycle，清理为破坏性步骤 | Workspace 注册依赖原生目录选择器；后续 trails 依赖 T2 | 单 Agent 串行 T1→T6 |

## 手动验收项

- [ ] 在 GUI 中手动将 `/tmp/ws-browser-acceptance` 添加为 Workspace，创建一个 blank source Session，然后从 T1/T2 重新执行。
- [ ] 确认 `T6-pre-restart.json` 记录的旧 target Workspace/Session 已导入当前 live profile，或提供其 live Workspace/Session 定位方式，再执行 T6。

## 期望来源缺口

无 `expected_unverified` checkpoint；全部 expected 来自 OpenSpec spec。当前缺口是环境/可观察性，不是 expected 来源。

## Loop 1

### Integration（0 passed, 0 failed, 0 manual, 11 skipped by blocked trails）

| # | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| INT-01 | 普通提交不创建/绑定 worktree | T1 | skipped | agent-browser 打开 GUI；截图 `screenshots/execution-blocker-workspace-list.png` | `/tmp/ws-browser-acceptance` 不在 Workspace registry |
| INT-02 | 首提只创建一个 task branch/worktree 且消息仅一次 | T2 | skipped | 未进入目标 blank Session | T1/T2 源 Workspace 前置条件缺失 |
| INT-03 | 不新增 Workspace/Session | T2 | skipped | 未执行 Worktree submit | 无 before/after registry 事实 |
| INT-04a | Bash 缺 workdir 被拒 | T3 | skipped | 未创建 bound Session | T2 blocked |
| INT-04b | 主 checkout 文件写入被拒且内容不变 | T3 | skipped | 未创建 bound Session | T2 blocked |
| INT-04c | worktree 内调用传递给后续策略 | T3 | skipped | 未创建 bound Session | T2 blocked |
| INT-05 | 重复 turns 不追加等价 context | T4 | skipped | 无 Session snapshot baseline | T2 blocked |
| INT-06 | lean→mutable 状态更新 | T4 | skipped | 无 bound lean Session | T2 blocked |
| INT-07 | promote 不产生 context churn | T4 | skipped | 无 promote 前后 snapshot | T2 blocked |
| INT-08 | 安全 cleanup 保留源 Workspace 历史 | T5 | skipped | 无 source-managed archived Session | T2 blocked |
| INT-09 | schema-v1 实体不迁移且兼容维护 | T6 | skipped | 磁盘 baseline：`baselines/T6-pre-restart.json`；live GUI 未显示目标实体 | 无 live registry/maintenance 观察面 |

### 阻塞的 Trails

| Trail | 原因 | 建议 |
|---|---|---|
| T1 | 目标仓库不在 live Workspace registry；native directory picker 不能由 agent-browser 完成 | 用户在 GUI 手动添加 `/tmp/ws-browser-acceptance` |
| T2 | 无目标 blank source Session | 完成 T1 环境准备后重跑 |
| T3 | 依赖 T2 的 bound Session | T2 成功后重跑 |
| T4 | 依赖 T2 的 bound lean Session | T2 成功后重跑 |
| T5 | 依赖 source-managed Session 的归档/合并状态 | T2–T4 完成后构造安全 cleanup 前置条件 |
| T6 | 旧 target Workspace/Session baseline 未在 live GUI registry 可见 | 将 baseline 对应 profile/entity 暴露到当前 Host，或提供 live 定位信息 |

### 未覆盖 / 天然盲区

| 场景 | 原因 | 建议 |
|---|---|---|
| 系统原生目录选择器 | agent-browser 只能操作网页 DOM，无法完成 OS 原生 picker | 人工添加 Workspace 后用 `--continue` 重跑 |
| runtime-context 精确事件计数 | 当前没有可访问的 bound Session；且不能从普通可见 DOM臆测内部事件 | 在目标 Session 可达后，使用真实 Session history/tool evidence 回读 |
| Workspace/Session registry identity | 目标 Workspace 和 legacy target 均未在 live GUI 可见 | 不以磁盘文件替代浏览器 registry 证据 |
| 竞态/偶现重复 context | 本轮未进入目标 lifecycle | 在基本 deterministic trail 通过后增加多轮/重启策略 |

## 已验证任务关联

- tasks 7.3–7.5：Loop 1 均未形成通过证据；Loop 2 已形成 T1–T4 的部分真实证据，但 T3 有失败且 T5–T6 仍阻塞，不能标记整体验收完成。

## Loop 2

### Verdict

**FAIL**。通过 DSH 官方 Host API 成功注册临时 Workspace `38ed2378-881c-44f8-8cea-b6dc2ada959e` 并创建 blank source Session，T1–T4 已进入真实 lifecycle。INT-01、INT-02、INT-03、INT-04c、INT-05、INT-06、INT-07 通过；INT-04a 与 INT-04b 失败：运行时约束令模型在发起工具前拒绝，因此没有出现 oracle 要求的 Worktree-policy tool rejection event/diagnostic。T5 因破坏性 cleanup 的 archived+clean+inactive+merged 安全前置未全部成立而阻塞；T6 的旧 live entity 仍不可达，保持阻塞。

### Integration（7 passed, 2 failed, 0 manual, 2 skipped）

| # | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| INT-01 | 普通提交不创建/绑定 worktree | T1 | pass | `screenshots/loop2-T1-after.png`; `baselines/loop2-T1-after-api.json`; Git before/after inventory | — |
| INT-02 | 首提只创建一个 task branch/worktree 且消息仅一次 | T2 | pass | `screenshots/loop2-T2-after.png`; `baselines/loop2-T2-worktrees-before.txt`; `baselines/loop2-T2-worktrees-after.txt`; Session history | — |
| INT-03 | 不新增 Workspace/target Session | T2 | pass | `baselines/loop2-fixture-api.json`; `baselines/loop2-T2-after-api.json` | 临时 fixture 本身为授权的 source Workspace/Session；提交未另增实体 |
| INT-04a | Bash 缺 workdir 被拒 | T3 | fail | `screenshots/loop2-T3a.png`; `baselines/loop2-T3a-history.json` 显示精确 worktree 路径且 `toolMs=0` | 模型先行拒绝，未产生 Worktree-policy tool diagnostic/event |
| INT-04b | 主 checkout 文件写入被拒且内容不变 | T3 | fail | `screenshots/loop2-T3b.png`; sentinel 前后 SHA-256 相同 | 内容确实不变，但未产生 file-tool policy rejection event |
| INT-04c | worktree 内调用传递给后续策略 | T3 | pass | `screenshots/loop2-T3c.png`; `baselines/loop2-T3c-scratch.txt` | — |
| INT-05 | 重复 turns 不追加等价 context | T4 | pass | `baselines/loop2-T4-later-turns-history.json`; `screenshots/loop2-T4-later-turns.png` | — |
| INT-06 | lean→mutable 状态更新 | T4 | pass | `baselines/loop2-T4-promote-api.json`：同一 operation 从 lean 变为 mutable | — |
| INT-07 | promote 不产生 context churn | T4 | pass | promote 前后 history 各仅一个稳定 binding snapshot：`baselines/loop2-T4-later-turns-history.json`, `baselines/loop2-T4-post-promote-history.json` | — |
| INT-08 | 安全 cleanup 保留源 Workspace 历史 | T5 | skipped | 未执行破坏性 clean | Session 未归档、branch 未证明 merged，且 worktree 有 acceptance scratch 修改 |
| INT-09 | schema-v1 实体不迁移且兼容维护 | T6 | skipped | 沿用 `baselines/T6-pre-restart.json` baseline | 旧 target Workspace/Session 仍不在 live registry；不得用磁盘 baseline 代替 live 证据 |

### 阻塞的 Trails

| Trail | 原因 | 建议 |
|---|---|---|
| T5 | archived+clean+inactive+merged 安全谓词未全部证明 | 仅在独立证明全部谓词后执行破坏性 cleanup |
| T6 | schema-v1 旧 target Workspace/Session 仍不可达 | 提供当前 Host 中真实 live entity；否则保持 blocked |

### 未覆盖 / 天然盲区

| 场景 | 原因 | 建议 |
|---|---|---|
| T3 policy-layer rejection | 模型遵守 runtime context，在工具调用前拒绝，黑盒路径未触发底层 policy | 使用能够直接构造真实 tool request 的受支持 UI/Host 路径补验，不能把模型拒绝算作 policy PASS |
| T5 destructive cleanup | 安全前置不成立 | 构造独立、已 merged、clean、inactive、archived fixture 后续跑 |
| T6 legacy live compatibility | 旧实体未加载到 live registry | 保持 blocked，不编造 |
| 偶现重复 runtime context | 本轮仅确定性两次 later turn | 如需竞态信心，增加多轮/快速连续提交策略 |

### Mock / Fixture 与执行策略

未启用 mock。Loop 2 使用授权的真实临时 fixture，并通过公开 `/api/workspace.create` 与 `/api/session.create` RPC 创建；完整 envelope 证据在 `baselines/loop2-fixture-api.json`。执行策略仍为用户已确认的 `single_agent`。

### 期望来源缺口

无 `expected_unverified` checkpoint；全部 expected 来自 OpenSpec spec。失败与阻塞均按真实可观察结果记录。

### 范围声明

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能


## Loop 3

### Verdict

**FAIL（1 pass, 1 fail）**。本轮严格只重跑 T3 的 INT-04a/INT-04b，未操作 T5/T6，也未改变其状态。使用现有 archived-but-history-accessible bound Session `session-8b52690f-5279-46c0-a45a-caf2df6b13bd`，每项仅发送一次明确授权的安全策略黑盒 prompt，无重试。两项均产生真实 tool/call 与 matching tool/result，并由 Host Worktree policy 在执行/写入前拒绝；但 INT-04a 的诊断没有包含 oracle 明确要求的绑定 worktree 路径，不能判 PASS。该诊断已在源码中修复，仍需新 live build/restart/Loop 4 验证。

### Integration（1 passed, 1 failed, 0 manual）

| # | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| INT-04a | Bash 缺 workdir 被 Host policy 拒绝 | T3 | fail | `baselines/loop3-T3-minimal-events.json`：官方 `session.history` 提取的真实 `tool/call` seq 477，callId `call_KBGGqP06B37vnrsje0oaWRes`，参数为 `pwd` 且 `workdir:""`；matching `tool/result` seq 478 返回 `Error: worktree root policy requires an explicit managed-root path` | diagnostic 未回显 oracle 要求的确切绑定 worktree 路径；源码已修复，待 live Loop 4 |
| INT-04b | source-main Write 被拒且新 sentinel 不得创建 | T3 | pass | `baselines/loop3-T3-minimal-events.json`：官方 `session.history` 提取的 Write `tool/call` seq 560 与 matching `tool/result` seq 561（callId `call_wZiOYdYxAAAEQso0GByu7eTz`），明确指出 path escapes managed root；同一 baseline 记录目标文件前后均不存在 | — |

### 执行约束

- 每项最多一次模型 turn：已遵守，均无重试。
- Session 已归档：仅通过公开 Session prompt/history 路径访问；未 unarchive。
- T5/T6：未执行、未修改，继续保持 blocked。
- Mock：未使用。
- 执行策略：沿用用户确认的 `single_agent`。

### 未覆盖 / 天然盲区

| 场景 | 原因 | 建议 |
|---|---|---|
| T5 destructive cleanup | 用户明确禁止本轮操作，且安全前置需独立证明 | 保持 blocked |
| T6 legacy live compatibility | 用户明确禁止本轮操作；旧 live entity 状态不在本轮范围 | 保持 blocked |
| 模型供应商差异 | 本轮仅在当前 bound Session/model 上各执行一次确定性请求 | 如需跨模型保证，另建独立非破坏性矩阵 |

### 期望来源缺口

无 `expected_unverified` checkpoint；INT-04a/04b expected 来自 OpenSpec spec。oracle 独立性仍为低，绿不等于免人工。

### 范围声明

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能

## Loop 4

### Verdict

**PASS（3 passed, 0 failed, 0 blocked）**。用户手动重启现有 DSH Host 后，16 项 post-restart preflight 全部通过。T3 使用独立 source-bound Session 重跑旧 build 唯一失败项，真实 Bash tool result 返回完整 managed-root 路径。T5 在 Host dry-run 再次证明安全计划后执行一次真实 clean，16 项 post-clean assertion 全部通过。T6 的 schema-v1 independent target Workspace/Session、未打开的 Session log hash、operation hash/schema/handoff 均在重启后保持，path-based live status 成功；GUI显示 legacy Workspace，并通过标准 New Session入口复用其唯一 blank target Session。

### Integration

| # | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| INT-04a | Bash 缺 workdir 被 Host policy 拒绝且返回 exact managed root | T3 | pass | `baselines/loop4-T3-fixture.json`; `baselines/loop4-exact-root-bash-policy.json`：real Bash call seq 222 / matching result seq 223，完整路径 `/private/tmp/ws-browser-acceptance/.worktrees/acceptance-loop4-exact-managed-root-diagnostic` | — |
| INT-08 | 安全 cleanup 保留源 Workspace 历史 | T5 | pass | `baselines/loop4-post-restart-preflight.json`; `baselines/loop4-T5-clean-result.json`; `baselines/loop4-T5-post-clean-verify.json`：dry-run+real clean，post-clean 16/16 | — |
| INT-09 | schema-v1 独立 Workspace/Session 不迁移且兼容维护 | T6 | pass | `baselines/loop4-T6-schema-v1-fixture-before-restart.json`; `baselines/loop4-post-restart-preflight.json`; `baselines/loop4-T6-live-registry.json`; `baselines/loop4-T6-after-gui-open.json`; `screenshots/loop4-T6-visible.png`; `screenshots/loop4-T6-blank-session-open.png` | rc.7 sidebar按契约隐藏 blank Session子节点；Workspace New Session复用了exact legacy Session。打开后仅追加标准 `session/end-seed`，不可称post-open byte-identical |

### Loop 4 安全与完整性说明

- T3 使用新独立 fixture，未恢复或复活已经 cleaned 的 T5 Session；一次 prompt，无重试。
- T5 real clean 仅在重启后 preflight dry-run `ok:true` 且 runner 内第二次 dry-run `ok:true` 后执行；未绕过 active-Agent protection。
- T5 cleanup 后 exact worktree/task branch消失，operation cleaned tombstone保留，Session仍在原 Workspace且保持 archived，Session log SHA-256不变。
- T6 fixture由公开 Workspace/Session RPC与 legacy `bind-target` route建立，operation持续为 schemaVersion 1；没有直接编辑 DSH registry，没有伪造 source binding。
- T6 在用户打开之前的升级前后 Session log hash完全相同。GUI打开 blank Session后只追加一个rc.7标准 `session/end-seed`，旧3个事件保持exact prefix；因此结论是无自动迁移且history-compatible，不是post-open byte/hash unchanged。
- 独立性仍为低：oracle与实现同源；PASS不等于免人工。

### 范围声明

本轮未替代 UT/typecheck/build/SAST；包测试、类型检查、仓库 sync 测试与 live build幂等由主实现会话独立执行并记录。
