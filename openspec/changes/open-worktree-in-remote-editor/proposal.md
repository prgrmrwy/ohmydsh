## Why

Worktree Session 的分支名打开动作当前固定产出 `vscode://file/<绝对路径>`（`packages/worktree-session/src/client/controls.tsx:90`），这是**本机语义**：URI 由浏览器交给系统 handler，宿主机 VS Code 会在**自己的文件系统**上查找该路径。

当 DSH 跑在 VM 上、用户经 dsh-cockpit iframe 从宿主机浏览器访问时，该路径属于 VM，宿主机找不到，打开失败（2026-09-15 实测）。

关键事实是：**深链本身不需要跨机器传输** —— 触发 URI 的浏览器进程本来就在宿主机上。缺的只是把路径标注成「属于哪台机器」的 authority 信息，而 dsh-cockpit 作为宿主机上的多机管理面天然持有它（`DeviceRecord.sshAlias`）。

**但直接让 worktree-session 去消费 cockpit 的能力是错误的耦合方向**：worktree-session 是一个通用的 Worktree Session 插件，它不应该知道 dsh-cockpit 存在；dsh-cockpit 也不应该知道 worktree-session 存在。两者都应保持独立、可各自升级、可各自移除。

因此本变更引入**三段式**：worktree-session 暴露自己的扩展点，dsh-cockpit-bridge 暴露自己的能力，**一个专用 shim 把两者接起来**。耦合汇聚到 shim 这一个可丢弃的点上，与既有的 `subscriptions-sandbox-shim` 同构（该包 README 也写明了移除路径）。

## What Changes

**worktree-session（通用扩展点，不提 cockpit）**

- 新增**打开行为注册点**：允许同页面其它插件在运行时替换「打开 worktree 目录」的实现。命名权与契约归 worktree-session。
- 未注册时保持现有 `vscode://file/` deep link 行为**逐字节不变**。
- 注册方抛错时安全降级回默认实现，不伪造成功。

**新增 shim package（专用耦合点）**

- 读取 dsh-cockpit-bridge 暴露的远程编辑器打开能力，注册进 worktree-session 的扩展点。
- 两端缺任一方即整体不生效，且 MUST NOT 影响任一方正常加载。
- 是本仓库唯一知道「worktree-session 与 dsh-cockpit 同时存在」的地方；移除它即解除耦合，两端均无需改动。

**不在本次范围**

- 侧边栏 workspace more action 的「在 VSCode 中打开」（远端插件 `dsh-open-in-vscode` 0.1.6）。其执行面在 **host**（`spawn` + `code`），host 跑在 VM 上，机制上不成立，且是 remote pin 的第三方包。已记录为 `BACKLOG.md` 的 **[B043]**，走上游 PR。
- 静态 `remoteAuthority` 配置兜底。所有者确认当前只经 cockpit iframe 访问，直连场景不需要。
- 任何新的 host 能力或远端命令执行面。

**BREAKING**：无。未安装 shim 的部署行为完全不变。

## Capabilities

### New Capabilities

- `worktree-open-handler-registry`: worktree-session 的打开行为注册点。定义注册契约、默认实现的保留、注册方异常时的降级、以及注册点 MUST NOT 成为加载期依赖。**该 capability 完全不提 dsh-cockpit** —— 它描述的是一个通用扩展点。
- `cockpit-worktree-open-shim`: 专用耦合 package。定义它如何探测两端、两端缺失时的行为、以及它作为唯一耦合点的边界（不得承载业务逻辑、不得成为两端的依赖、可独立移除）。

### Modified Capabilities

- `source-workspace-worktree-session`: 现有 `Requirement: Editor open behavior is configurable`（`openspec/specs/source-workspace-worktree-session/spec.md:301`）需补充场景——存在已注册的打开行为时优先使用。**原有「默认 `vscode://file/`」表述保持不变**，它描述的是无注册方时的默认，依然成立。

## Impact

**本仓代码**

- `packages/worktree-session/src/client/` — 新增注册点；`controls.tsx:90` 的 `openWorktreeInEditor` 保留为默认实现；`controls.tsx:19` 已有的 `openWorktree` prop 是既有注入口（归档 change `2026-08-21-open-worktree-in-vscode` 留下的），但当前**无任何外部通路可设置它**，需要补上运行时通路。
- `packages/<shim>/` — 新增 package（具体 id 见 design）。
- `dsh.yaml` — 新增 shim 的 local 条目；更新 `dsh-cockpit-bridge` 版本 pin。
- `openspec/specs/` — 新增两个 capability，修改 `source-workspace-worktree-session`。

**外部依赖（dsh-cockpit，不由本 change 实施）**

- 对侧 change `remote-editor-open-seam` 已实现并提交（dsh-cockpit `f3594d9`）：父页面经既有 `bridge-config` 下发合法 `sshAlias`，bridge 0.4.0 provide 稳定服务 `cockpitBridge.editorOpen`；服务在原始用户手势中产出 URI，不新增反向动作消息。自动验证已全绿，尚待发布与跨仓真机验收。
- **落地顺序**：bridge 0.4.0 发布 → 本仓更新精确 pin → shim 端到端生效。shim 在旧 bridge 下探测不到服务并安全无效。

**风险与既有教训**

- 跨插件服务读取**必须用 dotted name 直接 `ctx.get('a.b')`，不得 `ctx.get('a').b`**。后者看似等价，实则被 cordis traceable proxy 的 `get` trap 重新路由回 context proxy 并强制 `inject`，抛 `cannot get property ... without inject` 且以 uncaught promise rejection 逃逸。依据：`packages/dsh-pet/src/client/index.tsx:171-195` 的实测事故与长注释。
- 可选能力**MUST NOT 写进 `inject`**。写入会让缺该服务的 Host 整个插件静默不加载 —— `dsh.yaml` 记录的 Pet `shellEnv` 事故与 dsh-cockpit-bridge 0.2.1→0.3.0 同类教训。
- shim 是耦合点，因此它**必须最薄**：只做探测与转接，不得承载校验、重试、状态或任何业务判断（这些属于两端各自的职责）。
