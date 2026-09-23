## Context

见 `proposal.md` 的 Why。以下是决定方案形状的实测事实（读 `@touchskyer/memex@0.4.1` 的 `dist/cli.js` 与 `dist/commands/serve-ui.html` 确认，非文档推断）：

- **托管重定向会吞掉整个服务**（`cli.js:41680`）：`if (syncConfig.remote && !opts.local) { open(MEMRA_URL); return null }`。帮助文本把 `--local` 说成 "skip redirect"，读起来像"顺带也打开托管站"，实际是 **early return，本地服务从未创建**。本机 `personal` 正是配了远端的库。
- **自动开浏览器发生在 spawn 的那台机器**（`cli.js:41833`）：默认 `execFile('open', [url])`，由 Host 拉起时会在 **Host 机器**弹窗。需 `MEMEX_NO_OPEN`。
- **端口会漂移**（`cli.js:41818`）：`EADDRINUSE` → `port+1`，最多 10 次；真实端口只出现在 stdout 的 `memex is running at http://localhost:<n>`。
- **一进程一库**（`cli.js:41679` → `resolveMemexHome()` 读 `MEMEX_HOME`）。这与「每个入口一个打开按钮」天然同构。
- **`listen` 的地址参数是硬编码的回环字面量**，不可配置；路由只有 4 条 `GET`（cards / cards/:slug / links / 根）**加一条 `/share-card.js`**（`cli.js:41789`），无写路径。
- **上游 HTML 的路径是绝对的且没有 `<base>`**：5 处 `fetch('/api/…')` + `src="/share-card.js"`。这是「必须跑在根 origin」的直接原因。
- 现有 `runKernel()`（`src/run/kernel.ts`）是 spawn + 有界 timeout + 到点 SIGTERM，**结构上就是"跑完即死"**，长驻服务不能复用它。
- 现有 `/dsh-memex` 通道的纪律：`stores`/`resolve`/`workspaces` 是纯读，`remote` 是唯一写且只做枚举内的远端动作（`src/contract.ts` 头注释）。

## Goals / Non-Goals

**Goals:**

- 零跟随地复用上游浏览 UI：上游改版/加功能，本仓不需要同步修改。
- 每个记忆入口独立可浏览，互不干扰。
- 跨机器可用，且不可用时**明确失败**而不是给出错误地址。
- 新增的进程与端口有明确生命周期，插件停止即回收。

**Non-Goals:**

- 不自研浏览 UI，不改写上游资源，不实现上游 API 的等价物。
- 不做卡片编辑（上游该界面本身就是只读的）。
- 不把浏览服务常驻；不做跨库聚合视图。
- 不在本 change 内实现端口发布能力本身（那在 dsh-cockpit 的 `device-port-forward-seam`）。

## Decisions

### D1. 跑上游 server 在独立端口的**根路径**，而不是挂到 DSH 子路径

这是整个 change 的核心取舍，也是所有者诉求（不自研、不为复用持续付费）唯一能满足的形态。

| | 自己直读卡片、只借 HTML | 反代到 DSH 子路径 | **独立端口根路径** |
|---|---|---|---|
| 上游升级要做什么 | 重新清点端点、补实现、跟 UI 改版 | 路径重写规则跟着 HTML 变 | **基本不用做** |
| 新端口 | 0 | 0 | 1/库 |
| 进程 | 0 | N | N |

前两列都要**持续**付费，且"清点端点"已被证明易漏（本次探索中就漏了 `/share-card.js`）。注意反代**并不省掉** HTML 改写——`fetch('/api/cards')` 挂到子路径下照样 404——却还要多背进程管理，是纯亏。

**代价诚实记录**：多一个端口、多一个进程、以及跨机器时多一条访问路径（D4）。这些是**一次性**成本。

### D2. 长驻服务另起一条 runner，不改 `runKernel()`

`runKernel()` 的 timeout+SIGTERM 是它的正确行为，不应为长驻场景放宽。新增独立的进程管理路径，并遵守 `docs/notes/dsh-plugin-integration-pitfalls.md` 第 2 条：**stdin 用 `'pipe'` 且不写不关**（用 `'ignore'` 会立即 EOF 导致进程以 0 退出），回收用 SIGTERM。

沿用 `runKernel` 已有的 `LC_ALL=C/LANG=C` 注入（内核用英文串判定，本机 zh_CN locale 会让判定落空）与 `MEMEX_HOME` 指定库。

**就绪判定靠解析 stdout 的监听行**，而不是"spawn 成功即就绪"：端口会漂移，且 `return null` 那条重定向分支下进程会直接结束。解析失败 SHALL 视为启动失败。这是又一处随内核版本复核的文本解析，与既有 `sync --status` 解析同性质，在 `dsh.yaml` 的 note 中一并记录。

### D3. 「打开」按钮同步开同源 launcher，不等待就绪

弹窗拦截约束：异步 await 之后再 `window.open` 会脱离原始用户手势链而被拦。cockpit 的 `editorOpen` 因此必须在点击链路中同步产出 URI。

所以按钮只做一件事：同步 `window.open('<DSH 同源 launcher 路径>', '_blank')`。launcher 页面（DSH 侧路由，属于我们自己的资源，**不违反 D1 的零改写**——上游 HTML 仍在自己端口的根上原样跑）负责：

1. 确保该库的浏览服务已就绪（按需启动）
2. 取得可访问地址（D4）
3. 跳转；失败则就地说明原因

**为什么不把三态判断放按钮上**：按钮没有地方好好显示"为什么不能用"，而 launcher 页有整页空间；且三态会随时间变化（服务可能刚崩），按钮渲染时的判断到点击时可能已过期。

**launcher 必须是客户端页面，不能是 Host 的 302**（2026-09-23 定案，原 Open Question 就此关闭）。理由是硬约束而非偏好：取地址这一步要调用驻留在**浏览器**里的注册方（见 D4），Host 无法代劳。因此 launcher 是一个 DSH 同源的客户端路由，它自己完成"问注册点要地址 → 跳转"。

这同时决定了 **Host 与 Client 的职责切分**：

```
Host 侧   按需 spawn memex serve，解析 stdout 得到【实际端口 P】
            │  经既有 /dsh-memex RPC 通道返回 P（新增端点，无需新机制）
            ▼
Client 侧 launcher 页拿到 P → 问注册点要地址 → 跳转
            ├ 有注册方（装了 shim）→ 宿主机可访问 URL
            └ 无注册方            → http://localhost:P
```

Host 只交付**事实**（端口），不交付**地址**——地址是否需要翻译取决于浏览器在哪台机器上，而这件事只有浏览器侧知道。

### D4. 三段式：dsh-memex 暴露注册点，专用 shim 接上 cockpit 能力

**本决定在 2026-09-23 修订**。初稿写的是「dsh-memex 直接 `ctx.get('<中立能力名>')` 消费端口发布」。该形态与本仓**既定范式不一致**，已改为三段式：

```
dsh-cockpit-bridge ──provide──▶  shim  ──register──▶  dsh-memex
     (不知道 memex)                                  (不知道 cockpit)
```

**为什么直连不够**：初稿的理由是"依赖方向指向抽象而非厂商"。但一个约定的服务名**本身就是提供方的**——把它写进 dsh-memex 的源码与 spec，就等于让 dsh-memex 永久携带一个它无法单独定义的概念。判据是**消费方是否通用**：dsh-memex 是通用的记忆插件，它不该认识任何提供方，哪怕只认一个字符串。

**本仓先例**（已落地，非提议）：change `open-worktree-in-remote-editor` 对完全同构的问题给出同一答案——`worktree-session` 暴露 `worktreeSession.openHandler` 注册点，`packages/cockpit-worktree-open-shim` 读 `cockpitBridge.editorOpen` 并注册进去，两端互不知晓。更早的 `packages/subscriptions-sandbox-shim` 是同一惯例。本 change 沿用，不发明第二种。

**dsh-memex 侧**：提供一个自己命名的注册点（命名权归 dsh-memex），用于替换「取得卡片浏览地址」的实现。未注册时使用默认实现 `localhost:<实际端口>`——Host 与浏览器同机时这本就正确。注册点 MUST NOT 出现在 `inject` 中（loader 对不可解析依赖是**静默不加载**，把可选协作方写进 inject 会让功能无声消失）。

**注册点在 client 半区**（与 D3 的 launcher 同侧）。这不是风格选择：提供方能力（bridge）只存在于浏览器，先例 shim 的 host 半区是 inert 的，因此注册点必须在浏览器侧才可能被接上。

**注册契约是异步的**，与先例不同且必须如此：已实现的提供方能力是 `register(channelId, devicePort): Promise` + `publish(channelId): Promise<{url}>`（两次跨源 `fetch`），而 `cockpitBridge.editorOpen` 是同步的（只拼 URI）。所以本注册点的契约形如「给定库标识与实际端口，异步解析出可访问地址」。**异步正是 D3 的 launcher 成为必需而非优化的原因**——按钮不可能在点击链路里 await 它。

**shim 侧**：只探测两端、转接、注册，不做校验、不拼地址、不持状态、不重试。耦合点承载的逻辑越多解耦成本越高；这条写进 spec 而非仅 design，约束的是未来改动。

**必须遵守的实测教训**（`cockpit-worktree-open-shim/src/client/index.ts` 的注释记录）：读跨插件服务必须用**完整 dotted name 的单次 `ctx.get('a.b')`**，禁止 `ctx.get('a').b`——Cordis 会把点属性重新路由回 context proxy 并强制 inject，使这个本应可降级的接缝抛出 uncaught rejection。

**代价**：多一个 package 与多一跳间接。接受——换来 dsh-memex 的 capability 完全不提 cockpit，规范层面的干净比省一个 package 更有价值。

### D5. 服务按库隔离，生命周期绑插件

一进程一库是内核决定的（`MEMEX_HOME`），正好满足隔离要求：一个服务实例只能读它自己那个库。

回收策略：**按需启动 + 随插件停止终止**。不做空闲自动回收——那是优化，且需要定义"空闲"（浏览器标签页还开着但没请求算不算？）。保守起见先不做，留待实际使用反馈。

### D6. `memory: false` 的拒绝发生在启动之前

与既有工具的处理对齐（归档 design D20：拒绝发生在 `ensure()` 之前，否则关闭的工作区第一次调用就把库目录建出来）。这里同理：若先启动服务再判定，一个关闭了记忆的库会因为一次浏览请求而被拉起进程。

按钮不呈现是第一道，launcher 拒绝是第二道——**两道都要有**，因为按钮可见性是渲染时快照，而地址可被直接访问。

## Risks / Trade-offs

- **[同机无认证暴露]** → 浏览服务只听回环但无认证，本机任意进程可读该库全部卡片全文。所有者已明确接受。约束：服务按需启动而非常驻，缩小窗口。
- **[跨机器时暴露面延伸到宿主机回环]** → 端口发布后，宿主机本机任意进程亦可读。这在 dsh-cockpit 侧的 spec 中以「只在回环监听 + 登记制」约束，本仓不重复定义。
- **[上游 CDN 外链]** → `serve-ui.html` 从公网 CDN 加载 `marked`。跑在**独立 origin** 上时它无法触及 DSH 的已认证 API（这正是 D1 相对子路径挂载的一个额外安全收益），但离线/内网环境下 Markdown 渲染会降级。记录为已知限制，不因此改写上游资源。
- **[stdout 解析随版本失效]** → 内核升级后监听行格式若变，表现为"启动失败"而非错误地址（fail closed）。在 `dsh.yaml` note 中登记复核点。
- **[进程泄漏]** → 插件异常退出时可能遗留子进程。回收用 SIGTERM 且注册在插件 dispose 上；不按端口/命令行相似性猜测归属去杀进程（与 cockpit 同一保守原则）。
- **[跨仓契约漂移]** → 服务名与结构是字符串契约，无编译期保护（pitfalls 第 7 条是同类翻车样本：`tokenStatus` 猜成 `ready` 实际是 `valid`，替身照抄错误假设导致测试长期全绿而真机必挂）。缓解：契约写进两端 spec、测试替身照抄真实实现、**形状不匹配按"缺席"处理**（显式降级而非猜测）；且漂移只影响 shim 一个 package，两端各自仍可用。

## Migration Plan

1. 先落本机直连路径（D1/D2/D3/D5/D6），此时跨机器场景呈现为「不可用 + 原因」。这一步**独立可用且可验收**，不依赖 dsh-cockpit，也不需要 shim。
2. dsh-cockpit 的 `device-port-forward-seam` 落地并发布后，新增 shim package 把两端接起来（D4），跨机器路径自然变活。shim 可独立移除，移除即解耦。
3. 回滚：`dsh.yaml` 中 dsh-memex 的 `enabled: false` + `node scripts/sync.mjs`；或仅移除设置页动作与相关路由，库与卡片不受影响（本 change 不写库内文件）。

## Open Questions

- 是否需要空闲自动回收浏览服务（见 D5，当前决定不做，属后续优化，不影响 spec 与任务拆分）。

已关闭的问题：

- ~~launcher 是 302 还是前端跳转~~ → **只能前端跳转**（D3）。取地址要调用浏览器侧的注册方，Host 无法代劳，因此不存在 302 方案。
