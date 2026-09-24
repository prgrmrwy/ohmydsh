## Context

写档此前映射到 `workspace-write`，边界 = 子会话 cwd；子会话 cwd 由 DSH 在创建时写死为父会话 cwd（`subagent` 包 `childSessionMeta` → `parentHeader.cwd`），且会话 cwd 不可变。所有者的工作流是用 `sw` 在兄弟目录开 worktree（`corp/nexus-2`、`corp/nexus-rpc`），因此写档永远够不到他真正在改的代码。

实机证据（2026-09-16，同一对父子会话）：

| | 策略 | 结果 |
|---|---|---|
| 所有者会话 | `permission/preset`/`sandbox/mode` = `danger-full-access` | 无 cwd 边界，`sw` 带到哪就能在哪写 |
| locus 子会话 | 出生 `danger-full-access`（delegation）→ Pet 改为 `read-only` | 被主动收窄 |
| 提权尝试 | `workspace-write` apply 成功 → 核验失败 → 回滚 | 成对日志，结论稳定 |

上游无能力：`dsh-subagent` 0.1.5-rc.2 / 0.1.6-alpha.1 的 `SubagentStartRequest`、`ContinuableCreateSpec` 都没有 `cwd`。所以"指定执行根"须打宿主补丁 + 每次换 worktree 重建 child（新会话、旧对话不回填）。

设计闸门早已存在：`pet-unified-locus-collaboration/design.md:266`「不隐式映射 danger-full-access；若需更宽权限必须另作明确安全决策」。所有者 2026-09-16 选择**单档**（write = 完全访问），本 change 即该决策的实现，长期记录见 `docs/adr/ADR-0005-locus-write-grants-full-access.md`。

## Goals / Non-Goals

**Goals:**
- 让 locus 子会话在所有者实际工作的 worktree（以及任何位置）里可读写，与所有者自己的工作会话行为一致。
- 提权路径只由"入口空闲 + 宿主接受完全访问 + live 回读相符"决定，不再牵扯执行根确认。
- 后果如实呈现（整机无边界、入口成员共享），审计可查。
- 不引入宿主补丁、不升 DSH 版本、不改 persist schema。

**Non-Goals:**
- 不做「可写(限目录)」精确边界档（留作将来收紧时的选项，那时才需要 per-child cwd 补丁）。
- 不改 read 档语义；不取消每次投递前的 live 核验；不取消闲置检查与审计。
- 不改上下文锚点的数据模型（它仍存在、仍注入 prompt），只是不再门控提权。

## Decisions

### 1. `write` 直接映射 `danger-full-access`

`LocusSandboxMode` 收敛为 `'read-only' | 'danger-full-access'`，`modeFor(write) = 'danger-full-access'`。

**理由**：这是所有者显式选择的语义（write = agent 有没有写权限），且是本机唯一能覆盖兄弟 worktree 的做法。

**替代方案（否决）**：`workspace-write` + 可改执行根（需宿主补丁、每次换 worktree 重建 child，所有者明确否决）；两档并存（面板多一概念、仍需补丁，留作将来选项）；只放宽判据为包含关系（沙箱仍拒绝，自欺）。

### 2. 写档的权威事实 = live 模式为完全访问

`verifyLocusLivePolicy` 对 write 的判定改为「`policy.resolve()` 回读的 mode 恰为 `danger-full-access`」，并删除执行根相等与锚点撤销检查（`danger-full-access` 下没有有意义的 workspaceRoot）。

**理由**：判据必须仍然"派生自 live Host"而不是存储标记，否则核验就成了空话。漂移检测（回读不符即暂停该入口）保留。

**代价（已接受）**：不再能声称"写范围恰好等于某目录"；面板与回执改为如实说明完全访问。

### 3. 上下文锚点降级为上下文事实

执行根继续注入子会话 prompt、面板展示、按需读取；`unauthorized` 字段保留但不再参与判定（当前没有任何代码路径写入该值）。

**理由**：锚点的价值是"告诉子会话工作归属"，把它当授权闸门正是此前"提权被根挡死"的来源。

### 4. 文案与审计如实

面板权限标签改为「可写（完全访问）」，按钮 title 与权限行写明"整机无边界、该入口成员共享"；审计沿用既有 `locus_permission_audit`（同提交写入），不新增字段——单档下 `effective: 'write'` 与完全访问是 1:1 映射。将来若加第二档，再补记具体模式（additive schema）。

## Risks / Trade-offs

- [入口成员可让 bot 改/删本机任意文件（含仓库外）] → 这是所有者显式接受的范围；缓解手段是 read 仍是默认、每次投递前核验模式、审计留痕、面板明示后果。
- [误提权后难以察觉] → 面板持续以「可写（完全访问）」+ 后果说明呈现；降权一键回到 read 并回读核验。
- [既有 write 入口升级后模式不符而被暂停] → 实测当前 4 条 locus 全为 read，无存量；若将来出现，既有策略漂移路径会暂停并诊断，所有者重新授权即可（不静默）。
- [完全访问下工具的沙箱升级字段报错] → 本仓 `subscriptions-sandbox-shim` 已覆盖订阅 provider（codex/grok）的该问题；非订阅 provider 的子会话在其 runtime context 里已被告知 approval 关闭、不得自请升级。
- [审计不再区分"哪种完全访问"] → 单档下无歧义；若引入第二档必须同时补记模式，已在 ADR 里写明为前置条件。

## Migration Plan

1. Pet 侧代码与测试一次完成；`dsh build` 物化，**重启由所有者决定**。
2. 无 schema/契约变更，回滚只需回退代码重新构建（提权后的入口会回到 read 默认，需重新授权）。
3. 实机验收：把答疑群入口提权为 write → 让 bot 在 `corp/nexus-2` 里真实改一个文件并确认落盘 → 降权回 read 并确认写入被拒。
