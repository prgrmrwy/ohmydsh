# Pet locus 模型 spike 结论

梳理 pet 的 session↔飞书绑定模型、准备改为多对多（locus）时跑的四个 spike。
本文只记录**验证到的事实与其证据**，不记录设计决策本身。

日期：2026-09-09

## spike-1：fork child 能否指定自己的 cwd

**结论：不能。**

证据：

- `@deepseek-ai/dsh-subagent` 的 `cwd` 参数只存在于 `lib/types/out-of-process.d.ts`
  （`assertUsableCwd` / `validateConfiguredCwd`），服务的是 ACP / Codex 这类跨进程
  provider。
- `@deepseek-ai/dsh-subagent-fork-in-process` 是 in-process backend，其可配置面
  （README「Use this package」与 provider 能力清单）只有 persona、tool filter、
  structured output、`agentOptions`（provider/model/effort/output cap），**没有 cwd**。
- fork child 复用父的 session workspace，`session.cwd` 在会话创建时即 immutable。

**影响**：任何「建 child 时把 cwd 设成受管执行根」的方案不成立。执行根只能靠
prompt 级锚定（与 `sw` 让 parent 保持在 worktree 中的机制同构）。

## spike-2：话题群入站事件是否携带可用 thread_id

**结论：字段确定存在且真机有值；话题群（`--chat-mode topic`）本身仍需实测。**

证据：

- 官方 SDK `@larksuiteoapi/node-sdk@1.47.1` 的 `im.message.receive_v1` 事件
  schema 在 `message` 对象上声明 `thread_id?: string`，与 `root_id` / `parent_id`
  并列（`node_modules/@larksuiteoapi/node-sdk/types/index.d.ts` 附近 258093 行）。
- 真机 fixture `dev-infra-server/test/fixtures/slardar-diagnosis/alarm-im-message-real.json`
  中 `thread_id: "omt_190cf12825ce1cbc"`，且同一话题下的 `thread_replies` 全部
  携带同一个 `omt_`——正是 discriminator 应有的形态。
- `dev-infra-server/service/ux-issue-group-dispatch.ts:127-144` 已在生产用
  `result.data.thread_id` 拼 `applink.feishu.cn/client/thread/open`。
- `lark-cli` 侧能力齐备：`im +chat-create --chat-mode topic`、
  `im +threads-messages-list`（接受 `om_`/`omt_`，bot 身份可用）、
  `im +messages-reply --reply-in-thread`。
- Pet 的 `LarkInboundEvent`（`channel/event.ts:26`）早已声明该字段，从未使用。

**缺口**：以上证据均来自普通群的 thread，没有一条来自 `--chat-mode topic` 建的
话题群入站事件。schema 标注为可选。

**要求**：实现时 fail closed——读不到 `thread_id` 即退化为 chat 级 locus，
MUST NOT 猜测或伪造。

## spike-3：workspace-write 能否覆盖 sw 的 worktree

**结论：不能。sw 的 worktree 在可写根之外。**

证据：

- `dsh-sandbox/lib/types/roots.d.ts` 的 `writableRoots()` 是所有 enforcement
  dialect 的唯一来源：`workspace-write` 允许的是「policy 的 workspace root
  + 宿主 `/tmp` + `os.tmpdir()`」，`read-only` 允许集合为空。
- workspace root = 调用会话的 immutable `session.cwd`
  （`dsh-sandbox-policy` README：「its immutable cwd becomes the workspace boundary」，
  且「One primary workspace root per session — extra writable roots are not part
  of `SandboxExecutionPolicy`」）。
- `sw` 的 worktree 是主 checkout 的**兄弟目录**：
  `sw.sh:450` → `wt_path = dirname(MAIN_REPO)/nexus-<slug>`。
- 真机确认（`git -C nexus worktree list`）：
  主 checkout `/Users/bytedance/mydir/dev/nexus`，
  worktree `/Users/bytedance/mydir/dev/nexus-neu581-…` 等，均为同级兄弟目录。

推论：child 的 cwd = 父的 cwd = nexus 主 checkout，而目标 worktree 在其**之外**，
因此 `workspace-write` 既不会误写主 checkout 下的内容到 worktree，也**根本写不进**
worktree。

对照 `ws`（本仓 Worktree Session）：worktree 在 `<repo>/.worktrees/*`，是仓库根的
**子目录**，父 cwd 为仓库根 → `workspace-write` 会把整个主 checkout 一并放开，
属于「开了不该开的门」。

**两种 worktree 方案下 `workspace-write` 都无法正确落地，错法相反。**

**影响**：`-s write` 不能依赖 sandbox 定位目录。可行形态是
「`read-only` 为真沙箱硬边界；`write` 解除该硬边界后回到 prompt 级目录约束」，
且必须如实声明后者不是沙箱保证。

## spike-4：能否给 qa child 装单个 Pet 工具

**结论：可以，且是按组件而非整体的开关。**

证据：

- `index.ts:376 installPetScope(agentCtx, includeAllowlist)` 内部是**两个独立注册**：
  - `includeAllowlist` 为真时注册 Pet allowlist Skill provider；
  - 独立地注册 caller-bound Agent tools（`registerPetTools`）。
- `index.ts:468` 的 `if (isForkChildTaskForm(task.sourceKind)) return` 是在**进入
  该函数之前**整体跳过，因此今天 qa child 两样都没有。把守卫下移即可只装工具。
- 当初整体跳过的两个真实原因（`index.ts:455-467` 注释）性质不同：
  1. `pet_context` 报 `NO_CURRENT_INVOCATION`——因为它按 Invocation 解析，而 qa
     投递不建 Invocation（`capture.ts:244 findCurrentInvocation`）。**这是数据源
     问题，不是「不该装工具」**。
  2. allowlist provider 替换了 child 继承的 Skill catalog——**这个必须继续禁止**。

**影响**：可给 qa child 装 context 工具，但必须为其提供 locus 数据源分支，
且 allowlist provider 保持禁止。

## 连带确认（非 spike，但已核实的事实）

- **child→parent 消息是宿主原生能力**：`dsh-subagent` README:100/167/171——
  resident continuable child 可向 direct parent 发消息；无持久父信箱，父不 live
  即拒绝；只保证 acceptance identity 而非 exactly-once；每次会让父起一轮独立
  model request（README:132）。
- **parent→child 同样原生**：「every sender may target a direct continuable child」。
- **fork seed 是父的完整已完成轮次**（README:114「the parent's balanced
  completed-turn prefix … verbatim」），因此 `SW_WORKTREE=` 那行天然在 child 的
  继承历史里；seed 是一次性快照，之后父的新轮次不会到达 child（README:145）。
- **每轮追加 prompt 不破坏 KV cache**：cache 要求前缀逐字不变，追加不修改前缀；
  DSH 自身也用「appended after retained history, preserving the prior cached
  prefix」处理 runtime context（`dsh-sandbox-policy` README:140）。
  每轮重述的真实代价是 token 体积与信噪比，不是 cache miss。
- **深度封顶今天已生效**：`/bind` 候选来自 `ctx.sessions.list()`，
  `resolve-session.ts:33` 排除带 `parentSession` 的会话，而 qa child 正是子代理，
  因此 child 不能再被 `/bind`。spec 尚无对应 Requirement，属于未固化的现状。
- **fan-out 今天被 scope key 挡死**：`bind.ts:124 sessionOccupancy` +
  `qaScopeKeyOf = qa:<sessionId>`（`occupancy.ts:33`）使一个源会话只能有一个
  未归档 qa Task，第二次 `-b` 同一源会话固定失败。
