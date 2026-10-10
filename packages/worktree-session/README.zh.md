# dsh-worktree-session

[English](README.md) · 简体中文

<!-- problem -->
让 AI Agent 直接在你的仓库里干活，它的改动会和你尚未提交的工作混在一起，两个任务也没法并行。Worktree Session 在你发出新会话的第一条消息时，自动为这次任务建一条独立的 Git 分支和一个独立的工作目录，Agent 始终在隔离环境里工作，你的主 checkout 完全不会被碰。

![示意图：Git 会话的第一条消息会创建隔离的任务分支与检出，主检出保持不动](docs/overview.png)

**你能得到什么**

- **默认隔离。** 在空白的 Git 会话里发出第一条消息，就会创建唯一的 `ws/*` 任务分支和 `.worktrees/<task>` checkout；主 checkout 不会被切换、重置，也不会被当作任务根目录。
- **同一会话，无需交接。** 会话仍留在原来的 DSH Workspace 里，不会新建 Workspace 或 Session，首条消息只提交一次。
- **依赖准备很快。** npm 项目把 `node_modules` 链接到共享缓存，pnpm 项目复用 pnpm 全局 store；只有 Agent 真正需要修改依赖时才做完整安装（`promote`）。
- **受约束的执行。** 文件工具、搜索和 Bash 都被限制在 worktree 内，绑定后的会话不会悄悄回到主 checkout 操作。
- **安全清理。** 先 dry run 预览；清理会拒绝有未提交修改、未合并、仍活跃或正在进行中的 worktree，且永不删除远端分支。

**安装。** 在 ohmydsh 里，本 package 由 `dsh.yaml` 管理（条目 `worktree-session`，`source: local`）：设为 `enabled: true` 后运行 `dsh build`。本 README 没有记录独立安装方式。周边仓库见[插件索引](../../README.zh.md#插件索引)。

**快速跳转：**[工作方式](#工作方式) · [依赖模式与 promote](#依赖模式与-promote) · [状态与编辑器集成](#状态与编辑器集成) · [配置](#配置) · [安全守卫](#安全守卫) · [维护与清理](#维护与清理) · [恢复与持久绑定](#恢复与持久绑定) · [运行时假设](#dsh-运行时假设与升级复核) · [开发](#开发) · [归属说明](#归属说明)

## 工作方式

Worktree Session（WS）让**一个 Git 仓库只对应一个 DSH Workspace**。在空白的、基于 Git 的源 Session 里首次提交时，这个需主动开启的流程会创建唯一的 `ws/*` 任务分支和嵌套的 `.worktrees/<task>` checkout，把已有的源 Session 绑定到该 checkout，并通过源 Session 的常规提交路径只提交一次首条消息。

整个流程**不创建目标 Workspace，也不创建目标 Session**。源 Session 留在它的源 Workspace 里，其不可变的 DSH cwd 仍是仓库根目录。WS 另行把 `<repo>/.worktrees/<task>` 视为本地文件、搜索、命令以及被继承的 Agent 执行所用的逻辑**托管执行根**。主 checkout 不会被切换、重置，也不会被当作托管任务根。

准备与交接都可恢复且 fail closed。如果准备或绑定失败，源草稿和所有官方通用附件都保持原样，不会从仓库 checkout 提交。准备并绑定之后，WS 只调用一次官方 SessionInput 的提交；尝试次数、上传、回执、重试、回显收尾和草稿恢复都由 DSH 负责。

项目类型在创建任何分支、worktree、operation 文件或绑定之前，依据仓库根目录的 lockfile 解析。只有一个 `package-lock.json` 或 `pnpm-lock.yaml` 时，分别选择 npm 或 pnpm。两个 lockfile 同时存在时，WS 先采信 `package.json` 中受支持的 `packageManager` 声明，再在恰好一个 lockfile 被 Git 跟踪时采用被跟踪的那个；所选包管理器与被忽略的 lockfile 会记入 operation 诊断。如果没有唯一信号能证明仓库意图，WS 会拒绝请求，而不是猜一个默认包管理器。两个 lockfile 都没有的仓库会在创建任何资源之前以 `UNSUPPORTED_PROJECT` 诊断被拒绝。

在空白会话的界面里，base ref 选择器把每个 ref 显示在单行内（超出以省略号截断，hover 显示全名）。选择 ref 只是暂存选择，没有任何 Git 副作用。

## 依赖模式与 promote

新的 Worktree Session **默认是 lean**：

- npm 的 `lean`：`node_modules` 是指向缓存的、经过校验的链接，缓存由 `package-lock.json`、Node 主版本和 npm 主版本寻址。pnpm 的 `lean` 在绑定的 worktree 内按 `pnpm-lock.yaml` 安装并复用 pnpm 全局 store；因此 workspace 内部链接仍指向该 worktree 自己的源码。在任何安装、删除、更新或其他依赖变更之前，Agent 必须为当前绑定的 Session 运行 `ws promote`。
- `mutable`：对应包管理器的完整安装已成功（npm 为 `npm ci`，pnpm 为 `pnpm install --frozen-lockfile`），且 operation 元数据已更新。只有这时 Agent 才可以变更依赖。

promote 由 Agent 驱动，并保持 Session 绑定不变。它更新元数据和 UI 状态，但不改变稳定的模型运行时上下文。

## 状态与编辑器集成

输入区的状态 UI 持续显示已绑定的任务分支、依赖模式（`lean` 或 `mutable`）和生命周期（`active` 或 `cleaned`）。动态状态不会反复注入对话上下文。

点击已绑定的任务分支，会请求编辑器打开该 Session 的托管 worktree 目录。没有注册适配器时，默认仍是本地 `vscode://file/<path>` deep link。客户端提供运行时注册点，供部署专用的替代实现使用；适配器缺失、未加载或抛错时安全回落到本地默认。Worktree Session 包本身不指名任何适配器，也不在 `inject` 中声明任何适配器。已清理或未绑定的会话不提供打开动作，目标路径始终来自持久绑定。

## 配置

- **Manifest 条目。** 本 package 通过 `dsh.yaml` 中的 `worktree-session` 条目启用；`enabled: false` 只禁用、不移除。
- **`continuableDelegationTools`**（插件 Config，在 `cordis.patch.yml` 中设置；代码默认 `[]`，随包配置为 `[subagent]`）。列出其后台模式经审计属于 continuable 的委派工具，使子 Agent 能在首步之前继承托管执行根。其余所有委派工具对已绑定的 Session 一律拒绝（见[安全守卫](#安全守卫)）。
- **编辑器打开方式。** 默认 `vscode://file/<path>`；其他插件可通过上文所述的客户端注册点在运行时替换。
- **托管的 `.env.local` 块。** 只有当 Git 忽略源 `.env.local` 时才会把它复制进 worktree（否则拒绝准备）。随后 WS 写入一个托管块，把 `DSH_HOME` 指向 `<git-common-dir>/ws/dsh-home/<operationId>` 下的隔离目录。该块只影响在 worktree 内执行的 `bin/dsh build`，不改变已在运行的 GUI Host 的进程 home。

## 安全守卫

已绑定的 Session 在 worktree 之外 fail closed：

- **文件工具、搜索与 Bash。** 路径和 `workdir` 必须是绝对路径且在词法上位于托管 worktree 内，随后再按规范化的物理路径复核（含符号链接祖先目录和尚不存在的输出）。没有显式 worktree `workdir` 的 Bash 会被拒绝。
- **委派。** 只允许上文配置的、经审计的 continuable 后台 `subagent`；前台（`run_in_background: false`）调用会被拒绝。`subagent_fork`、`subagent_codex` 这类一次性 provider 以及未知的委派类工具一律拒绝，因为无法证明子 Agent 在首步前继承了托管根。`send_message` 不受影响。
- **未审计的工具。** 不在审计清单内的工具默认不受影响，除非其参数暴露了路径、cwd、命令等本地能力——此时在复核之前一律拒绝。
- **已清理的绑定。** 清理之后，针对旧执行根的所有工具一律拒绝。
- **稳定上下文。** 对模型可见的上下文只包含持久不变量：仓库根、托管 worktree 根、任务分支、禁止使用主 checkout、显式路径规则，以及变更依赖前先 promote 的指引。分支状态、dirty 状态、时间戳、生命周期阶段、诊断和 lean/mutable 模式属于元数据/UI 或按需的状态输出。

## 维护与清理

对模型可见的 `ws` 工具（`status`、`promote`、`clean`）根据调用它的那个 `ToolExecution.agent.session` 解析 schema-v2 维护目标。`ws clean` 从普通的主 checkout Session 发起（cwd 等于仓库主 checkout，且自身没有 Worktree Session 绑定），只扫描该仓库的 Worktree Session operation；已绑定的 Session 会被提示切换到主 checkout。调用方也可以请求只处理单个 operation 的 `specified` 范围，此时绝不触及其他候选。

Agent 可以传入显式绝对 `path` 来指向另一个 worktree 或仓库，但每次会改变状态的使用都需要用户一次性确认，确认中写明 action 与确切路径。只读预览（带 `dry_run` 的 `clean`）不受此限。沉默、自由文本、缺少提问 provider 或提问被中止，一律视为拒绝。

仓库级清理只处理安全的候选。候选必须通过 active、dirty、in-flight、调用路径与 binding 完整性这些安全门，且其任务分支必须被证明已合入——依据 Git 祖先关系，或依据全量 patch-id 等价（rebase 之后的情形）；清理结果会标明用了哪种依据。已归档的源 Session 直接清理；未归档但其余都安全的候选，经用户一次性确认后可先归档再清理（dry run 期间绝不发起）。拒绝原因按候选逐项报告。

`dsh-ws` CLI 与 Skill shell wrapper 拿不到可信的 Session-id 环境，所以它们的接口仍然显式基于路径：

```text
status /absolute/worktree/path
promote /absolute/worktree/path
clean [--dry-run] /absolute/worktree/path
```

显式路径仍可用于 schema-v2 operation 的 operator 恢复与诊断。务必先 dry run 清理。clean 会拒绝当前所在的、dirty 的、in-flight 的、仍被活跃会话绑定的或未证明合入的 worktree，且永不删除远端分支或共享的 npm 缓存。

清理成功只移除经安全证明的 worktree/分支运行资源，并保留一个精简的 `cleaned` 墓碑记录。历史 Session 不会被删除或移动：它仍在源 Workspace 之下。在它完成归档 → 取消归档的转换之前，重新打开它会提示旧执行根已被清理，并拒绝复用已被移除的路径。

已清理的 Session 被归档再取消归档之后，WS 会自动把它的源绑定标记为终态 `released` 审计历史，并把该 Session 恢复为普通的源 Workspace Session。这会移除已清理状态下的工具守卫、运行时上下文、状态徽标和过期的客户端阶段，且不会创建分支、worktree、Workspace、Session 或 operation。released 状态是单调的，重启后不会被当作当前绑定恢复。恢复后的非空白 Session 仍然不能启动 Worktree 模式：没有 `ws start`，没有绑定复用，也没有会话中途的 Worktree 控制；Worktree 启动始终仅限空白 Session。托管 worktree 已不存在的绑定同样会被自动释放。

## 恢复与持久绑定

operation 记录位于 `<git-common-dir>/ws/operations/<operationId>.json`，保存源 Session 绑定、规范化的仓库路径、托管 worktree、任务分支和依赖元数据。Host 重启或 Session 恢复会在本地执行继续之前重新校验同一个绑定。重复的首次提交重试会复用 operation id 和已准备好的资源。

对于孤立的 operation，用 `dsh-ws status <worktree>` 检查，并保留或提交有用的工作。破坏性清理需要有效的 schema-v2 source-session 绑定；未绑定或格式损坏的 schema-v2 记录会 fail closed，需要 operator 显式修复。切勿越过安全拒绝强行清理。

### 仅支持 schema v2

只支持 `schemaVersion: 2` 的 source-session 绑定。旧的 schema-v1 target-handoff 流程已退役。schema-v1 operation 或任何未知的未来版本都会在读取时被明确的“不支持的版本”诊断拒绝并 fail closed：不会创建、修改或移除任何 worktree、分支、绑定、依赖或 operation 文件，也绝不迁移或伪造绑定。

历史 Session 日志以及已有的 Workspace/Session 注册保持独立、不受触碰。清理安全的 Git 资源绝不意味着删除或改挂历史 DSH Workspace/Session 注册表或历史。

## DSH 运行时假设与升级复核

本集成针对本仓库所固定的那套确切 DSH 组合（根 `dsh.yaml` 中的 `dshVersion`；本 package 的 peer 声明为 `^0.2.0-rc.2`），不是通用的或向前兼容的抽象。它假设以下经测试的契约成立：对模型可见的本地路径工具、Bash `workdir`、文件/搜索路径参数、子 Agent 的创建与继承、Agent 范围的执行前守卫、Session 生命周期钩子，以及确定性的运行时上下文投影/去重。审计过的工具清单是 `src/host/guard.ts` 中的 `TOOL_CONTRACTS` 表；schema 或名称一旦变化，应在发布前让它的清单测试失败。

绑定恢复与被委派子 Agent 的继承都挂在 Agent 发布边界 `agent/created` 上，它对全新创建和冷恢复都会在首个 driver 步骤之前触发。父级绑定无法证明的子 Agent 会否决自身的创建，而不是在源 checkout 里启动。插件热加载时已经存活的 Agent 会被显式补救。本插件不拥有顶层源 Agent 的创建；DSH 将来若提供组合顶层 `create/resume({ setup })` 的 API，应由它取代这个兼容缝。

**每次 DSH 升级都需要一次全新的回归审计**，覆盖已安装的工具清单与参数 schema（工具契约）、子上下文传播、Agent/Session 生命周期缝，以及运行时上下文投影/去重。未知或发生漂移的本地能力契约，在复核并有测试覆盖之前一律视为不受支持；不要假设更新的 DSH 会保持已审计的行为。

## 开发

在仓库根目录用 `npm install` 或 `npm ci` 一次性安装依赖，用 `--workspace dsh-worktree-session` 运行 package 命令。导出的 `lib/` 与 `dsh-ws` CLI 是生成的、被 git 忽略的产物；根目录 sync 会在安装本 local package 之前先构建它们。

当前行为由 [`source-workspace-worktree-session`](../../openspec/specs/source-workspace-worktree-session/spec.md) 规范定义。发布记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 归属说明

实现与交互概念改编自 MIT 项目 [`LaoYueHanNi/dsh-git-worktree`](https://github.com/LaoYueHanNi/dsh-git-worktree)。所审阅的提交、许可授权和确切的改编范围见 [`NOTICE`](NOTICE)。本 package 对该项目没有运行时依赖。

## 延后的待办

MVP 未实现：`/ws setup`、仓库级配置/信任、通用 pnpm/Rush 适配器、显式的网络 ref 刷新，以及由 provider 支持的 squash-merge 证明。这些有意不作为命令暴露。
