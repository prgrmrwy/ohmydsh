## Context

`pet-locus-collaboration` 的写授权刻意是**派生式**的：不存「已授权」标记，每次提权都要求两个独立事实同时成立——所有者显式确认过执行根（意图），且 live sandbox 回读的 `workspaceRoot` 与该根规范化后精确相等（权威）。判定侧（`policy-verification.ts`）已按此实现并被测试覆盖。

缺的是**事实供给侧**。本轮实测（2026-09-16，答疑群 + 本机设置页）：

| 事实 | 证据 |
|---|---|
| `-s write` 在飞书返回 `控制命令执行失败，请稍后重试。` | 00:58:59 群消息；Host 日志 `control-command` → `control refused: control-failed` |
| 设置页显示真实原因 | `修改 locus 权限：缺少所有者已确认的 execution root；请先确认上下文锚点再提权。 已维持原 effective/read，未扩大权限。` |
| 机制：应用成功、核验失败、回滚 | 子会话 `session-680611d7` 00:58:57.857 `sandbox/mode: workspace-write` → 00:58:57.925 `sandbox/mode: read-only`（68ms）；01:01:46 重试序列相同 |
| `executionRoot` 无写入点 | 唯一写入点 `management.ts` 的 `confirm-anchor` ← 唯一调用点 `settings.tsx` 的按钮，其请求体不含 `executionRoot`；投影的 `workspace.executionRoot` 也从不填充 |
| 第一次点击后入口消失 | 该请求仍置 `status: 'confirmed'`（`projectResources: []`、`constraints: []` 已满足 `hasFacts`），按钮按 `status !== 'confirmed'` 渲染，于是不再出现 |

即：闸门要求的值在整条产品路径上没有可达写入点，且 UI 在第一次点击后收走唯一入口。判定侧不需要改，需要补的是供给与表达。

约束：
- DSH 的 `sandboxPolicy` 契约（`@deepseek-ai/dsh-sandbox-policy`）写明「session cwd 就是它 `workspace-write` 的边界」，`resolve()` 的 `workspaceRoot` 即该值；session header 的 `cwd` 可通过 `sessionController.inspect`（冷读）取得。
- 工作区注册表里的 `path` **不等于** session cwd（worktree session 的 cwd 在 `.worktrees/…`，注册表仍是主 checkout），因此候选根必须来自 session，而不是工作区条目。
- spec 要求拒绝提权时「提示需先确认上下文锚点」，并要求锚点「由所有者在管理面显式确认后写入」。

## Goals / Non-Goals

**Goals:**
- 让「所有者确认执行根」成为一个**可完成**的动作：管理面呈现宿主解析到的根，一次点击写入。
- 缺根的状态不再自我封死：只要还没有 `executionRoot`，确认入口就还在。
- 提权失败时，飞书侧与管理面都给出确定性原因与去处。
- 判定侧与安全语义零变化：write 仍要求两个独立事实，read 仍是默认，候选不构成授权。

**Non-Goals:**
- 不引入任何「已授权」持久标记，不因点击确认就直接授予 write。
- 不提供手输任意路径的控件（所有者只需确认宿主解析到的根；自由输入不增加安全性，只增加错误面——核验要求精确相等，任何偏差都会被拒绝）。
- 不改 wire 字段与持久 schema（`workspace.executionRoot`、`confirm-anchor.executionRoot` 早已存在）。
- 不改变 `pet-locus-collaboration` 里其它任何要求。

## Decisions

### 1. 候选根来自 session cwd，不是工作区注册表路径

`createLocusSessionDescriber` 从冷读的 `inspection.meta.cwd` 取出该会话的不可变工作目录；locus 视图按「子会话优先、主会话回退」填入 `workspace.executionRoot`。

**理由**：DSH 用 session cwd 作为 `workspace-write` 边界，`verifyLocusLivePolicy` 比较的正是这个值；用注册表 `path` 会在 worktree 场景给出错误候选（主 checkout vs `.worktrees/…`），让所有者点了确认仍然失败。

**替代方案（否决）**：用工作区注册表 `path`（worktree 场景必错）；用子会话创建时记下的锚点（当前根本没有该字段，且会引入第二份真相）。

### 2. 一次点击的「确认」= 所有者对宿主解析结果的显式确认

按钮把候选路径连同 fence 一起提交，服务端照旧写入 `executionRoot` 且 `authorization: 'unknown'`。

**理由**：核验要求精确相等，所以「所有者自选路径」与「所有者确认宿主解析的路径」在**能成功的取值上完全相同**；差别只在错误面。同时授权仍然每次派生——确认后若子会话工作边界改变（换 worktree、会话迁移），下一次核验立即失败并回滚，这正是派生式判定要防的过期问题。

**替代方案（否决）**：让所有者手输/用目录选择器挑路径（在唯一可成功的取值上没有额外安全性，还会引入 typo 与跨机器路径混淆）；由服务端在缺省时静默补根（那会让「所有者确认」变成空动作，等于绕过意图事实）。

### 3. 「已确认但缺根」必须保持可补

按钮可见性由 `contextAnchor?.executionRoot === undefined` 决定，而不是只看 `status`；展示区分「已确认的执行根」与「宿主解析到的候选」。这样第一次误点（无根确认）不会封死路径。

### 4. 控制面回真实原因，且分级映射

`safeControlError` 增加对 `LocusPermissionMutationError` 各码的映射：`WRITE_UNSUPPORTED` 直接透出核验诊断（其中分别说明「缺少所有者确认」与「与宿主回读范围不一致」），`CHILD_SESSION_UNAVAILABLE` / `POLICY_APPLY_FAILED` / `PERSISTENCE_FAILED` 各给一句稳定中文；`LOCUS_BUSY` 维持既有「稍后重试」语义（那一类确实是暂态）。文案不含路径、会话 id 或凭据。

## Risks / Trade-offs

- [候选路径出现在群聊回执里] → 回执只描述原因与去处，不含路径；路径只在所有者管理面展示。
- [所有者确认了一个随后漂移的根] → 每次提权/恢复都重新派生核验，漂移即使 write 失败并回滚为 read；这是既有语义，未放宽。
- [子会话无法冷读时没有候选] → 视图省略候选、按钮禁用并说明原因，不猜路径；提权仍 fail closed。
- [本地化文案与新错误码增加维护面] → 只映射既有错误码，新增文案集中在 `control.ts` 一处，并加单测钉住。

## Migration Plan

1. 代码与测试在 `packages/dsh-pet` 内完成，跑类型检查、范围 vitest 与仓库检查。
2. 经主仓 `dsh build` 物化并重启 `dsh web` 后生效；无持久 schema 变更，回滚只需回退代码重新构建。
3. 实机验收：设置页 Locus 管理 → 确认执行根 → 提权，确认 effective 变为 write；再在飞书群 @bot 发 `-s write`，确认回执说明结果（成功或确定性原因）。

## Open Questions

- 无阻塞项。「是否允许所有者手输一个不在宿主回读范围内的根作为意向记录」留待有真实需求时再定：当前实现下这种输入只会被核验拒绝，记录它没有收益。
