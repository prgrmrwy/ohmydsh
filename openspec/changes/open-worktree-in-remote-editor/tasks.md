> **顺序依赖**：dsh-cockpit 自动实现已提交为 `f3594d9`，bridge 版本已升到 0.4.0 但尚未发布。本仓 ws 扩展点与 shim 可先完成；发布后更新精确 pin 才能端到端生效。
>
> **架构不变式**：worktree-session 与 dsh-cockpit 互不知晓。耦合只存在于 `cockpit-worktree-open-shim`；架构测试持续断言 ws 源码/依赖不含 cockpit 名字。

## 1. dsh-cockpit 侧（外部仓库）

- [x] 1.1 bridge-config 握手增带并校验可选 `sshAlias`
- [x] 1.2 bridge 0.4.0 provide 稳定、消费方无关的 `cockpitBridge.editorOpen`；`inject` 保持 `['sessions', 'uiSession']`
- [x] 1.3 bridge 服务在原始用户点击链路中校验路径并直接产出 `vscode-remote` URI；无新增 iframe→父页面动作消息
- [x] 1.4 对侧 build/typecheck/lint 与全仓自动测试通过（root 8、shared 1、web 63、bridge 19、server 141）
- [ ] 1.5 对侧真机验收与 current spec 归档
- [ ] 1.6 发布 `dsh-cockpit-bridge@0.4.0`

## 2. worktree-session 扩展点

- [x] 2.1 新增 `worktreeSession.openHandler` 注册点；命名与契约归本包，源码不提任何具体注册方
- [x] 2.2 `openWorktreeInEditor` 保留为默认；有注册实现时只调用注册实现
- [x] 2.3 `client/index.tsx` provide registry，并把 live opener 注入既有 `openWorktree` prop
- [x] 2.4 注册方抛错时捕获并回落默认实现，无未捕获 rejection
- [x] 2.5 注册形成栈；注册方 disposer 恢复上一实现/默认实现，不持有失效引用
- [x] 2.6 `inject` 保持 `['slots', 'sessions', 'conversation']`；注释与单测固定可选依赖约束

## 3. shim package

- [x] 3.1 新建 `packages/cockpit-worktree-open-shim/` 纯浏览器插件
- [x] 3.2 只用完整 dotted name `ctx.get('cockpitBridge.editorOpen')` 与 `ctx.get('worktreeSession.openHandler')`
- [x] 3.3 路径原样转接，不校验、不改写、不持状态、不重试
- [x] 3.4 无顶层 inject；监听 Cordis `internal/service`，支持两端任意加载/卸载顺序，缺任一端安全无效
- [x] 3.5 README 记录职责、前置条件、已知边界与移除路径
- [x] 3.6 `dsh.yaml` 新增 local shim 条目；当前明确记录 bridge 0.3.0 下安全无效
- [ ] 3.7 bridge 0.4.0 发布后，把 `dsh.yaml` 的 remote spec/version 精确 pin 更新到 0.4.0 并补审查记录

## 4. 测试

- [x] 4.1 worktree-session 既有 `vscode://file/` 断言保持通过
- [x] 4.2 有注册实现时 slot 注入的 live opener 走注册实现，不调用默认实现
- [x] 4.3 无注册方时 registry 使用默认实现
- [x] 4.4 注册方抛错时回落默认实现，不向外抛错
- [x] 4.5 disposer 恢复上一实现并最终恢复默认
- [x] 4.6 shim 两端齐备时注册，缺任一端时不注册且不抛错；服务卸载/恢复会 detach/reconnect
- [x] 4.7 shim 测试与仓库级架构断言固定完整 dotted-name 读取方式
- [x] 4.8 架构断言证明 `packages/worktree-session/` 指定源码/依赖不出现 cockpit 名字

## 5. 文档

- [x] 5.1 Worktree Session README 说明运行时注册点与默认回落，且不提 cockpit
- [x] 5.2 `worktree-session-architecture.md` 更新打开动作描述；仓库不存在且 artifact 规则不追踪可重建 `.html`
- [x] 5.3 shim README 说明 Remote-SSH 前置、URI handler 边界和移除路径

## 6. 验证与归档

- [x] 6.1 worktree-session（207 tests）与 shim（4 tests）各自 typecheck/build/test 通过
- [x] 6.2 `node scripts/sync.mjs` 幂等：首次物化 shim，第二次明确 `no changes — deployment already matches manifest`
- [x] 6.3 根 `npm test`（126 pass / 1 skip）与 `npm run check:artifacts` 通过
- [ ] 6.4 bridge 0.4.0 发布并更新 pin 后，真机从 cockpit 访问 VM：点击分支名，宿主机 VS Code 新窗口打开 VM worktree
- [ ] 6.5 真机降级：禁用 shim 后 ws 回落 `vscode://file/`，cockpit 既有功能正常
- [ ] 6.6 两仓 current specs 均同步最终行为后归档各自 change
