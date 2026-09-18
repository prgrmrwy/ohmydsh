## Context

**当前状态**：`packages/worktree-session/src/client/controls.tsx:90` 的 `openWorktreeInEditor` 固定产出 `vscode://file/<path>` 并 `window.open`。唯一调用点是 `controls.tsx:169` 的 `openBranch`（分支名 span）。该函数是模块内私有，未导出给其它 package。

**失败场景**：DSH 跑在 VM 上，用户经 dsh-cockpit iframe 从宿主机浏览器访问。深链由宿主机浏览器交给系统 handler，宿主机 VS Code 在本地文件系统查找 VM 路径，失败。

**关键洞察**：深链**不需要跨机器传输**——触发它的浏览器进程本来就在宿主机上。缺的只是 authority 信息。VS Code 为此提供 `vscode://vscode-remote/<authority><path>`，其中 `ssh-remote+<alias>` 形态由 Remote-SSH 扩展解析（[CLI 文档](https://code.visualstudio.com/docs/configure/command-line)）。

**已有材料**（读 `~/opensource/dsh-cockpit` 确认）：

- `packages/shared/src/index.ts:18` `DeviceRecord.sshAlias?: string` —— 正是所需的 authority 材料。
- `packages/cockpit-server/src/connectivity/ssh.ts:44` 的校验正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` **恰好排除 `@` 与 `:`**，保证存的是干净的 SSH config alias，拼进 `ssh-remote+<alias>` 零转义问题。
- `packages/dsh-cockpit-bridge/src/client/index.ts:25` 起已有 `dsh-cockpit:bridge-config` postMessage 通道，`:64` 做双向 origin 严格校验，`:207` 已在反向 post `capability-expired`。**双向通道现成**。

**约束**：

- 本 change 的 `actionContext.allowedEditRoots` 仅含 ohmydsh。dsh-cockpit 是独立仓库。
- 所有者确认：只经 cockpit iframe 访问 VM 上的 DSH，不直连。
- 侧边栏 more action 入口（`dsh-open-in-vscode` 0.1.6）是 remote pin 的第三方包，执行面在 host，本次不碰（BACKLOG B043）。

## Goals / Non-Goals

**Goals:**

- 经 cockpit 访问时，点击分支名能在宿主机 VS Code 中打开 VM 上的 worktree。
- 本机直连场景行为**逐字节不变**。
- 全部失败路径安全降级，不伪造成功。
- 不新增任何远端命令执行面。

**Non-Goals:**

- 修复侧边栏 more action 入口（机制不同，走上游 PR）。
- 静态 `remoteAuthority` 配置兜底（所有者确认不需要，保留为扩展点）。
- 支持 `tunnel+` / `dev-container+` 等其它 authority 形态（本次只做 `ssh-remote+`）。
- 让 cockpit 代理任何远端操作。

## Decisions

### D1：URI 在**父页面**产出，不在 iframe 内

**决定**：iframe 内的 DSH 页面把 `{path}` 经 postMessage 交给父页面，由父页面拼 URI 并 `window.open`。

**理由**：

1. **技术必需**：跨域 iframe 内 `window.open('vscode://...')` 会被浏览器导航策略拦截。
2. **信任边界正确**：alias 是宿主机侧事实，URI 拼装与路径校验放在持有该事实的一侧，iframe 内不需要知道 alias。
3. **最小信息暴露**：iframe 只需发路径，不需要接收 alias。

**备选**：把 alias 下发给 iframe、由 iframe 拼 URI 后 `window.open`。**否决**——被导航策略拦截，且让 alias 无必要地进入内嵌文档。

### D2：能力经 cordis service 暴露，消费方用 `ctx.get()` 探测

**决定**：`dsh-cockpit-bridge` provide 一个服务；`worktree-session` 用 `ctx.get()` 探测。

**理由**：这是 DSH 内同页面插件间通信的既有机制，不需要发明新东西。

**硬约束**：**MUST NOT 写进 `inject`**。依据 `dsh.yaml` 记录的两次实际事故：

- Pet 的 `shellEnv`：「写进 inject 会变必需依赖，Host 缺该服务时 Pet 永不加载」。
- dsh-cockpit-bridge 0.2.1：inject 声明的 `dsh-client-runtime` 被上游移除后，插件在 0.1.2 运行体上「loader 解析不到依赖而**永不激活**（静默）」。

失效模式是**静默不加载**而非报错，排查成本极高，因此这条写进了 spec 而不只是 design。

**备选**：新建独立 package 提供该服务。**否决**——目前只有一个消费者（侧边栏入口机制不同、且改不了），属提前抽象。若将来出现第二个浏览器侧消费者再提升。

### D3：复用既有 `bridge-config` 握手，不新建通道

**决定**：在现有 `dsh-cockpit:bridge-config` 消息里增带 `sshAlias` 字段；新增 `dsh-cockpit:open-in-editor` 作为反向消息。

**理由**：该通道已有严格的双向 origin 校验（`client/index.ts:64`），且父页面已在能力续签路径上维护它。新建通道等于重复实现同一套校验，徒增攻击面。

**兼容性**：`bridge-config` 增加可选字段对旧版 bridge 无影响（未知字段被忽略）；缺 `sshAlias` 时能力不声明可用，消费方按缺失降级。

### D4：路径校验在父页面执行，双重把关

**决定**：父页面收到 `open-in-editor` 后校验：必须绝对路径、不含 `..`，校验失败拒绝且不产出 URI。

**理由**：父页面是唯一能产出 URI 的一侧，把关必须在这里。iframe 侧的校验（`controls.tsx:91` 已有的绝对路径检查）保留但不作为信任依据——**内嵌文档的输入一律视为不可信**。

**为何不做更严的白名单**（如限定在某个根目录下）：worktree 路径由 DSH host 的绑定元数据决定，合法值域本身就是任意绝对路径；过严的白名单会误伤正常场景。当前校验的目标是阻止路径穿越与相对路径歧义，不是做授权。

### D5：`windowId=_blank` 强制新窗口

**决定**：URI 带 `?windowId=_blank`。

**理由**：VS Code 1.67 起该参数强制在新窗口处理 URI。不带则可能复用当前窗口，把用户正在看的本地项目顶掉。

### D6：只支持 `ssh-remote+`，不做 authority 形态抽象

**决定**：本次只产出 `ssh-remote+<alias>`。

**理由**：cockpit 的连接模型就是 SSH（`tunnel-manager.ts` 走 `-L` 端口转发），`DeviceRecord` 里也只有 `sshAlias`。为 `tunnel+` / `dev-container+` 做抽象没有对应的数据来源，属投机。

## Risks / Trade-offs

- **[目录 vs 文件歧义]** URI handler 无法 stat 远端路径，只能靠扩展名猜测。路径含点（如仓库名 `foo.bar`）可能被当成文件打开。CLI 有 `--folder-uri` 可强制，深链没有。→ **缓解**：接受该限制并在文档中注明；这是 VS Code 深链的固有行为（[WSL 文档记录了同样现象](https://code.visualstudio.com/docs/remote/wsl)），非本设计引入。

- **[宿主机未装 Remote-SSH]** `vscode://vscode-remote/...` 会被 VS Code **静默丢弃**，无任何提示。→ **缓解**：spec 要求不伪造成功；文档中列为前置条件。无法在浏览器侧探测扩展是否安装，这是不可消除的边界。

- **[首次连接需交互]** host key 确认、密钥密码会让 VS Code 停在连接中。→ **缓解**：属正常行为，文档说明；不视为失败。

- **[跨仓版本偏移]** bridge 与 cockpit 父页面必须同步升级，否则能力不可用。→ **缓解**：缺 `sshAlias` 即按能力缺失降级，偏移表现为"回落本机行为"而非报错；`dsh.yaml` 的 pin 需在 cockpit 发版后更新。

- **[跨仓协调成本]** 本 change 只能改 ohmydsh，cockpit 侧需另开 change。→ **缓解**：本 spec 作为双方共同契约的真相源；tasks 中标注落地顺序（cockpit 先行，否则 ohmydsh 侧无法端到端验证）。

- **[能力面扩大的滑坡]** 一旦 cockpit 能接收 iframe 的请求执行动作，后续容易被追加更多动作。→ **缓解**：spec 明确「只传输 alias 与路径」「不新增远端执行面」；URI 交给系统 handler 而非任何执行通道，SSH 用途保持仅端口转发。

## Migration Plan

1. **cockpit 先行**：父页面 + bridge 改动，发版 `dsh-cockpit-bridge`。此时 ohmydsh 侧未改，能力被 provide 但无人消费，**无行为变化**。
2. **ohmydsh 跟进**：更新 `dsh.yaml` 的 bridge pin，改 `controls.tsx` 加探测，`dsh build`，重启 DSH web。
3. **回滚**：任一侧回退即自动回落本机 `vscode://file/` 行为——降级路径是设计的一部分，回滚不需要额外动作。

## Open Questions

- **服务名与消息 type 的最终命名**：需与 cockpit 仓的既有命名惯例对齐（现有前缀是 `dsh-cockpit:`）。实施时确定，不影响本设计成立。
- **cockpit 侧 change 的粒度**：是并入现有 bridge 协议 change 还是独立开，由该仓决定。
