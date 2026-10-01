## Context

Locus child 由 `packages/dsh-pet/src/host/locus/child.ts:888` 以 `toolFilter: LOCUS_SAFE_TOOL_FILTER`（allow = `read/read_image/glob/grep/web_search`）创建。该 filter 写入 subagent descriptor，冷恢复时由 runtime 在 `child-agent.ts:217` 以 `childCtx.tools.restrict(filter)` 重新施加，Pet 拿不到它的 disposer。发布时 `composeLocusChild`（`composition.ts:226`）在 `agent/created` 同步边界安装 caller-bound 工具并用 `attestLocusComposition` 回读可见工具面，任一工具不在 `LOCUS_SAFE_TOOL_NAMES ∪ LOCUS_CALLER_BOUND_TOOLS` 即否决发布。

这套组合来自 `2026-09-19-pet-locus-delivery-safety-hardening`：finish 被拒后模型改用 bash/lark-cli 直发，Delivery 账目过期；并且 read-only 文件沙箱只限写（Seatbelt profile 为 `(allow default)(deny file-write*)`，`sandbox-local/src/profiles.ts:52`），不限读与网络，所以任何 shell 都能拿到所有者的飞书凭据。`353b2c7` 又发现 own-plane 的 `subagent` 能绕开 filter，孙代理跑了 bash 与 `lark-cli auth status`。

所有者的决定（本次讨论）：为可信入口提供显式授予的 shell 档；开放期间只接受 allowlist 驱动；开放 bash + lark-cli/skills，不开放子委派；不重建子会话；出站用「命令 guard + 回退指引」防误操作，并明确它不是安全边界。

上游可用原语（pin `fb2c4b9`，`packages/core/tools/src/index.ts`）：

- `tools.restrict({allow,deny})` 必须在 agent scope 上调用；多条 restriction **取交集**；返回精确 disposer；名字必须属于该 scope 的 `restrictableNames`（全局可见的继承工具），否则抛错。
- `tools.guard(fn)` 经 `agent.ctx` 注册即仅作用于该 agent；在 `tools/pre-execute` 之后运行，只能拒绝不能放行，返回 disposer。`ToolExecution` 带 `name` 与 `arguments`。

## Goals / Non-Goals

**Goals:**
- 同一子会话上在 `safe`/`shell` 之间切换，不重建、不加代际、不丢历史。
- `safe` 档可见工具面与今天逐项一致，并继续由发布时回读证明。
- 任何档位都不可能拿到委派工具，且该保证不依赖可撤除的层。
- `shell` 档只被 allowlist 驱动；误用 lark-cli 发送被拦截并被引导回 finish。
- 冷恢复、Pet 重载、DSH 重启后档位与工具面保持一致；无法证明时拒绝发布。

**Non-Goals:**
- 不提供凭据或网络出口隔离；`shell` 档明确没有出站隔离。
- 不开放 `pwsh`、`write`/`edit`、`workflow`、`ralph`、`subagent*`、`send_message`、agent 控制类工具。
- 不改变文件权限档 `read`/`write` 与全局写档开关 `LOCUS_WRITE_ENABLED=false`。
- 不做 caller-bound 的群历史 broker（选项 A）；它与本变更正交，可以以后补给 `safe` 档。
- 不自动迁移 `safe-v1` 子会话。

## Decisions

### D1. 两层限制：持久宽底座 + Pet 持有的档位收紧层

- 新增 `LOCUS_SHELL_TIER_TOOL_NAMES = ['bash','skill']`。`dsh-pet-executor` 当前不注册 job control 工具或 `web_fetch`（`tool-web` 明确 `fetch: false`），不能把它们列入 shell 档，否则 `restrict()` 会因 unknown names 拒绝发布；预设不在本 change 中增添这些插件。
- 持久 descriptor 的 `toolFilter` 改为 `allow: LOCUS_SAFE_TOOL_NAMES ∪ LOCUS_SHELL_TIER_TOOL_NAMES`（`LOCUS_BASE_TOOL_FILTER`）。这一层由 runtime 在每次冷恢复施加，永不含委派。
- 在 `composeLocusChild` 的同一同步边界内，按 locus 的持久档位安装收紧层：`safe` 档调用 `agent.scope.tools.restrict({ deny: LOCUS_SHELL_TIER_TOOL_NAMES })`；`shell` 档不装。disposer 存入以 agent ctx 为键的 WeakMap。
- 切换档位：`safe→shell` 调用 disposer；`shell→safe` 重新 `restrict`。随后立刻用现有 `visibleTools` 回读。

备选方案及否决理由：
- 每次切换都重建子会话：用户已明确拒绝。
- 把 shell 工具注册到子会话 own scope：own-plane 不可 deny，一旦注册错误就无法收回，并且正是 `353b2c7` 的逃逸形态。
- 只用 guard 拒绝 `bash`：可见工具面仍列出 bash，模型会反复尝试；回读证明也无法区分两档。

委派工具不进入宽底座，所以即使收紧层丢失，最坏结果也只是 `safe` 档变成 `shell` 档，不会出现孙代理。

### D2. 组合标记 `safe-v2` 与按档位的回读证明

- `LocusChildComposition` 扩为 `'safe-v1' | 'safe-v2'`。
- 新建与重建的子会话写 `safe-v2`；`safe-v1` 行继续可读可服务，但不安装收紧层，也拒绝授予 shell。
- `attestLocusComposition(visible, expected)` 改为按预期档位核验：
  - `safe`：`visible ⊆ SAFE ∪ CALLER_BOUND`，且 `visible ∩ SHELL_TIER = ∅`；
  - `shell`：`visible ⊆ SAFE ∪ SHELL_TIER ∪ CALLER_BOUND`，且 `bash ∈ visible`。
  - 两档都另外断言 `visible ∩ DELEGATION_DENYLIST = ∅`（显式列出，防止以后有人把白名单写宽）。
- 发布时：`safe-v2` 行读持久档位 → 安装或不装收紧层 → 回读 → 不符即抛 `LocusCompositionError('surface-not-attested')` 否决发布（与今天一致）。
- `restrict()` 自身抛错（例如名字不在 `restrictableNames`）也否决发布。

### D3. 档位是 locus 的持久字段，切换走与权限档相同的受控流程

- `LocusRecord` 新增可选 `toolTier?: { desired: 'safe'|'shell'; effective: 'safe'|'shell'; verifiedAt?; grantedBy? }`，缺省视为 `safe`。
- 切换复用 `permission-mutation.ts` 的 serialize/fence 模式：
  1. `beginPermissionMutation` 置 busy/switching，拿到空闲证明；
  2. 解析精确子会话的 live agent；不在内存中时只写持久档位，不做 live apply，下次发布时由 D2 安装；
  3. 安装或撤除收紧层，回读；
  4. 通过后在同一事务里持久化 `effective` 并释放 fence；失败则回到 `safe`，重新装层并确认回读，然后释放 fence 并拒绝。
- 新代际与重建由 `NewLocusInput` 构造，不复制 `toolTier`，默认 `safe`。
- 审计复用权限变更的记录形状，记下 actor、时间、desired 与 effective。

### D4. 入口门禁：shell 档只接受 allowlist

- `admitLocusEvent` 的 `canAskAsGroupMember` 增加条件：该入口当前 `toolTier.effective !== 'shell'`。
- 被拒时 reason 为新值 `owner-only-tier`，控制器回一条确定性回执，而不是静默丢弃。静默会让普通成员以为 bot 坏了。
- 派发前（Delivery 从 backlog 取出并交给子会话之前）再查一次：`senderOpenId` 不在 allowlist 且档位为 shell 时，以同一原因结算。这覆盖了切档前已排队的请求，以及切档与派发之间的竞态。
- allowlist 使用 admission 当前使用的同一来源（`context.allowOpenIds`），不引入第二份名单。

### D5. 出站防误操作 guard

- 在 D1 的同一边界，给每个 `safe-v2` 子会话注册 `agent.scope.tools.guard(fn)`。这个 guard 不随档位装卸：`safe` 档下根本没有 bash，装着也无害，还省去状态分支。
- 拒绝条件：`exec.name === 'bash'`，且 `arguments.command` 经规范化后含 `lark-cli`，并命中写动作：
  - `im +messages-send|+messages-reply|+messages-recall|+messages-update|+messages-forward`；
  - 或 `api POST|PUT|PATCH|DELETE` 形式访问 `/im/v1/messages`。
- 规范化只做空白折叠与引号剥离，不试图解析 shell。
- 拒绝文案："业务回复只能经 pet_locus_finish；若 finish 被拒，请在回复中说明拒绝原因，不要绕行发送。"
- 这个 guard 只防手滑。文档与 UI 不得称之为安全边界（spec 已要求）。测试同时断言它**不**拦 `+messages-list`、`+chat-messages-list` 等读动作。

### D6. Prompt 与 UI 文案按档位生成

- `context.ts` 中现有的禁止项（"不得使用 shell/lark-cli/HTTP/send_message/子委派"）改为按档位的两段文案。
- `shell` 档允许以 `lark-cli --as bot` 读取**当前入口** chat 的消息，并注入当前 chat_id，免得模型去全局检索。仍然禁止跨群、私聊与全局搜索，并提醒回复只走 finish。
- 管理面与 `-t shell` 的回执给出 spec 规定的后果说明。
- 控制命令解析新增 `-t/--tools/--tools=` 的 `safe|shell`，沿用 `/scope` 的解析形状与"畸形也算控制命令"的规则。

### D7. ADR-0008

记录下面这些事实与取舍，作为 spec 放宽 `safe-v1` 无条件保证的依据，写法仿 ADR-0005：
- 所有者接受：`shell` 档把本机 shell（读取与网络不受限）和飞书身份交给 allowlist 驱动的模型。
- 群消息内容仍是不可信输入。
- 出站只剩防误操作。
- 委派仍然结构性排除。

## Risks / Trade-offs

- **收紧层漏装会把 `safe` 变成 `shell`。** 缓解：同步边界安装，回读核验失败即否决发布；单测覆盖冷恢复路径（durable lookup 分支）与 fresh staging 分支。
- **宽底座依赖 child 专属 preset 提供这些全局工具。** 当前主干已将 child 创建与冷恢复固定为 `LOCUS_CHILD_PRESET`（`dsh-pet-executor`），不继承 parent preset。`restrict()` 对未知名字抛错，所以该 preset 若去掉 `tool-skill`，新建子会话会失败。这是 fail closed，符合预期；回归测试证明宽底座属于 child preset 的可收紧工具集，且不影响任意主会话 preset 的 `/bind`。
- **bot 身份读取当前群历史尚未证明**。在新建的私有测试群中确认 bot 是成员并被设为群管理员后，`lark-cli --as bot im +chat-messages-list` 仍返回 Lark `230027 user_unauthorized`；同一测试群以用户身份读取成功。后者不能证明 Locus 子会话中的 bot 路径可用，也不能据此改用用户凭据或放宽沙箱。必须在真实 read 档子会话等价环境查清 bot 的应用可用范围/权限并重测；在此之前，shell prompt 的“可读取当前入口”是未验证假设，不得宣称实机已通过。
- **提示注入**：群里的 allowlist 成员可能转述外部内容，模型会以所有者身份执行 shell。这是已接受的风险（ADR-0008），不做缓解，只做如实告知。
- **`project-read-guard` 在 shell 档下形同虚设**：bash 可以读 cwd 外的任意路径，包括 DSH home 与 Pet state。这一点在 ADR 与 UI 说明里明确写出。
- **旁注（不在本变更范围）**：现有 `write` 权限档把沙箱设为 `danger-full-access`，但子会话的工具面没有任何写工具，所以今天的 write 档实际上不生效。`shell` 档加上 bash 后，write 档第一次有了实际意义。全局写档开关仍为关，这里只记录，不改变。

## Migration Plan

1. 部署后，既有 `safe-v1` 子会话照旧以 `safe` 服务，不受影响。
2. 所有者想对某入口开 shell 档时，按回执提示对该入口显式 `/bind` 重建一次，得到 `safe-v2` 子会话，之后切换都不需要重建。
3. 回滚：把 `LOCUS_BASE_TOOL_FILTER` 恢复为 safe 名单即可停止产生新的 `safe-v2`。已有 `safe-v2` 行必须一起降级，否则会不可服务：Pet 旧版本不认识该标记，reconciliation 会把它们置为 invalid，需要重建。回滚说明写入 ADR。

## Open Questions

- **询问工具联动修复（明确排除）**：参考会话包含另一项 roster→inquiry canonical target 修复，但所有者最后选择只移植 shell-tier。本次不修改 `host/collaboration/`、`host/inquiry/`、对应测试及独立询问 delta；该修复的旧测试或部署结论不作为本次证据。
- **未决并阻塞实机验收**：已在专用私有测试群外验证 Lark 权限，但尚未在真实 `read` 档 Locus child 的等价沙箱中执行，因此任务 1.2 仍未完成。`--as bot im +chat-messages-list` 与等价 raw GET 均返回 `230027 user_unauthorized`；bot 对同群 `chats.get` 成功，且经确认属于群成员。先前经所有者显式授权临时设为管理员；重试仍失败，随后已按所有者身份移除该临时管理员角色（bot 仍留在群中）。`--as user` 对同一群读取成功仅证明用户 token 路径，不替代 bot 路径。设计决定：不切换为用户凭据、不扩大 child 文件/网络权限、不把失败解释为 guard 命中；先由应用管理员核验并修复 bot 对历史消息读取能力（相关范围 `im:message:readonly` / `im:chat:read`）的授权及租户可用范围，再在 read 档 child 内重测。之前提到“lark-cli 配置目录单独开写权限”只是未验证的假设，当前证据不支持该补救。Pet 全套本地测试已重跑并通过（2812 passed，43 skipped）；这不替代以上实机任务。
- 管理面 UI 放在权限档旁边还是单独一栏：这是小细节，实现时沿用现有权限档控件的形态。
