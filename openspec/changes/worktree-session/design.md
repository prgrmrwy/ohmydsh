# Design: worktree-session

## Context

动机与用户行为见 `proposal.md`，规范见 `specs/worktree-session/spec.md`。影响方案的已核实事实：

- DSH Web 的首页并非“尚无 Session”：选择 Workspace 后已有一个 blank Session；真正要保证的是该 Session 不收到首条消息、不启动 turn，目标 Session 从创建时即绑定 worktree Workspace/cwd。
- `conversation.input.left` 是 session-scoped list slot，首页 blank Session 也会渲染，适合放 base chip 与 Worktree toggle；侧边栏无需改动。
- 官方 `workspaces.create({path})` 幂等注册真实 Workspace，`connectWorkspace(workspaceId)` 复用或创建其 blank Session；官方 Workspace 切换路径已实现文本/图片草稿搬运。
- 官方输入最终汇入每个 Session 的 `SessionInput.submit()`；`ctx.conversation.input.for(ctx.sessions.scope(id))` 可按 Session 取得 facade，其 state 暴露 draft、image ids、phase 与 reference occurrences。当前没有通用的“pre-submit middleware”注册点。
- `conversation.composer` takeover 会替换整张 composer，需要复制官方 InputBar、权限/计划/附件/模型控件并承担版本漂移，不适合作为首选拦截边界。
- 当前仓库为单根 npm 项目，`package-lock.json` 是依赖指纹，根 `node_modules` 可独立缓存；`bin/dsh` 会 source worktree 自己的 `.env.local`，`scripts/sync.mjs` 尊重 `DSH_HOME`。
- 参考项目 `LaoYueHanNi/dsh-git-worktree`（MIT）已验证 branch chip、`conversation.input.left`、Host HTTP 路由、Git worktree 与 Workspace 跳转模式，但其选择的是“目标分支并立即创建/复用”，不是本 change 的“选择 base、首次发送时创建新 task branch”。

## Goals / Non-Goals

**Goals:**

- 保留官方 composer 的完整交互，只在 armed blank Session 的提交边界前接管一次。
- 将 Git、依赖和本地环境准备做成可恢复的 Host operation，再由 Client 完成 Workspace/Session/草稿编排。
- 主 checkout 永不因 WS 启动而 checkout/reset；同一 base 可并发启动多个独立任务。
- 当前仓库先形成可测试的 lean/mutable 闭环，而不提前抽象未经验证的多生态 adapter。
- 失败时保持“未发送”这一事实，允许确定性重试与安全清理。

**Non-Goals:**

- 不修改侧边栏 New Session，也不在选择 base/toggle 时提前创建资源。
- 不在首版实现 `/ws setup`、自动识别任意仓库、pnpm/Rush adapter；这些列入本 change 的 deferred backlog。
- 不原地切换主 checkout 分支，不自动 fetch/reset base，不自动 push/merge/delete remote branch。
- 不让同一正在运行的 DSH Host 按 Session 切换进程级 `DSH_HOME`；隔离 home 仅用于 worktree 内 ohmydsh 开发构建。
- 不把任务 backlog 写入仓库根 `BACKLOG.md`，也不在每个 worktree 创建运行时 backlog 文件。

## Decisions

### D1：交付为一个本地 Host + Client bundle，`/ws` skill 只承载运维入口

新增 `packages/worktree-session/`，同一包输出：

- Host：Git/operation/依赖准备 API；
- Client：base chip、toggle、提交拦截与 Workspace/Session 编排；
- `wire`：请求/响应与阶段枚举；
- bundle patch：单行挂载。

另增 `skills/ws/`，提供 status/promote/clean 的操作说明与仓库无关脚本入口。manifest 按现有 `repo-layout` 约定分别登记 package 与 skill。

- 备选 A：仅 skill + bash 脚本——无法在用户点击发送之前可靠接管 Web 输入，也无法原子切换 Session，放弃。
- 备选 B：在 `dsh-git-worktree` 外再挂一个插件——两个插件会并列相似 UI，且无法把 setup 插进其“创建后立即跳转”事务，放弃。
- 备选 C：直接依赖第三方插件——其 branch 语义、依赖状态和失败恢复均不满足规范，放弃。

采用参考源码/视觉时保留 MIT LICENSE、README attribution 与 manifest note；运行时不依赖第三方包。

### D2：输入框 UI 复用 `conversation.input.left`，base 选择无副作用

Client 在 `conversation.input.left` 注册一个 order 靠后的 segmented control：

```text
[ branch: main ▾ ][□ Worktree]
```

status API 返回当前 repo、current branch、local refs、remote refs 与 worktree 占用信息。选择项只写入以 source Session id 为键的 Client store：

```ts
{ enabled, baseRef, operationId?, phase, error? }
```

base 默认为当前 branch；若 detached，则要求用户选择可解析 ref。开关仅在 `session.blank` 且 repo 探测成功时出现。Session 变为非 blank、cwd 改变或组件销毁时，未开始的 stage 被清除。

与参考插件不同：不提供 `/switch` 路由，不因选择 ref 调用 Git，不把“已在 worktree 检出”视为复用途径，因为所选 ref 是 base 而不是 task branch。

### D3：保留官方 InputBar，通过装饰 SessionInput facade 拦截首次 submit

当前 DSH 没有 pre-submit 注册表。为避免替换整张 composer，Client 在 armed 时取得 source facade：

```ts
const actx = ctx.sessions.scope(sourceSessionId)
const input = ctx.conversation.input.for(actx)
```

以 WeakMap/每 Session guard 保存原始 `submit`，把 facade 的 `submit(mode?)` 临时装饰为 WS single-flight handler。官方键盘、发送按钮、权限/计划/附件/模型仍调用同一个 facade，因此 UI 不变。关闭 toggle、成功 handoff、Session 不再 blank 或插件 dispose 时恢复原方法；重复 arm 不叠加包装。启动时先验证属性可写且 identity 未被第三方替换，异常则禁用 WS 并给出兼容错误，绝不半接管。

handler 的入口顺序：

1. 校验仍为 blank、armed、input phase 可提交；
2. 检查 occurrence/claim 形态；
3. 快照 draft、image ids、submit mode，并进入 single-flight；
4. 调 Host start API；
5. 注册/连接目标 Workspace/Session；
6. 将文本与图片 ids 加入目标 facade；
7. 打开目标 Session，调用目标 facade 原始 `submit(mode)`；
8. 目标 input 接受后清理 source 草稿/图片并解除 source 包装。

- 备选 A：`conversation.composer` takeover——会复制官方 InputBar 与多个 seat，升级风险和 UI 偏差过大，放弃。
- 备选 B：DOM capture/覆盖发送按钮——依赖 DOM 结构且漏掉键盘/程序化提交，放弃。
- 备选 C：slash input trigger——只仲裁 `/`/`@`，不能拦截普通任务，放弃。
- 长期替代：若 DSH 上游提供正式 pre-submit middleware，迁移到官方 seam 并删除 facade decoration；规范不变。

### D4：Client/Host 分割事务，operation id 贯穿重试

单次启动由 Client 生成 UUID `operationId`。Host start 请求：

```ts
{
  operationId,
  repoPath,
  baseRef,
  taskText,
  dependencyMode: 'lean'
}
```

Host 只负责文件系统/Git/依赖/环境事实，返回：

```ts
{
  operationId,
  phase: 'prepared',
  worktreePath,
  taskBranch,
  baseCommit,
  lockFingerprint,
  dshHome
}
```

Workspace 注册和 Session 创建留在 Client，使用 DSH 官方对象层，避免 Host 私接 Workspace registry。Client 在 operation store 中补记 workspaceId/targetSessionId/submit latch；Host durable state不宣称知道消息是否已发送。

持久阶段：

```text
allocated → branch-created → worktree-created
          → dependencies-ready → environment-ready → prepared
```

状态文件位于 Git common dir 的 `ws/operations/<id>.json`，原子临时文件 + rename 写入。相同 operation 重试逐阶段验证并复用；名称相同但 operation 不同绝不复用。Host 在 common dir 使用 mkdir 型仓库锁串行分配 branch/path 与更新元数据，避免两个浏览器/tab 冲突。

Client 在 Workspace/Session 后半段使用同一 in-flight promise；若 target blank Session 已创建则复用。调用目标 submit 前设置 client latch，settlement 后禁止再次 handoff。页面刷新造成 Client latch 丢失时，Host operation 只恢复到 `prepared`，Client必须重新连接一个仍 blank 的目标 Session；若目标已非 blank，则视为已开始并只导航，不再重发。该规则优先避免重复任务。

### D5：task branch/path 从 base 与首条任务确定性分配

Host 不调用 LLM。命名规则：

1. 从首条文本提取 ASCII 字母数字 token，小写并用 `-` 连接；
2. 过滤 Git ref/path 非法片段，限制 slug 长度；
3. 无可用 token 时使用 `task-<shortHash(taskText)>`；
4. branch 为 `ws/<slug>`，worktree 为 `<main>/.worktrees/<slug>`；
5. 冲突时在仓库锁内追加 `-2`、`-3`，并用 `git check-ref-format --branch` 校验。

baseRef 先解析为 commit 并记录 `baseCommit`，随后运行等价命令：

```bash
git worktree add -b <taskBranch> <worktreePath> <baseCommit>
```

用 commit 而非浮动 ref保证 operation 重试不因 ref 后续移动改变基线。绝不 checkout/reset 主 checkout，也不默认 fetch；用户看到的 base 列表来自本地 refs。

### D6：worktree 与 WS 元数据位于当前仓库安全边界

首版路径：

```text
<main-checkout>/.worktrees/<slug>/       # Agent workspace
<git-common-dir>/ws/
  operations/<id>.json
  cache/npm/<lockHash>/
  locks/repo.lock/
  dsh-home/<id>/
```

初始化时幂等写入 Git common dir 的 `info/exclude`：

```text
/.worktrees/
```

不修改项目 `.gitignore`。仓库内 worktree 使 DSH `workspace-write` 的路径仍落在原 workspace 边界内；Git common dir 元数据由 Host 插件管理，不暴露为 Agent 的普通任务目录。

- 备选 sibling worktree：更传统，但在 DSH 文件沙箱中常落到 session workspace 外并触发权限问题，首版放弃。
- 备选 `~/.dsh/worktrees`：跨 repo 集中但同样超出项目 workspace 边界，且开发文件与 DSH home 生命周期耦合，放弃。

### D7：npm lean 缓存按 lockfile 内容寻址，promote 才允许变更依赖

lock fingerprint 为根 `package-lock.json` 内容哈希，并纳入 Node major/npm major，避免不兼容安装结果误复用。缓存根：

```text
<git-common-dir>/ws/cache/npm/<fingerprint>/
  package.json
  package-lock.json
  node_modules/
  ready.json
```

准备流程在 fingerprint 独占锁下完成：复制 package/lock 到临时 cache root，执行 `npm ci`，以 `npm ls` 和关键包存在性校验，通过后写 `ready.json` 并原子切换。worktree 的 `node_modules` 是指向 cache 的 symlink；已存在非预期目录时拒绝覆盖。operation 记录 `dependencyMode: lean` 与 fingerprint。

`/ws promote`：

1. 校验当前目录是已登记 WS worktree且状态为 lean；
2. 移除已验证指向该 cache 的 symlink；
3. 在 worktree 执行 `npm ci`；
4. 校验成功后更新 operation 为 `mutable`；失败时不得伪报 mutable，并保留可恢复说明。

lean 是性能复用而非安全沙箱：缓存对同 fingerprint 的多个任务共享，所以规范禁止把它描述为独占。改变 lockfile 或执行 install/update 前必须 promote。

### D8：`.env.local` 与开发 `DSH_HOME` 隔离，不改变运行 Host

若主 checkout 有被 Git 忽略的 `.env.local`，Host 以 owner-only 权限复制到 worktree；若文件被跟踪则拒绝把它当作本地秘密同步。随后用可重复的 managed block写入/更新：

```bash
# BEGIN worktree-session managed
DSH_HOME='<git-common-dir>/ws/dsh-home/<operationId>'
# END worktree-session managed
```

写前确保路径 shell-safe；原文件其他设置保留。没有源 `.env.local` 时创建只含 managed block 的 ignored 文件。`bin/dsh build` 从 worktree 运行时会读取该 home，因此并行 build 隔离；当前 GUI Host 的进程级 home 不变。真实部署必须走现有显式 `dsh build`/重启流程，不属于 WS start。

### D9：输入迁移先做可判定性检查，再产生 Host 副作用

在 Host start 前检查 source input：

- `phase` 必须为 plain；
- draft 非空；
- `occurrences` 必须为空；
- 不得处于 command claim/submitting；
- 图片 ids 必须全部仍可由 ConversationController 解析。

满足时，Host 准备完成后使用目标 `SessionInput.setDraft`、`addImages`。只有目标完整接受后才从 source 移除；目标 submit 失败则草稿留在目标 Session供重试，source不再自动发送。引用 occurrence 与 slash claim 首版 fail-closed，不做字符串降级。

### D10：状态/promote/clean 由通用脚本执行，skill 负责正确调用

`skills/ws/scripts/ws.sh` 从 cwd 解析 Git common dir和 operation，提供：

```text
status
promote
clean [--dry-run] [path]
```

Host 与脚本复用同一纯 Git/metadata 模块或相同格式契约，避免两套状态定义。clean 条件：目标不是调用者当前 cwd、worktree clean、无进行中的 operation、task HEAD 是指定 base 当前历史的 ancestor（默认仅接受普通 merge 可证明）。证明失败即拒绝；首版不调用 GitHub/Codebase API推断 squash merge，不删 remote branch，不删共享 cache。`--dry-run` 输出计划。

### D11：`/ws setup` 仅作为 deferred backlog，不预埋半成品配置协议

本 change 的 tasks 末尾记录后续项：按 repo 的本机配置位置、trust 模型、LLM 探测产物与 adapter schema。MVP 不创建全局 `~/.dsh/ws.yaml`，也不提交 `.dsh/ws.yaml`，以免在需求未定时固化协议或执行仓库携带的任意命令。

## Risks / Trade-offs

- [装饰 `SessionInput.submit` 不是正式 middleware，DSH 升级可能冻结或替换 facade] → 装饰前做 descriptor/identity 检查；包装幂等且可恢复；兼容失败时禁用 WS而非降级发送；为 upstream pre-submit seam 留迁移边界。
- [Client 在 target submit 的精确 settlement 上缺乏业务回执] → 以 input state/Session blank 投影和 single-flight latch判定；不确定时优先不重发，并导航到目标供用户确认。
- [缓存 `node_modules` 被一个 lean 任务修改会影响同 fingerprint 任务] → UI/skill 明示 lean 为共享只读约定；依赖写操作要求 promote；status 校验链接与 fingerprint。首版不承诺恶意代码级只读隔离。
- [在主仓库内部放嵌套 worktree增加文件扫描成本] → `.git/info/exclude` 排除，路径固定在单一 `.worktrees/`，清理时 prune；这是换取 workspace-write 可达性的显式取舍。
- [复制 `.env.local` 扩散秘密副本] → 仅复制 Git-ignored 文件、owner-only 权限、目录仍在本机仓库边界、clean 随 worktree 删除；日志与 operation state不得记录内容。
- [remote ref 本地陈旧] → MVP明确只使用本地 refs且不隐式 fetch；菜单显示 ref全名，未来可增加显式 refresh。
- [普通 merge ancestry 无法证明 squash merge] → clean 保守拒绝并保留 worktree；后续可增加平台 adapter，但不得通过强删绕过。
- [第三方参考源码许可/归属遗漏] → 保留 MIT LICENSE/NOTICE、README attribution，并在实现审查中区分参考代码与新写代码。

## Migration Plan

1. 新增本地 package 与 ws skill，但先在 manifest 中保持 disabled，完成 Host Git/operation/lean fixture 与 Client 单测。
2. 使用独立测试 `DSH_HOME` 安装 bundle，验证首页 chip、普通发送零影响、armed 首发成功/失败/重试。
3. 在当前 ohmydsh 仓库做真实 Git 冒烟：从 main 并行创建两个任务，确认主 checkout 不变、cwd/branch/lock fingerprint和 build home 均隔离。
4. 验证 promote 和 clean 安全门，运行 package typecheck/tests/build；补齐 LICENSE/NOTICE。
5. 将 `dsh.yaml` 条目启用并执行 `dsh build`；由用户决定何时重启当前 DSH。回滚为禁用 package/skill 后重跑 build；已有 worktree与 operation metadata 保留，供人工清理，不自动删除开发工作。

## Open Questions

（无。`/ws setup`、多仓 adapter 和 squash-merge 平台证明是明确 deferred backlog，不影响本次规范、方案或任务拆分。）
