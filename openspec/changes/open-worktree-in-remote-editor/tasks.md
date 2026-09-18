> **跨仓边界**：本 change 的 `allowedEditRoots` 仅含 ohmydsh。第 1 组位于外部仓库 `~/opensource/dsh-cockpit`，**不由本 change 实施**；对侧 change `remote-editor-open-seam` 已完成规划（4/4 artifacts，`validate --strict` 通过），实施以其 tasks 为准。本组保留为顺序依赖与契约索引。
>
> **顺序依赖**：cockpit → ws 扩展点 → shim。第 2 组不依赖第 1 组（无注册方时行为不变），第 4 组端到端验收依赖第 1 组完成并发版。
>
> **架构不变式**：worktree-session 与 dsh-cockpit **互不知晓**。第 2 组任何产物 MUST NOT 出现 cockpit 的 package 名、服务名或产品名；耦合只允许存在于第 3 组的 shim。

## 1. dsh-cockpit 侧（外部仓库，先行；实施以对侧 change 为准）

> 对侧 change 另含两项本仓规划时未知的内容：① 其 `cockpit-workbench` spec 原有 `Requirement: 远端边界与安全` 明确禁止「将远端路径交给本机打开器」，已经用户确认以 MODIFIED **收窄**为「不以本机路径语义交给」并允许携带显式 remote authority 的引用；② 新增「桥接反向请求的信任边界」requirement（动作集合封闭、父页面独立校验、iframe 输入一律不可信）。本仓侧无需实现，但 MUST NOT 设计出依赖通用 RPC 的消费方式。

- [ ] 1.1 bridge：`bridge-config` 握手增带并校验可选 `sshAlias`
- [ ] 1.2 bridge：provide 远程编辑器打开能力（面向任意同页面插件，非专为某个插件）；确认 `inject` 保持 `['sessions', 'uiSession']` 不变
- [ ] 1.3 cockpit-web：父页面下发 alias、新增 `open-in-editor` 接收端（封闭动作白名单 + 独立校验 + URI 拼装）
- [ ] 1.4 对侧单测与真机验收通过
- [ ] 1.5 收窄后的「远端边界与安全」已反映到 cockpit current specs
- [ ] 1.6 发版 `dsh-cockpit-bridge`，记录其暴露的**完整服务名**（第 3 组需要）

## 2. worktree-session 扩展点（本仓；不依赖第 1 组）

- [ ] 2.1 `packages/worktree-session/src/client/`：新增打开行为注册点；命名由本包拥有，定义中 MUST NOT 出现任何具体注册方的名字
- [ ] 2.2 `controls.tsx`：`openWorktreeInEditor`（`:90`）保留为默认实现不改；`openBranch`（`:169`）改为「有已注册实现则用之，否则用默认」
- [ ] 2.3 `client/index.tsx`：打通运行时通路——当前 slot 注册（`:14-19`）把 props 写死，`openWorktree` prop（`controls.tsx:19`）无外部通路可设置
- [ ] 2.4 注册方抛错时捕获并回落默认实现，不产生未捕获 rejection，不报告成功
- [ ] 2.5 注册方所属 fiber 卸载时自动恢复默认实现，不持有失效引用
- [ ] 2.6 确认注册能力**未**进入 `inject`；在代码注释写明该约束与事故依据（Pet `shellEnv`、bridge 0.2.1）

## 3. shim package（本仓；依赖 1.6 与第 2 组）

- [ ] 3.1 新建 `packages/<shim-id>/`：纯浏览器插件，只做探测两端 + 转接 + 注册
- [ ] 3.2 以**完整 dotted 服务名**一次性 `ctx.get('<完整名>')` 读取 cockpit 能力；**禁止** `ctx.get('<父>').<子>`（cordis traceable proxy 的 `get` trap 会重新路由回 context proxy 并强制 inject，抛 `cannot get property ... without inject` 且以 uncaught rejection 逃逸；依据 `packages/dsh-pet/src/client/index.tsx:171-195`）
- [ ] 3.3 路径原样转接，不校验、不改写、不规范化、不持状态、不重试
- [ ] 3.4 任一端缺失即整体不生效；两端均 MUST NOT 进入 `inject`
- [ ] 3.5 `README.md`：说明为何存在、依赖哪两端、如何移除（与 `packages/subscriptions-sandbox-shim/README.md` 的「移除路径」惯例一致）
- [ ] 3.6 `dsh.yaml`：新增 shim 的 local 条目；更新 `dsh-cockpit-bridge` 版本 pin 到 1.6 的发布版本，并在 `note` 补记本次协议扩展

## 4. 测试

- [ ] 4.1 `packages/worktree-session/test/controls.test.ts`：现有两条 `vscode://file/` 断言（`:191`、`:203`）保持通过，证明无回归
- [ ] 4.2 新增：有已注册实现时点击分支名走该实现，且不产出 `vscode://file/`
- [ ] 4.3 新增：无注册方时保持 `vscode://file/` 行为，组件正常渲染
- [ ] 4.4 新增：注册方抛错时回落默认实现，不报告成功，无未捕获 rejection
- [ ] 4.5 新增：注册方卸载后恢复默认实现
- [ ] 4.6 shim 单测：两端齐备时完成注册；缺任一端时不注册且不抛错
- [ ] 4.7 shim 单测：服务读取使用完整 dotted name（断言读取形态，防止回归成父服务属性访问）
- [ ] 4.8 **架构断言**：`packages/worktree-session/` 源码与依赖中不出现 cockpit 相关名字

## 5. 文档

- [ ] 5.1 `packages/worktree-session/README.md`：补注「支持注册替换打开行为，未注册时回落本机 deep link」——**不提 cockpit**
- [ ] 5.2 `worktree-session-architecture.md` / `.html`：更新打开动作描述（`worktree-session-architecture.md:59` 当前写死默认 deep link）
- [ ] 5.3 shim README 中说明前置条件（宿主机装 Remote-SSH）与已知边界（未装扩展时 URI 静默丢弃、路径含点可能被当作文件打开）

## 6. 验证与归档

- [ ] 6.1 `npm test` 与 `packages/worktree-session`、shim 各自的 build / typecheck / test
- [ ] 6.2 `node scripts/sync.mjs` 幂等（连续第二次无变化）
- [ ] 6.3 `npm run check:artifacts`
- [ ] 6.4 真机验收（经 cockpit 访问 VM）：点击分支名，宿主机 VS Code 新窗口打开 VM 上的 worktree
- [ ] 6.5 真机验收（降级）：移除 shim 条目并重新物化后，ws 回落本机 `vscode://file/`，cockpit 全部既有功能正常 —— 证明解耦可逆
- [ ] 6.6 确认 `openspec/specs/` 已反映最终行为后归档本 change
