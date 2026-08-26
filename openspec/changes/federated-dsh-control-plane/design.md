## Context

见 `proposal.md` 的动机和范围。当前运行体为 `@deepseek-ai/dsh@0.1.1-rc.2`。官方 Web Client 以单一 Connection、SessionRuntime 和 WorkspaceRuntime 消费一个 Host；`WorkspaceBrowser` 整块占用 `sidebar.workspaces`，只留下目录选择等子 slot。Host API 已提供 workspace/session CRUD、history/search、模型选择、双事件流和应用内目录浏览，足以作为单节点协议，但没有 Node 身份、全局 ID、联邦版本协商或多 Host 聚合。

社区 `Asaiuta/dsh-session-hub` 已证明 exact-route 网关、远端 HTTP + mux/host 双流、官方 Runtime 注入和 SSH 转发可以实现远端会话原生渲染；本 change 只把它作为 MIT 参考和行为样本。其发布物仍以裸 native session id 去重/路由、把每台服务器压成一个虚拟 workspace、默认可同步模型凭据、内置 `ssh2` 不符合本仓库 OpenSSH 信任模型，因此不作为依赖或 fork 基线。

本仓库现有 `worktree-session`、`sidebar-session-provider-icon`、`dsh-open-in-vscode`、`ui-archive-manager` 和其他 UI 插件使“替换侧栏但不退化本机能力”成为硬约束。跨机访问仍遵循 `docs/notes/lan-access-ssh-tunnel.md`：远端 DSH 保持回环绑定，明文 LAN 形态不进入设计。

## Goals / Non-Goals

**Goals:**

- 在一个中央 DSH GUI 中同时控制 This Mac 与多个普通远端 DSH Host。
- 把 DSH 版本耦合限制在中央/远端 Adapter，保持联邦身份、路由、对账和节点生命周期为稳定领域层。
- 完整提供 `Node → Workspace → Session`，保留官方 rc.2 WorkspaceBrowser 的核心行为和本机扩展。
- 让节点断线、协议不兼容、route 冲突和 registry 损坏都可诊断且 fail closed，同时本机官方 DSH 始终有逃生门。
- 用系统 OpenSSH 复用用户既有 alias、host-key、Agent 和 ProxyJump 信任链。

**Non-Goals:**

- V1 不建设动态多版本 Adapter 插件系统；只有一个 rc.2 Adapter 实现和一个稳定端口接口。
- 不在远端安装 federation plugin，不管理远端 DSH 进程和 provider 设置/凭据。
- 不同步文件、不共享磁盘、不映射路径、不迁移 session、不改写 cwd。
- 不提供中央 Agent 自动派单、team、跨节点 subagent、多会话并排或分布式锁。
- 不复制 `dsh-session-hub` 代码或依赖另一套 Agent/workspace 控制平台。

## Decisions

### 1. 一个双面 package，内部保持可测试的分层

新增 `packages/dsh-federation/`，同时导出 Host 与 Web Client 半区。V1 物理上只发布一个 package，避免内部 package 版本、peer 和 Loader 装配复杂度；代码和测试按下列依赖方向分层：

```text
Central DSH Web Client
        ↕ rc.2 client wire
Central DSH Adapter
        ↕ stable commands/events
Federation Stable Core
        ↕ DshNodePort
DshRc2NodeAdapter
        ↕ HTTP/WS carrier
OpenSSH local forward
        ↕
ordinary remote dsh web
```

建议目录：

```text
src/
├── core/                 # identity, registry model, projections, router, reconciliation, capabilities
├── host/
│   ├── central-adapter/rc2/
│   ├── remote-adapter/rc2/
│   ├── carrier/
│   ├── tunnel/
│   ├── registry-storage/
│   └── activation/
├── client/
│   ├── federation-bridge/
│   ├── node-shell/
│   ├── workspace-embed/      # rc.2 official Workspace subtree adapter
│   ├── workspace-picker/
│   ├── directory-browser/
│   └── compatibility/
└── contract/             # Host↔Client federation control contract
```

Core 不导入 Cordis、React、Node fs、HTTP/WS、OpenSSH 或 DSH wire 类型。CI 增加边界测试/静态检查，防止 rc.x schema 渗入 Core。

**Alternatives:** 每层单独 package 能形成更硬依赖边界，但 V1 装配和升级负担过大；把所有逻辑直接写进网关则会重现社区方案的版本耦合。

### 2. 中央和远端使用双向防腐层；V1 仅实现一个远端 Adapter

`CentralRc2Adapter` 负责中央 rc.2 exact routes、列表投影、错误形状、mux/host 帧和 ClientRuntime 桥接。`DshRc2NodeAdapter` 实现稳定 `DshNodePort`，集中翻译远端 rc.2 RPC、schema 与事件。

V1 不实现 adapter registry、动态 bundle 或 rc.3 适配；`DshNodePort` 先稳定，真实协议变化出现后再新增实现。中央 Adapter 由当前 build pin 唯一确定；远端先做版本/能力探测，只有验证矩阵中的组合获得完整写能力。

Remote Adapter 应复用 DSH 导出的 API/schema/AbstractApiClient 边界；中央接管应代理“有效 composed Connection `/api` handler”，而不是绕过 Typert/interceptor 直接调用裸 `ctx.apiProxy`，以保留官方 interceptor-before-fallback 语义。

M0 已证明 rc.2 的公开装配无法完成该要求：`TypertGatewayService` 已占唯一 `/api` interceptor，第二个 interceptor 会冲突；WebServer exact route虽先于官方 `/api` prefix，但未知未来 endpoint 仍落入 prefix；第二个 prefix 同样冲突；`createSharedFetchHandler()` 仅在 Connection `apply()` 闭包内创建且没有替换/外层 middleware accessor。经用户评审批准，中央构建增加第二个固定源码兼容 patch：在 `HostConnectionService` 上导出唯一、作用域化、可 dispose 的 `/api` outer middleware registry。Connection 创建的物理 `/api` route 仍先执行原 Host/Origin trust fence，再由 outer middleware 检查/路由/拒绝 federation 请求；其 `next` 是已经组合好的 `Typert interceptor → privileged fence → ApiProxy fallback` handler。native 请求调用 `next`，不得复制 Typert、调用裸 ApiProxy 或把 middleware 放到 trust fence 外。middleware ownership 冲突必须 fail closed，源码/blob/patch/output hash、离线缓存和 last-known-good 规则与 Workspace Embed 相同。

**Alternatives:** 只注册已知 exact routes 无法阻止 profile/plugin 或未来新增的未知 identity route 把 `fed1:` 送入本机 fallback，故不接受；只做一层远端 Adapter 会让中央 exact-route 和 Runtime 细节污染 Core；现在就设计多版本插件系统则没有真实差异驱动。

### 3. 语义联合 Host，而不是多 Client Runtime 或 iframe

中央 Host 合并本机与远端 baseline、改写全局 ID，并把远端事件转换为中央 rc.2 Runtime 已理解的帧。浏览器保持一个官方 SessionRuntime/WorkspaceRuntime，避免 `ConnectionHandle.start()` 单消费者和 root-global current-session 语义冲突。

**Alternatives:**

- 单 Runtime transport 切换实现较轻，但无法同时展开多 Node。
- 每 Node 一个 ClientRuntime 需要证明 Cordis scope、全局 UI services 和 current session 可并存，V1 风险更高。
- iframe 复用完整远端 GUI，但产生双 App、双侧栏、路由/CSP/焦点和版本体验分裂。
- ACP 只适合子 Agent/编辑器交互，不暴露完整 Host workspace/session API 与 host event stream。

### 4. 版本化可逆联合 ID，不维护对象映射表

编码格式逻辑上为：

```text
fed1:<node-id>:w:<base64url(native-workspace-id)>
fed1:<node-id>:s:<base64url(native-session-id)>
```

实现可选择等价的无歧义编码，但必须携带版本和对象种类。node id 是 registry 持久生成的 UUID/opaque id；This Mac 也分配保留的稳定 local node id。所有 Host 下行对象和事件在 Adapter 边界编码，所有上行命令在路由前严格解码。

不另建 workspace/session UUID 映射表，因此重启恢复不依赖第二份事务状态；节点显示名、alias、路径均可变化而不影响身份。编码器需要长度上限、字符集校验和碰撞/property tests。

**Alternatives:** 中央随机 ID + 映射表可隐藏 native id，但带来事务、迁移和映射损坏；裸 native id 已被社区实现证明存在去重/错路由风险。

### 5. Node registry 是运行态私有真相源

GUI CRUD 的节点写入 `$DSH_HOME/plugins/dsh-federation/nodes.json`：

```json
{
  "version": 1,
  "localNodeId": "...",
  "nodes": [{
    "nodeId": "...",
    "displayName": "Lume VM",
    "sshAlias": "lumevm",
    "remoteDshPort": 3080,
    "enabled": true,
    "order": 0
  }]
}
```

以 owner-only 目录、regular-file/no-follow 检查、进程内串行/CAS generation、0600 temp、file fsync、rename 和 parent-dir fsync 提交；启动时清理可证明属于本插件的陈旧 temp，未知版本、symlink 或损坏时不写回。`dsh.yaml` 只启用 package 和全局策略，不将机器清单或秘密带入 Git。

Add Node 明确分两阶段：Save validation 只验证 alias 可经非交互 SSH 身份连接，成功后即可保存；readiness probe 在保存后建立 tunnel/DSH protocol，允许进入 DSH_UNAVAILABLE、INCOMPATIBLE 或 READY。错误端口、无关 HTTP 服务和超时都不会撤销已保存节点。duplicate alias+port 默认允许（可用于同机多个逻辑节点）但显示警告；node id 仍不同。修改 alias 需重新通过 Save validation，取消或超时不提交变更。

### 6. 系统 OpenSSH 是唯一 V1 节点传输入口

Tunnel Manager 以 `sshAlias` 启动受跟踪的系统 `ssh` 子进程，至少设置 BatchMode、ExitOnForwardFailure、回环 LocalForward、连接超时与 keepalive。OpenSSH 自行解析 `~/.ssh/config`、known_hosts、Agent 和 ProxyJump；插件不解析/复制私钥，不保存 passphrase，不关闭 host-key 校验。

Tunnel Manager 以参数数组启动 OpenSSH，并在 alias 前使用 `--`/等价 option boundary，配合严格 alias grammar 与 `ssh -G` 配置展开验证，拒绝含空白、控制字符、shell 元字符或会被解释成命令选项的 alias；stderr 采用有界 ring buffer 并脱敏。stock OpenSSH 没有可移植的接口接管 Node 已绑定的 listener FD，因此这里的安全目标不是字面上的无缝 socket handoff，而是禁止 false-ready：Node 在 `127.0.0.1:0` 获取并记录候选端口，关闭临时 reservation 后立即以该候选启动受跟踪 SSH；`ExitOnForwardFailure=yes` 检测丢失的本地 bind 竞争，失败时重新获取候选并有界重试。只有自有 SSH 子进程/认证连接已就绪且经 tunnel 的 DSH 协议/version probe 成功后，才向 Carrier 发布 `http://127.0.0.1:<port>`。远端目标端口关闭、后续 `direct-tcpip` channel 拒绝或非 DSH 协议不会必然使 SSH 因 `ExitOnForwardFailure` 退出，必须由 readiness probe 分类并阻止发布。每个子进程、socket 和 retry timer 都有幂等 disposer；正常 unload、disable/delete、重试替换和可捕获 `SIGINT`/`SIGTERM` 清理自有资源。`SIGKILL`、内核崩溃或断电不能依赖同步 disposer，中央重启只管理自身记录/父子关系仍可证明的进程，不按端口或命令行相似性盲杀其他用户 ssh。

V1 不用 `command -v dsh` 声称 `DSH_NOT_INSTALLED`：非交互 PATH 与真实服务环境可能不同。SSH 成功但目标端口无有效 DSH 协议统一诊断为 `DSH_UNAVAILABLE`，再细分端口拒绝、非 DSH 服务或协议不兼容；修复文案提示用户在远端终端自行确认安装/启动。联邦不执行任何远端探测命令、安装或启停，也不暴露通用 SSH exec。

**Alternatives:** Node `ssh2` 能内嵌隧道，但需要自行正确实现 host verifier、ssh config/ProxyJump 和凭据生命周期；人工预建隧道不能满足 GUI 节点生命周期。

### 7. 每节点独立连接 generation 和权威对账

每个节点组合：Tunnel generation、Carrier generation、Remote Adapter、workspace/session baseline、rc.2 可证明的 per-session seq/projection watermark、backoff 和 write-delivery ledger。rc.2 的 session events/projections 提供 seq 与 history projection `asOfSeq`，可按 higher-seq-wins 对账；Host workspace/order/status frames没有统一跨流 seq，因此不得宣称全局水位线或原子快照。

首次连接顺序：

1. SSH/tunnel 成功；
2. 只读 host/version/capability probe；
3. 拉 workspace.list 与 session.list；
4. 建立 mux 与 host 双事件流；
5. 建立 generation/watermark；
6. 原子发布 NodeSnapshot；
7. 达到核心门槛才进入可写 READY。

断线保留 stale 树骨架、冻结该节点写操作，不取消或判失败。重连顺序先建立并缓冲新 generation 事件流，再拉 workspace/session baseline 和当前会话 history/projections，随后按领域规则重放缓冲帧：session event/projection 以 seq/asOfSeq 判定；workspace changed/order/archive 使用完整快照覆盖和实体 tombstone；status 等无 seq 瞬时帧只在 generation 内消费，并通过周期/触发式权威 refresh 修复窗口。旧 generation 一律丢弃。M0 fixtures 必须验证 list 与 subscribe 之间事件、跨双流乱序、重复、删除和 refresh race。

写操作 ledger 至少包含 NOT_SENT、SENT_AWAITING_RESPONSE、ACCEPTED、REJECTED、OUTCOME_UNKNOWN。rc.2 的每个 client request 有 rpcId，且 prompt 会把 rpcId 持久写入 `user/message` source，可精确收敛 prompt；但 rpcId 不是 Host 通用幂等键，联邦仍禁止自动重发。rename 等返回 seq/值的操作可按专门证据收敛；cancel、model selection 或其他没有持久可比证据的操作在响应前断线后可无限期保持 OUTCOME_UNKNOWN。绝不以消息内容匹配，重复 prompt 和多客户端并发不能造成错误归因。

### 8. 进程级 Host 激活与每客户端 UI 激活分离

Host 联邦层是进程级状态机：

```text
HOST_DISABLED
  → HOST_PREPARING
  → HOST_READY
  ↘ HOST_CONFLICT / HOST_FAILED
```

联邦所需 exact routes 先在一个 activation scope 中逐一注册，只有 Core、registry、local node adapter、route inventory 和 route handlers 全部就绪才提交 `HOST_READY`；任一冲突时反向释放本次已注册 routes。Host routes 在 READY 后必须同时安全接受两种调用：`fed1:` ID 严格解码并路由，官方 Client 的裸 native ID 明确视为 This Mac；未知或错误类型的 `fed1:` ID 在 fallback handler 前拒绝。这样某个旧/失败浏览器仍可使用官方本机 UI，不需要为了一个 tab 撤销整个进程的联邦路由。

每个浏览器实例独立进入：

```text
CLIENT_OFFICIAL
  → CLIENT_PREPARING
  → CLIENT_FEDERATED
  ↘ CLIENT_FALLBACK
```

Client 只有 federation contract、Node Shell、Workspace Embed 和 Picker 都可渲染时才让联邦 slot entry 成为 winner；加载失败、entry boundary abdication 或超时只处置该浏览器实例的联邦贡献，官方 entry 重新成为 winner。一个 tab 的失败不得影响其他已进入 `CLIENT_FEDERATED` 的 tab，也不得关闭 Host routes。M0 必须证明 slot disposer/abdication、刷新、晚到 tab 和多 tab 并存语义。

构建失败与运行时失败也分开：Workspace Embed 的 source/hash/patch/build 不兼容时不产生新的 federation artifact，sync 在卸载最后可用部署前停止，官方或上一个已安装版本保持不变；只有已成功构建并加载的 artifact 才进入上述 Host/Client 运行时状态机。

错误分为 Registry、SshIdentity、Tunnel、Transport、Protocol、Compatibility、Capability、Routing、RemoteBusiness、OutcomeUnknown、ActivationConflict；日志和 UI 诊断做 secret/path-content 最小化。

**Alternatives:** 按单个 Client readiness 全局撤销 Host 会破坏多 tab；冲突时部分让路会产生可见列表和错路由；阻止整个 DSH 启动则让可选控制面破坏本机开发。

### 9. 自研 Node 外壳，Workspace/Session 子树复用官方实现

Client package 替换：

- `sidebar.workspaces`
- `conversation.hero.workspace`

原因是 Node 层和远端目录选择必须在侧栏与空白/New Session 两条入口一致。Conversation、composer、model selector、tool cards、approval/question 与 SessionRuntime 不替换。

rc.2 的 `WorkspaceBrowser` 已将 `useSessions`、`useWorkspaces`、Host actions、hostDescription 与 directoryFlow 作为 props 注入。精确 release commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的源码确认真实内部边界为 `SessionTree`、`FlatList`、`SearchResults`、Rows、tree derivation 和 view store，而不是现成的 `WorkspaceSection`。发布 package 只导出 `apply/inject` 和 props 类型，运行时组件被 bundle 闭包隐藏。`SlotRegistry.entries()` 的 render-erased 观察面虽在运行时保留无类型的 `StoredEntry.component`，却擦除了 owner/inject/store/locale/child-slot 的组合关系，也不提供把该 entry 以新 owner 重新装配或嵌套渲染的公开 renderer API；仅捕获 component 不是受支持的 Embed seam。

因此 V1 新增版本固定的 `DshRc2WorkspaceEmbedAdapter`，其构建契约为：

1. 唯一上游源码为 `deepseek-ai/deepseek-harness` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，路径 `packages/client/ui-workspace/src/client/**`；repo tree 中 `WorkspaceBrowser.tsx` blob 为 `08f22ed400ac3a80852df186e5a899bc8ba53c33`，其他依赖文件的 blob 清单一并提交为 provenance；
2. 仓库提交最小 patch、上游 MIT license/NOTICE 引用和 per-file blob/hash manifest，不提交生成 bundle；首次无缓存构建从固定 commit archive 获取，随后可使用内容寻址缓存离线重建，缓存 miss 且无网络时给出明确 bootstrap 错误；
3. patch 从实际 `SessionTree`/`FlatList`/Rows/store 边界提取一个 deterministic `Rc2WorkspaceNodeSection` API，不包含 root slot registration、全局标题、全局搜索、rail shell 或 directory-flow slot；
4. 每个 Node 有稳定 React key、独立 view-store namespace、dialog/portal owner、drag state、expanded/show-more state、host home 和 directory-flow controller；`current` 由联合 Runtime 的全局 current id 传入 node-filtered store，因此同一时刻只有所属 Node section 选中；
5. 生成物只作为 federation package 构建输入，不修改 npx cache、`~/.dsh` 或已安装上游 package；用两个合成 Node 实例证明 expansion/order/dialog/portal/drag/directory flow 不串扰。

目标 blob/hash、生成 API 或差分测试失败属于构建期不兼容：不产生/安装新 artifact，并保留官方或上一个已部署版本；它不是运行时 activation rollback。不能静默切换为自行复制的一套 UI。未来上游正式提供 Embed seam 后，Adapter 改为直接依赖公开 export 并删除本地 patch。

行为所有权：

| 行为 | Owner |
| --- | --- |
| Node 行、状态、折叠、排序、运行/待回答聚合 | Federated Node Shell |
| 全局 grouped/flat/manual/updated 控制、搜索输入、防抖/部分失败、rail/scroll/focus 编排 | Federated Node Shell |
| Workspace/Session tree 与 rows、默认五条/show-more、blank、rename/fork/archive dialogs、hover/copy、状态/subagent、同 Node drag | 官方源码派生的 `Rc2WorkspaceNodeSection` |
| Node-aware Hero Picker、目录 flow 和 workspace create | Federated Picker + node-scoped official picker primitives |
| ID、数据、命令和事件归属 | Central Adapter + Stable Core |

Flat 视图仍保留 Node 层；全局搜索结果可扁平，但必须显示 Node/Workspace 上下文。Node shell 与官方 section 的组合以完整 rc.2 WorkspaceBrowser 黑盒矩阵验收，包括焦点顺序、dialogs/portals、响应式、键盘/ARIA 和 reduced-motion。

**Alternatives:** 直接实例化完整 `WorkspaceBrowser` 会为每个 Node 重复标题、搜索、view controls、滚动区和 dialogs；从 SlotRegistry 读取 `StoredEntry.component` 后自行包裹仍缺少公开的 typed renderer/store/inject/locale/child-slot 装配契约，依赖私有 renderer 等同于复制不稳定框架内部；自行重写所有 rows/tree 会扩大长期差分面。

### 10. 拖拽只有重排语义，不能暗含迁移

- Node：中央 registry 内排序。
- Workspace：同 Node 内调用该 Host `workspace.insertBefore`。
- Session：同 Node、同 Workspace 内调用 `workspace.insertSessionBefore`。
- Ungrouped/Flat：只维护浏览器本地顺序。

跨 Node Workspace、跨 Workspace Session、跨 Node Session 都不显示 drop marker、不发送 RPC。该规则避免把 reorder 误实现为 cwd 改写、复制或分布式迁移。

### 11. 远端 Workspace Picker 使用节点绑定 Browse 能力

联邦 sidebar/picker 先选 Node，再创建一个 node-scoped directory flow。远端始终使用应用内 browse，listDirectory/createDirectory/workspace.create 都经联合归属路由；This Mac 依据本机 capability 使用 native 或 browse。目录选择期间断线保持可重试 modal，不回退到本机文件系统。

V1 继承 DSH browse backend “Host 用户可访问目录均可浏览”的安全边界；个人可信节点可接受。未来共享节点的 allowedRoots 需要远端 Host-only 插件，另立 change。

### 12. 本机扩展必须等价，远端扩展按 capability

联邦 UI 声明/渲染可组合 Workspace row-menu seam。This Mac 的 `dsh-open-in-vscode` 保持工作，远端默认不显示本机 editor-open。`ui-archive-manager` 继续管理本机；远端只有探测到对应协议才显示 unarchive。`worktree-session` 依所属 Host 能力运行，不假定各节点安装一致。

`sidebar-session-provider-icon` 增加联邦正式渲染路径：联邦 Session Row 直接消费 selector 当前值/投影 fallback；DOM MutationObserver 仅在官方单机侧栏活动时启用。这样避免重复 badge，也保留联邦激活失败后的原生回退。

### 13. 兼容策略是矩阵 + 能力探测，不是精确版本或乐观 SemVer

V1 编译一个 rc.2 Adapter，但记录中央 commit/version、远端版本和核心 capability probe。状态：

- SUPPORTED：已验证矩阵 + probe 通过，开放承诺能力；
- EXPERIMENTAL：允许范围内但未验证，显示警告，只开放已专项证明的能力；
- INCOMPATIBLE：核心 schema/RPC/event stream 失败，禁止写。

Fixture 记录只保存脱敏协议形状和合成内容，不提交真实路径、会话历史、截图或凭据。

## Risks / Trade-offs

- [Central exact-route 接管紧耦合 DSH rc.2] → 集中在 Central Adapter、建立 route/schema fixtures、矩阵测试和事务回滚；升级只改 Adapter/fixtures。
- [官方 Workspace Embed seam 未发布且构建 patch 会随 rc.2 源码变化失配] → 固定 release commit 与目标 hash，patch 只做提取/export，构建时 fail closed；以官方 README/contracts 建立逐项黑盒矩阵，This Mac 与原生模式差分验收并优先向上游贡献 seam。
- [Host 与多 Client 无法做单一全局两阶段提交] → 拆成进程级 Host transaction 和 per-client slot commit；Host routes 同时安全处理本机裸 ID 与联合 ID，单个 tab 只回退自己的 UI。M0 验证多 tab、晚到/崩溃 Client 和 disposer。
- [事件 baseline 与双流竞态导致重复或回滚] → session 领域只用可证明 seq/asOfSeq，Host 无序帧用 generation 预缓冲、完整快照/tombstone 和权威 refresh，并做属性/故障注入测试。
- [写请求断线后无法唯一证明是否执行] → 显式 OUTCOME_UNKNOWN、禁止自动重放；只用权威历史可证明时收敛。
- [系统 OpenSSH 子进程泄漏或错误解析] → 每节点 ownership/disposer、bounded stderr、退出/禁用/删除测试、不得 shell 拼接 alias。
- [联邦 UI 与第三方插件 slot/DOM 适配冲突] → 正式声明 row-menu/provider rendering seam，激活时关闭旧 DOM 注入，逐插件兼容验收。
- [远端 Browse 可见 Host 用户全部目录] → V1 限定个人可信节点并如实提示；共享 devbox 的 allowedRoots 延后为节点插件能力。
- [This Mac 也使用联合 ID 可能影响现有 localStorage/深链] → 提供一次性客户端视图迁移或安全清理；原生持久 session id 不改，禁用联邦即可恢复官方模式。
- [维护成本仍高于采用社区插件] → 只自研稳定需求边界；持续跟踪 `dsh-session-hub` 和上游 DSH 的行为修复，但不耦合其发布节奏。

## Migration Plan

1. M0 在 package 尚未启用的条件下，首先完成 rc.2 Workspace Embed seam 的构建期提取/export、多个 node-scoped section 实例与原生行为差分 spike；随后完成协议 fixtures、route 事务、SSH、事件桥和三节点碰撞 spike。Embed seam 无法以最小 patch 证明时暂停并重新评审，不默认转向全量重写；其他核心假设失败同样先修 design/spec。
2. M1 实现 headless Core/registry/tunnel/carrier/rc.2 Adapter，默认 `enabled: false` 或不接管 UI/routes，仅跑测试和诊断。
3. M2 加入 Central Adapter 与完整 Client UI；通过 activation feature flag 在隔离 DSH_HOME 验证，未 ready 时始终官方单机模式。
4. M3 完成 This Mac + 两远端 E2E、断线/冲突/兼容/插件回归和安全审查后，在 `dsh.yaml` 启用 local customization，运行 `dsh build` 两次验证幂等并重启验收。
5. 回滚：在 `dsh.yaml` 禁用/移除联邦条目后 `dsh build` 并重启；官方 routes/UI 恢复，远端无改动。`nodes.json` 保留但不读取，用户确认后才另行删除。

## Open Questions

- rc.2 中必须 exact-route 接管的最终最小集合、Typert/attachment/export 等边缘方法，将由 M0 产出已提交的调用图和 inventory；此 gate 完成前不得实现 route transaction。任何接受 workspace/session id 的 route 都必须路由或显式拒绝 `fed1:`，不得落入本机 fallback。
- 每客户端 readiness/diagnostic contract 的具体承载使用 Typert Remote 还是专用 loopback route，由 M0 选择；两者都必须满足相同 Origin/Host 围栏，且不把单个 Client 失败升级为进程级 Host rollback。
- This Mac 旧版 WorkspaceBrowser localStorage 的联合 ID 迁移是一次性转换还是清理后重建，只影响本地视图偏好，不影响 workspace/session 数据；M2 根据 store schema 可解析性决定。
