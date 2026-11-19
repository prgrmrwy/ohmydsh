## Context

- 准入：`admitCommon` 在 `admission.ts:605` 调 `parseLocusControlCommand`，结果非 `none` 即走控制面（`locus-controller.ts:858`），否则作为普通消息带 `needsInitialization` 进入投递。命令表 `LOCUS_COMMAND_TABLE`（`admission.ts:366`）同时驱动解析与帮助。
- 建立：普通消息经 `resolveLocus` → `ensureForDelivery({endpoint, messageId, signal})`（`locus-controller.ts:2219`）→ `resolution.ts` → `controller.ensureGroup/ensureTopic` → `provisionChatLocked` → 无显式 W 时 `createAutoWorkSession`，它只调 `resolveDefaultWorkspace()`（`controller.ts:1022`）。整条链没有携带工作区的参数。
- 自动 W：`dsh-port.ts:390` 固定 `presetId = 'dsh-pet-executor'`，`locus-dsh-port.test.ts:357-375` 刻意断言了这一点（即使 harness 的 `defaultId` 是别的值）。`agentPresets.defaultId` 已在端口依赖里，取值为所有者选择的默认值（`selectedDefault ?? config.default`）。
- 注意事项：见 `docs/architecture/dsh-plugin-integration-pitfalls.md` 与 memex 卡 `dsh-workspace-membership-follows-session-cwd`——W 的 cwd 必须等于目标工作区 path，`attachSession` 才能登记；本 change 只换工作区来源，沿用 `createMainSession` 的 cwd/attach 流程。

## Goals / Non-Goals

**Goals:** 首次 at 能把 auto W 建到指定工作区；匹配失败关闭；自动 W 变成普通会话。

**Non-Goals:** 文档评论的工作区选择；已存在入口的 `-w` 改绑；已有 W 的 preset 迁移；更改 W 的开场简报内容。

## Decisions

1. **`-w` 是消息修饰而不是控制命令。** 解析器只返回 `{kind: 'workspace', name}`（缺名/缺正文为 `workspace-invalid`，归入控制面只回执用法）。解析器看到的是 `withoutLeadingMentions` 清洗过、空白已被压成单个空格的文本，所以它**不产出正文**；正文由准入在原文 `input.text` 上去掉开头 mention 之后第一处 `-w <名>`（或 `--workspace <名>` / `--workspace=<名>`）及其后一个空白得到，其余字符原样保留（换行、缩进不丢）。准入时它与控制命令共用 allowlist 门（非 allowlist → `control-not-allowed`），但 `workspace` 不走控制面：`admitNormalizedLocusEvent` 把它转成 `accepted`，`message.text` 换成去参后的原文，并附 `workspaceName`。投递 prompt 由 `renderPrompt` 读 `message.text`（`index.ts:2897`），所以替换这一处即可。
   - **入口开关**：`admitCommon` 是 IM 与文档评论共用的（`doc-comment.ts:175`）。`CommonAdmissionInput` 新增 `workspaceSelection?: true`，只有 IM 准入（`admission.ts:571`）传入；未传时解析出的 `workspace`/`workspace-invalid` 视为 `none`，文档评论按普通提问投递原文，不进入控制面。
   - 备选：做成 `/bind` 那样的纯命令再让用户另发一条——违背“一条 at 说清”的诉求，否决。
   - 备选：允许非 allowlist 成员使用——选工作区等于选择代码访问范围，否决。
   - 命令表新增一项 `workspace`（verbs `-w`/`--workspace`，usage `-w <工作区名> <工作要求>`），帮助自动列出。
   - 格式错误 `workspace-invalid` 加入 `dispatchControl` 的本地校验列表（`locus-controller.ts:2031`），`controlValidationText` 返回 `-w <工作区名> <工作要求>` 用法；它 MUST NOT 落到 `controlDispatch.dispatch`（`control.ts` 没有该分支，会回执“控制命令执行失败”）。
2. **名字只解析一次，往下传 workspace id。** `resolveLocus` 在调用 `ensureForDelivery` **之前**用端口方法 `resolveWorkspaceByTitle(name)` 解析一次（channel controller 经依赖注入拿到该方法）；失败直接回执、返回，不进入建立链，因此不会写 provisioning 记录。成功得到的 `workspaceId` 经 `ensureForDelivery` → `ensureGroup/Topic` → `provisionChatLocked` → `createAutoWorkSession(…, workspaceId?)` 传下；有 id 时 `createAutoWorkSession` 用 `workspaceRegistry.get(id)` 并重新校验 `status()==='ok'`，否则沿用 `resolveDefaultWorkspace()`。显式 W（`/bind`、Q&A）路径不读取该参数。
   - 备选：把名字传到 `createAutoWorkSession` 再解析——拼写错误也会先 `beginProvisioning` 再失败收尾，而且后置比对要再解析一次，两次结果可能因改名不一致，否决。
   - 备选：临时改 default workspace 配置——并发和持久化副作用不可接受，否决。
3. **匹配在端口层做，返回判别结果。** `resolveWorkspaceByTitle` 遍历 `workspaceRegistry.list()`，`title === name`（严格相等）且 `status() === 'ok'` 才计数；返回 `{ok, workspace} | {ok:false, reason:'not-found'|'ambiguous'}`。控制器抛新的 `LocusControllerError` 码 `WORKSPACE_NOT_FOUND` / `WORKSPACE_AMBIGUOUS` / `WORKSPACE_CONFLICT`，**用户可见文案直接写在 error message 里**（不含其它工作区名；not-found 文案附“不支持含空白的标题，可改用 /bind”）。原因：这些失败发生在投递路径，`resolveLocus` 的回执直接取 `error.message`（`locus-controller.ts:2236-2237`），不经过 `control.ts::safeControlError`，所以不在那里加映射。名字解析失败发生在建立链之外，什么都不写。
4. **同/异工作区比对放在建立或复用之后。** `resolveLocus` 在 `ensureForDelivery` 返回入口之后，若消息带工作区选择：用决策 2 已得到的 workspace id 与该入口群行的 `workspaceId` 比较（不再解析名字）；不同则抛 `WORKSPACE_CONFLICT`（回执“该群已由 <W 标签> 跟进”）、不投递。比较用 workspace id，不比较标题，避免标题改名后误判。
   - 为什么不在 `ensureForDelivery` 之前比对：新群里普通 at 与 `-w B` 并发时，两条都先看到“无入口”，前者在群锁内建出 default 下的群行，后者在群锁内看到群行直接复用（`controller.ts:456-471`），前置检查会漏掉，`-w B` 被静默投递进 default 的 W。另外入口已存在时 `resolution.ts:226-231` 提前返回、根本到不了建立链。后置检查读的是最终实际的群行，三种情况（首次建立、已存在、并发）一处覆盖。
   - 在 `ensureGroup` / `ensureTopic` 的群锁内，对已存在群行先校验 workspace id，冲突立即拒绝，避免追加话题行；保留上述后置校验作为已有入口及并发改绑的防线，确保符合冲突时不改入口行的规范。
   - **延后分支**：`ensureForDelivery` 抛带 `deferred` 的错误时（M 不可用且整 W 迁移被其它 current 投递延后，`locus-controller.ts:2226-2233`），调用方会把消息 `acceptIntoBacklog`，到不了后置比对。带工作区选择的消息在此分支不写 `deferredSink`，改为回执“入口忙，请稍后重试”并返回；不进 backlog。这比在延后时读群行比对更简单，且该情形罕见，重发一次即可。
5. **自动 W 用 `agentPresets.defaultId`。** 在 `createMainSession` 开头读取一次并冻结，同时用于 `meta.agentPreset` 和 `mount`。修改测试断言为 harness 的 `defaultId`。子会话安全不依赖 W：`LOCUS_CHILD_PRESET` 与 locus 主会话锁定不变（spec 已有“子会话工具面不受工作主会话 preset 影响”的场景作回归）。

## Risks / Trade-offs

- [工作区标题重名或为空] → 精确匹配 + 重名失败关闭；无标题的工作区永远不会被匹配到。
- [标题含空白的工作区无法用 `-w` 选择] → 不做引号解析；帮助与 not-found 回执写明限制，指向 `/bind`。
- [正文以 `-w` 开头本意是普通文字] → 只在 mention 之后的第一个词元识别，与现有 `-b`/`-h` 一致；用户可在前面加任意文字绕开。
- [默认 preset 被所有者设成很宽的 preset] → 这是所有者自己新建会话时同样会得到的结果，符合“普通会话”诉求；子会话与 locus 主会话的约束不依赖它。
- [已存在的 W 仍是 `dsh-pet-executor`] → 不迁移；所有者可在 DSH 中自行切换。

## Migration Plan

无数据迁移。部署：`dsh build` 后重启 Host 生效；回滚：回退本 change 的提交后重新 build。
