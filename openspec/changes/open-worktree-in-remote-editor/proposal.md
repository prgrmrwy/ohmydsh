## Why

Worktree Session 的分支名打开动作当前固定产出 `vscode://file/<绝对路径>`（`packages/worktree-session/src/client/controls.tsx:90`），这是**本机语义**：URI 由浏览器交给系统 handler，宿主机 VS Code 会在**自己的文件系统**上查找该路径。

当 DSH 跑在 VM 上、用户经 dsh-cockpit iframe 从宿主机浏览器访问时，该路径属于 VM，宿主机找不到，打开失败。这是 2026-09-15 实测确认的场景，也是当前跨机器使用 DSH 的主要摩擦点。

关键事实是：**深链本身不需要跨机器传输** —— 触发 URI 的浏览器进程本来就在宿主机上。缺的只是把路径标注成"属于哪台机器"的 authority 信息，而 dsh-cockpit 作为宿主机上的多机管理面，天然持有该信息（`DeviceRecord.sshAlias`）。

## What Changes

- Worktree Session 的打开动作在产出深链前，**探测一个可选的远程编辑器打开能力**；探测到则委派，未探测到则保持现有 `vscode://file/` 行为不变。
- 新增该能力的提供方：由 dsh-cockpit 父页面经既有 bridge postMessage 通道下发 `sshAlias`，最终由**父页面**产出 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank` 并交给系统 handler。
- 委派失败、能力缺失、路径不合法时一律**安全降级**到现有本机深链，不伪造成功。
- 非 BREAKING：本机直连场景（无 cockpit 父页面）行为逐字节不变。

**不在本次范围**：

- 侧边栏 workspace more action 的「在 VSCode 中打开」（远端插件 `dsh-open-in-vscode` 0.1.6）。它的执行面在 **host**（`spawn` + `code`），host 跑在 VM 上，机制上就不成立，且是 remote pin 的第三方包，本仓不改。已记录为 `BACKLOG.md` 的 **[B043]**，走上游 PR。
- 静态 `remoteAuthority` 配置兜底。所有者确认当前**只经 cockpit iframe 访问** VM 上的 DSH，直连场景不需要；保留为将来可加的扩展点，本次不实现。
- 任何新的 host 能力、远端命令执行面、或 SSH 连接用途扩展。cockpit 的 SSH 仍然只做端口转发。

## Capabilities

### New Capabilities
- `remote-editor-open-seam`: 一个可选的、浏览器侧的远程编辑器打开接缝。定义能力的探测契约、`sshAlias` 的传递与校验、URI 产出位置与路径白名单、以及全部失败路径的降级语义。跨越 ohmydsh（消费方）与 dsh-cockpit（提供方）两个仓库，本 spec 是双方共同的行为契约。

### Modified Capabilities
- `source-workspace-worktree-session`: 现有 `Requirement: Editor open behavior is configurable`（`openspec/specs/source-workspace-worktree-session/spec.md:301`）需补充一条场景——存在可选远程打开能力时优先委派。**原有"默认 `vscode://file/`"的表述保持不变**，它描述的是无远程能力时的默认，依然成立。

## Impact

**ohmydsh（本仓，`allowedEditRoots` 内）**

- `packages/worktree-session/src/client/controls.tsx` — `openWorktreeInEditor` 前置一次能力探测；现有实现保留为 fallback。
- `packages/worktree-session/test/controls.test.ts` — 补委派与降级两条路径的断言；现有 `vscode://file/` 断言不动。
- `openspec/specs/` — 新增 `remote-editor-open-seam`，修改 `source-workspace-worktree-session`。

**dsh-cockpit（外部仓库，`~/opensource/dsh-cockpit`）**

- `packages/cockpit-web` — 父页面 `bridge-config` 握手增带 `sshAlias`；新增 `open-in-editor` 消息接收端（URI 在此产出，路径校验在此执行）。
- `packages/dsh-cockpit-bridge` — provide 能力给同页面其它插件；现有 `inject = ['sessions', 'uiSession']` 不变。
- 需要发版并更新本仓 `dsh.yaml` 的 `dsh-cockpit-bridge` 版本 pin（当前 0.3.0）。

**跨仓协调约束**：本 change 的 `actionContext.allowedEditRoots` 仅含 ohmydsh。dsh-cockpit 侧改动**不由本 change 直接实施**，需在该仓自行开 change；本 spec 承担双方契约的真相源，tasks 中明确标注跨仓边界与落地顺序。

**风险与既有教训**

- 能力探测**必须用 `ctx.get()`，不得写入 `inject`**。写入 `inject` 会让缺该服务的 Host 整个插件静默不加载 —— 这是 `dsh.yaml` 记录的 Pet `shellEnv` 事故与 dsh-cockpit-bridge 0.2.1→0.3.0 的同类教训。
- 传输面只增加一个 SSH alias 与一个绝对路径，不含凭据、不含会话内容，与 bridge 现有最小化原则同构。
- 不新增任何远端执行面：URI 交给系统 handler，SSH 连接用途不变。
