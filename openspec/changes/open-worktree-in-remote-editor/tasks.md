> **跨仓边界**：本 change 的 `allowedEditRoots` 仅含 ohmydsh。第 1 组任务位于外部仓库 `~/opensource/dsh-cockpit`，**不由本 change 直接实施**，需在该仓自行开 change 落地；此处列出是为了固定契约与顺序依赖。第 2 组起为本仓可实施范围。
>
> **顺序依赖**：cockpit 侧必须先行，否则本仓侧无法端到端验证（能力探测不到，只能验到降级路径）。

## 1. dsh-cockpit 侧（外部仓库，先行）

- [ ] 1.1 `packages/dsh-cockpit-bridge`：`bridge-config` 消息契约增加可选 `sshAlias` 字段；沿用 `client/index.ts:57-69` 既有的 origin 与字段校验形态，按 spec 的字符约束 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` 校验，不合法即视为未提供
- [ ] 1.2 `packages/dsh-cockpit-bridge`：provide 远程编辑器打开服务（仅在握手带来合法 alias 时声明可用）；服务方法接收绝对路径，向父页面 post `open-in-editor` 消息。**确认 `inject` 保持 `['sessions', 'uiSession']` 不变**
- [ ] 1.3 `packages/cockpit-web`：父页面下发 `bridge-config` 时带上当前设备的 `DeviceRecord.sshAlias`；本机设备（无 alias）不带该字段
- [ ] 1.4 `packages/cockpit-web`：父页面新增 `open-in-editor` 接收端，按 spec 校验路径（必须绝对路径、不含 `..`），拼装 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank` 并 `window.open`；校验失败拒绝且不产出 URI
- [ ] 1.5 cockpit 侧单测：合法 alias 产出预期 URI、非法 alias 被拒、相对路径被拒、含 `..` 路径被拒、非法 origin 消息被丢弃、本机设备不声明能力
- [ ] 1.6 发版 `dsh-cockpit-bridge`（版本号由该仓决定），确认发布物含 host/client 双入口

## 2. 本仓消费侧

- [ ] 2.1 `dsh.yaml`：更新 `dsh-cockpit-bridge` 版本 pin 到 1.6 的发布版本，按仓库惯例在 `note` 中补记本次协议扩展（新增 `sshAlias` 下发与远程打开服务、只传 alias 与路径、不新增远端执行面）
- [ ] 2.2 `packages/worktree-session/src/client/controls.tsx`：`openWorktreeInEditor` 前置一次 `ctx.get()` 能力探测，探测到则委派、未探测到或抛错则回落现有 `vscode://file/` 实现；现有绝对路径前置检查（`controls.tsx:91`）保留
- [ ] 2.3 确认 `packages/worktree-session` 的 client `inject` **未**新增该能力（防止缺提供方时插件静默不加载）；在代码注释中写明该约束与事故依据

## 3. 测试

- [ ] 3.1 `packages/worktree-session/test/controls.test.ts`：现有 `vscode://file/` 两条断言（`:191`、`:203`）保持通过，证明本机路径无回归
- [ ] 3.2 新增：能力存在时点击分支名走委派、不产出 `vscode://file/` 深链
- [ ] 3.3 新增：能力缺失时保持现有 `vscode://file/` 行为，且组件正常渲染
- [ ] 3.4 新增：能力存在但委派抛错时回落 `vscode://file/`，且不报告成功

## 4. 文档

- [ ] 4.1 `packages/worktree-session/README.md`：补注「存在远程打开能力时优先委派，缺失时回落本机 deep link」，并注明前置条件（宿主机装 Remote-SSH）与已知边界（路径含点可能被当作文件打开、未装扩展时静默丢弃）
- [ ] 4.2 `worktree-session-architecture.md` / `.html`：更新打开动作的描述（`worktree-session-architecture.md:59` 当前写死默认 deep link）

## 5. 验证与归档

- [ ] 5.1 运行 `npm test` 与 `packages/worktree-session` 的独立 build / typecheck / test
- [ ] 5.2 运行 `node scripts/sync.mjs`，确认幂等（连续第二次运行无变化）
- [ ] 5.3 运行 `npm run check:artifacts`
- [ ] 5.4 真机验收（经 cockpit 访问 VM 上的 DSH）：点击已绑定会话的分支名，宿主机 VS Code 新窗口打开 VM 上的 worktree 目录
- [ ] 5.5 真机验收（降级路径）：本机设备（无 alias）点击分支名仍按 `vscode://file/` 打开本地目录
- [ ] 5.6 确认 `openspec/specs/` 已反映最终行为后归档本 change
