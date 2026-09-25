## Context

**当前状态**：`packages/worktree-session/src/client/controls.tsx:90` 的 `openWorktreeInEditor` 固定产出 `vscode://file/<path>` 并 `window.open`。唯一调用点是 `controls.tsx:169` 的 `openBranch`（分支名 span）。

`controls.tsx:19` 已有 `openWorktree?: (path: string) => void` prop —— 归档 change `2026-08-21-open-worktree-in-vscode` 为「后续支持其它编辑器」留下的口。但 `client/index.tsx:14-19` 的 slot 注册把 props 写死，**没有任何外部通路能设置它**。所以"支持注入"是真实的新增能力，不是现成的。

**失败场景**：DSH 跑在 VM 上，用户经 dsh-cockpit iframe 从宿主机浏览器访问。深链由宿主机浏览器交给系统 handler，宿主机 VS Code 在本地文件系统查找 VM 路径，失败。

**关键洞察**：深链**不需要跨机器传输**——触发它的浏览器进程本来就在宿主机上。缺的只是 authority 信息。VS Code 为此提供 `vscode://vscode-remote/<authority><path>`。

**已有材料**（读 `~/opensource/dsh-cockpit` 确认）：

- `packages/shared/src/index.ts:18` `DeviceRecord.sshAlias?: string`。
- `packages/cockpit-server/src/connectivity/ssh.ts:44` 校验正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` **恰好排除 `@` 与 `:`**，保证是干净的 SSH config alias。
- `packages/dsh-cockpit-bridge/src/client/index.ts:25` 起已有 `dsh-cockpit:bridge-config` postMessage 通道，`:64` 双向 origin 校验，`:207` 已在反向 post。

**核心约束（本轮设计的决定性输入）**：worktree-session 与 dsh-cockpit 必须**互不知晓**。两者是独立演进、独立安装、独立移除的插件；让任一方知道对方存在都是错误的耦合方向。

## Goals / Non-Goals

**Goals:**

- 经 cockpit 访问时，点击分支名能在宿主机 VS Code 中打开 VM 上的 worktree。
- **两端零互知**：worktree-session 不提 cockpit，cockpit 不提 worktree-session。
- 耦合汇聚到单个可丢弃的 shim，移除即解耦。
- 本机直连场景行为**逐字节不变**；未装 shim 的部署行为不变。
- 全部失败路径安全降级，不伪造成功。

**Non-Goals:**

- 修复侧边栏 more action 入口（机制不同，走上游 PR，见 B043）。
- 静态 `remoteAuthority` 配置兜底。
- 让 shim 成为通用的插件间 RPC 层。
- 支持 `tunnel+` / `dev-container+` 等其它 authority 形态。

## Decisions

### D1：三段式而非直连

**决定**：

```
dsh-cockpit-bridge ──provide──▶ shim ──register──▶ worktree-session
      (不知道 ws)                              (不知道 cockpit)
```

**理由**：直连方案（ws 直接 `ctx.get('cockpit.xxx')`）会把 cockpit 的服务名写进 ws 的源码，使 ws 永久携带对 cockpit 的知识。三段式让耦合只存在于 shim 一个 package，且该 package 可独立移除。

**先例**：`packages/subscriptions-sandbox-shim` 是同构的"专用缓解/耦合 package"，其 README 明确记录了存在理由与移除路径。本 shim 沿用该惯例。

**代价**：多一个 package 的 build/test/manifest 开销，以及多一跳间接。接受——换来的是两端各自的 spec 都能保持干净（ws 的 capability 完全不提 cockpit），这在规范层面比省一个 package 更有价值。

### D2：ws 暴露注册点，而非读取约定名

**决定**：worktree-session provide 一个自己命名的注册点，shim 作为注册方调用它。

**理由**：

1. **命名权归属正确**——扩展点是 ws 的地盘，契约由它定义，它不需要知道谁会来注册。
2. **时序更宽松**——shim 晚于 ws 加载也能生效（后注册对后续动作生效）；反向方案要求 shim 必须先于首次点击完成 provide。
3. **spec 更干净**——ws 的 capability 描述"我支持替换打开行为"，无需引入任何外部约定名。

**备选**：ws `ctx.get('<约定名>')` 探测，shim provide 该名。**否决**——约定名是"第三方约定"，写进 ws 的 spec 就等于引入了一个 ws 无法单独定义的概念；且有加载时序约束。

### D3：shim 必须最薄——只探测与转接

**决定**：shim 只做三件事：探测两端、转接路径、注册。不做校验、不拼 URI、不重试、不持状态。

**理由**：shim 是耦合点，**耦合点承载的逻辑越多，解耦成本越高**。路径校验与 URI 拼装属于 cockpit 侧职责（它持有 alias、它是唯一能产出 URI 的一方，且其 spec 已要求父页面独立校验）；降级属于 ws 侧职责（它有默认实现）。shim 只负责"把 A 接到 B"。

这条写进 spec 而非仅 design，因为它约束的是**未来的改动**——防止 shim 逐渐长成一个业务层。

### D4：跨插件服务读取必须用完整 dotted name

**决定**：shim 读 cockpit 能力时必须 `ctx.get('a.b')`，禁止 `ctx.get('a').b`。

**理由**：`packages/dsh-pet/src/client/index.tsx:171-195` 记录了实测事故——`ctx.get('remote')` 返回的是 cordis traceable proxy，其 `get` trap 会把任何注册为 `<service>.<name>` 的属性**重新路由回 context proxy**，而 context proxy 强制 `inject`。结果是抛 `cannot get property "remote.directoryPicker" without inject`，且以 uncaught promise rejection 逃逸出 click handler。

`ctx.get(name)` 是文档化的 inject-free 读取，正是可降级语义所需。

### D5：一切通信经 bridge，shim 不自建通道

**决定**：shim MUST NOT 自行 `window.parent.postMessage`；跨文档通信一律经 dsh-cockpit-bridge。

**理由**：origin 校验、capability 续签、失败重试这些易错逻辑应当只有一份实现。cockpit 侧 spec 已相应收紧为"设备页面与驾驶舱之间的一切通信必须经 bridge"。

### D6：URI 在 bridge 服务中、原始用户手势内产出

**决定**：cockpit 父页面仅经既有 `bridge-config` 握手下发合法 `sshAlias`；bridge 0.4.0 的稳定服务 `cockpitBridge.editorOpen` 在消费方点击调用的同一同步链路中校验路径、拼装 URI 并 `window.open`。

**理由**：现有 `vscode://file/` 已能从 iframe 拉起宿主机 VS Code，证明 iframe 的原始用户手势可启动外部协议，失败仅因路径被按本机语义解释。若改成 iframe `postMessage` 后由父页面异步 `window.open`，用户激活不会跨消息事件传播，反而可能被 popup blocker 拦截，同时无必要地新增第一条命令式反向通道。alias 仍只通过唯一 bridge 通信切面下发；其它插件只消费 bridge 的同页面 Cordis 服务。

## Risks / Trade-offs

- **[多一层间接的调试成本]** 故障可能出在三处任一。→ **缓解**：每一跳都有明确的降级语义与可观察的失败面；shim 最薄意味着它几乎不可能是故障源。

- **[shim 逐渐变厚]** 将来容易往 shim 里塞逻辑。→ **缓解**：D3 写进 spec（「不承载业务逻辑」带 scenario），新增逻辑必须过 spec。

- **[ws 的注册点被滥用]** 注册点可能被用来做与"打开 worktree"无关的事。→ **缓解**：契约限定为「接收绝对路径、执行打开」，且 spec 明确注册方不得经该契约回传需 ws 解释的业务数据。

- **[dotted name 读取事故]** 误写成 `ctx.get('a').b` 会静默失败（uncaught rejection）。→ **缓解**：D4 写进 spec 与实现注释，并在 shim 的测试中覆盖。

- **[宿主机未装 Remote-SSH]** URI 被 VS Code **静默丢弃**，无提示。→ **缓解**：spec 要求不伪造成功；文档列为前置条件。浏览器侧无法探测扩展安装状态，这是不可消除的边界。

- **[目录 vs 文件歧义]** 路径含点（如仓库名 `foo.bar`）可能被当作文件打开。→ **缓解**：接受并在文档注明；这是 VS Code 深链的固有行为，非本设计引入。

- **[跨仓版本偏移]** bridge 与 cockpit 父页面必须同步升级。→ **缓解**：能力缺失即降级，偏移表现为"回落本机行为"而非报错。

## Migration Plan

1. **cockpit 先行**：对侧 change `remote-editor-open-seam` 落地并发版 bridge。此时能力被 provide 但无消费方，**无行为变化**。
2. **ws 扩展点**：本仓实现注册点。此时无注册方，行为不变。
3. **shim 接入**：新增 shim package + manifest 条目，`dsh build`，重启 DSH web。端到端生效。
4. **回滚**：三层任一回退即自动回落本机 `vscode://file/`。移除 shim 条目是成本最低的解耦动作，两端均无需改动。

## Open Questions

- shim 的 package id 与 ws 注册点的最终命名，实施时按仓内惯例确定。
- cockpit 侧暴露的服务名由对侧 change 决定；shim 需在其确定后对齐（这正是 shim 存在的价值——对齐成本被限制在一个 package 内）。
