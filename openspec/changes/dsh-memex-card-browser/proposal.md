## Why

「记忆」设置页今天只能看到对应关系与卡片计数，**看不到卡片本身**。内核自带 `memex serve` 的浏览 UI，但它此前被判定为另一类风险面而推迟（归档 change `dsh-memex-settings-ui` 的 D19 与 `BACKLOG.md` 的 B045）。

所有者的预期是：**每个记忆入口都可以选择「打开」，在宿主机浏览器里看到该库的卡片内容**，且这条路径在「DSH 跑在 VM/devbox、浏览器在宿主机」时同样成立。

关键约束来自所有者的明确取舍：**不自己开发浏览 UI，也不接受为复用而持续付费**。这排除了「自研面板」与「把上游 HTML 改写后挂到 DSH 子路径」两条路——后者看似省事，但上游 HTML 的路径是绝对的且没有 `<base>`，任何子路径挂载都要重写上游资源，于是上游每次改版我们都得跟。实测中这种跟随成本已经出现：对着 61KB 的 `serve-ui.html` 清点端点时曾漏掉 `/share-card.js` 这一条。

唯一真正零跟随的形态是**让上游服务跑在它自己 origin 的根上**：不改上游一个字，上游加功能我们自动就有。代价是一个端口和一个进程，而这份代价是一次性的。

## What Changes

- **新增「打开」入口**：设置页每个记忆入口在展开后提供「打开」动作，在新标签页中呈现该库的卡片浏览界面。
- **按需拉起内核浏览服务**：Host 侧按需启动 `memex serve`，**以库为单位**（一个库一个进程一个端口，这正是内核 `MEMEX_HOME` 的粒度），并管理其生命周期。
- **必须处理的四条内核约束**（均已实测，见 design）：配置了远端的库不传 `--local` 会**重定向到托管站点且本地服务根本不启动**；默认会在 **Host 那台机器**弹浏览器，必须抑制；实际端口会因占用而漂移，只能从 stdout 解析；长驻子进程的 stdin 不能用 `ignore`。
- **跨机器访问走三段式，不直连**：dsh-memex 暴露一个**自己命名**的注册点，用于替换「取得卡片浏览地址」的实现；一个**专用 shim package** 读取驾驶舱侧 bridge 的端口发布能力（见 dsh-cockpit 的 `device-port-forward-seam`）并注册进去。dsh-memex MUST NOT 引用 cockpit / bridge 的 package 名、服务名或产品名——连约定服务名也不行，那个名字本身就属于提供方。未注册时回落为本机地址，本机直连场景零影响、也不需要 shim。沿用本仓既有范式（`cockpit-worktree-open-shim`、`subscriptions-sandbox-shim`），不发明第二种。
- **同源 launcher 承担就绪与失败呈现**：「打开」按钮同步打开一个 DSH 同源路径（避免异步等待导致的弹窗拦截），由该页面完成「确保服务与转发就绪」并跳转，失败时就地说明原因，MUST NOT 给出一个会指向宿主机其它服务的地址。
- **关闭记忆的工作区不可浏览**：`memory: false` 的入口不提供「打开」，且直接请求其浏览地址也被拒绝。
- **不做**：不自研卡片浏览 UI、不改写上游 HTML、不实现上游 API 的等价物、不改卡片格式、不改多库检索与守门语义。

## Capabilities

### New Capabilities
- `dsh-memex-card-browser`: 卡片浏览服务的按需启动与回收、以库为单位的隔离、浏览地址注册点与未注册时的默认实现、关闭记忆时的拒绝、以及失败时不给出误导地址的呈现约束。**该 capability 完全不提 dsh-cockpit** —— 它描述的是一个通用的地址解析扩展点。
- `cockpit-memex-browse-shim`: 专用耦合 package。定义它如何探测两端、两端缺失时的行为，以及它作为唯一耦合点的边界（不得承载业务逻辑、不得成为两端的依赖、可独立移除）。

### Modified Capabilities
- `dsh-memex-settings-ui`: 入口展开态新增「打开」动作；该动作在 `memory: false`、内核缺失或浏览服务不可用时的可见性与降级行为。

## Impact

- `packages/dsh-memex/src/host/`：新增浏览服务的进程管理与 launcher 路由；现有 `/dsh-memex` 通道新增相关端点。
- `packages/dsh-memex/src/run/kernel.ts`：现有 runner 是「跑完即死 + 有界 timeout + 到点 SIGTERM」，长驻服务需要另一条路径，不复用它。
- `packages/dsh-memex/src/client/page.tsx`、`locales.ts`：入口展开态的「打开」动作与降级文案。
- `dsh.yaml`：dsh-memex 的 note 需记录新增的运行依赖（按需拉起内核 serve）与内核版本复核点。
- **新增 package** `packages/cockpit-memex-browse-shim/`：本仓唯一知道「dsh-memex 与 dsh-cockpit 同时存在」的地方；移除它即解除耦合，两端均无需改动。形态与依赖声明对齐既有的 `cockpit-worktree-open-shim`，并在 `dsh.yaml` 中登记。
- **跨仓依赖**：端口发布能力由 dsh-cockpit 的 `device-port-forward-seam` 提供。该能力未落地前，本 change 的本机直连路径完整可用（不需要 shim），跨机器路径呈现为「不可用 + 原因」。
- 上游 `@touchskyer/memex` 的 pin 版本：`serve` 行为随版本变化时需复核（与既有 `sync --status` 解析同性质）。
