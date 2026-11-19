## Why

问题常常先出现在飞书上：有人反馈时还没有对应的研发会话跟进。此时在单聊、话题或群里 at bot，Pet 会在 **default workspace** 自动新建工作主会话（W）。所有者有很多可用工作区，default 往往不是问题所在的仓库，结果只能事后手工改绑或重建。

同时，自动新建的 W 当前固定挂 Pet 自有的 `dsh-pet-executor` preset（`packages/dsh-pet/src/host/locus/dsh-port.ts:390`），看起来像一个“Pet 执行会话”，而不是所有者日常使用的普通会话。最初固定它，是因为 locus 子会话当年从父会话派生组合；`pet-locus-child-preset-decoupled` 与三层 Locus 之后，子会话的父是 locus 主会话（M），并固定使用 `locus-child` preset，W 的 preset 已不影响子会话的安全面，这个固定已没有理由。

## What Changes

- 首次在未建立入口的 IM 单聊、群或话题中 at bot 时，allowlist 成员可写 `@bot -w <工作区名> <工作要求>`（同义：`--workspace <名>`、`--workspace=<名>`），按工作区**标题**精确匹配（区分大小写、不做前缀/模糊匹配）到一个已注册且目录可用的工作区，在其中新建 W；投递给子会话的正文是去掉该参数后的工作要求。
- 匹配失败时失败关闭：找不到或重名都回执原因，不创建任何会话、不投递该消息，MUST NOT 退回 default workspace。回执不列出本机工作区名，只提示到 Pet 设置查看。
- 入口已存在时：`-w` 指向的工作区与入口当前 W 的工作区相同，则照常投递（去掉参数）；不同则拒绝并回执“该群已由 <W 标签> 跟进”，不投递、不改绑。
- 话题首次 at 带 `-w` 会补出群行，整个群从此归属该工作区下的 W（沿用现有“群行与话题行同 W”的同构模型）。
- `-w` 仅 allowlist 成员可用；非 allowlist 成员的 `-w` 与其它控制命令一样静默拒绝。帮助回执列出 `-w`。
- 自动新建的 W（IM auto 与文档评论 auto 共用）改用 Host 当前默认 preset（`agentPresets.defaultId`，即所有者在 DSH 中为新会话选择的默认值），不再固定 `dsh-pet-executor`。**BREAKING（行为）**：新建 W 的工具面变为默认 preset 的工具面；已存在的 W 不迁移。
- 本次不改文档评论入口的工作区选择（文档仍只用 default workspace）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`：入口建立统一路径中 auto W 的工作区来源（default 或 `-w` 指定）与 preset；新增 `-w` 解析、匹配、冲突与失败回执要求；控制命令帮助列出 `-w`。

## Impact

- `packages/dsh-pet/src/host/locus/admission.ts`：命令表与解析器新增工作区选择参数，返回去掉参数后的正文。
- `packages/dsh-pet/src/host/channel/locus-controller.ts`：准入结果携带工作区名，经 `ensureForDelivery` 传入建立路径；已存在入口的同/异工作区检查与拒绝回执。
- `packages/dsh-pet/src/host/locus/resolution.ts`、`controller.ts`：`ensureGroup`/`ensureTopic`/`provisionChatLocked`/`createAutoWorkSession` 接受可选工作区名。
- `packages/dsh-pet/src/host/locus/dsh-port.ts`：新增按标题解析工作区；`createMainSession` 使用 `agentPresets.defaultId`。
- 测试：`locus-admission`、`locus-controller`、`locus-dsh-port`、`locus-host-wiring` 相关用例；无数据迁移、无新依赖、无 manifest 变化。
