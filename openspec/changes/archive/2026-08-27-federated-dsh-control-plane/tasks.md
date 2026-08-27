## 1. M0 — 先证明不可替代的架构接缝

- [x] 1.1 记录中央 rc.2 composed Connection 实际调用的 session/workspace/respond route 清单、请求响应 schema、mux/host 帧与 interceptor 顺序，生成仅含合成数据的脱敏 fixtures。
- [x] 1.2 以固定上游 commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 和已验证 `WorkspaceBrowser.tsx` blob `08f22ed400ac3a80852df186e5a899bc8ba53c33` 建立完整源码依赖 blob manifest、MIT license/NOTICE 记录和确定性输入清单。
- [x] 1.3 实现固定 Git archive + 内容寻址缓存的可复现源码获取方式，证明首次 bootstrap、缓存后离线重复构建、不修改 npx cache/`~/.dsh`、不提交生成上游 bundle四项约束。
- [x] 1.4 从真实 `SessionTree`/`FlatList`/Rows/store 边界制作只做组件提取和 runtime export 的 `Rc2WorkspaceNodeSection` patch；目标 hash 不匹配时拒绝产生新 artifact。
- [x] 1.5 明确定义 NodeSection 的完整注入面，使用稳定 node key、per-node store/dialog/portal/drag/directory-flow namespace 和 node-filtered current-session store。
- [x] 1.6 用两个合成 node-scoped session/workspace store 和 action spy 渲染两个官方 NodeSection 实例，证明 expansion、order、dialogs/portals、show-more、drag 和 directory flow 相互隔离。
- [x] 1.7 将单 Node NodeSection 与未修改的官方 WorkspaceBrowser 做黑盒差分，覆盖 blank、rename/fork/archive、status/subagent、hover/copy、键盘、ARIA 和 reduced motion；记录行为 ownership 矩阵允许的外壳差异。
- [x] 1.8 证明 SlotRegistry inspection 虽保留无类型 `StoredEntry.component`，但没有受支持的 typed/re-rendering 装配 seam；证明完整 WorkspaceBrowser 多实例会重复外壳，并把“不使用运行时 entry 包裹/完整 Browser 重复实例”的证据固化为测试或设计记录。
- [x] 1.9 在隔离 DSH_HOME 产出完整 client call graph/route inventory；以固定源码/hash 的最小 rc.2 Connection compatibility patch 提供 trust-fence 内、composed-handler 外的唯一 `/api` middleware seam，并验证 middleware + 全部必要 exact routes 的事务注册、每个注册位置冲突回滚和 deny-by-default：任何 `fed1:` ID 不得进入本机 fallback。
- [x] 1.10 原型验证进程级 Host READY 与 per-client CLIENT_FEDERATED/FALLBACK 状态，覆盖两个 tab、晚到 tab、刷新、entry crash 和单 Client 失败不影响其他 Client。
- [x] 1.11 用受控 loopback SSH fixture 验证系统 OpenSSH alias、BatchMode、host-key 拒绝、ProxyJump 配置透传、ExitOnForwardFailure、keepalive 和子进程清理。
- [x] 1.12 用三节点合成 fixture 制造相同 native workspace/session id，验证联合 ID、双事件流、generation 丢弃和命令归属不碰撞。
- [x] 1.13 汇总 M0 gate 报告；源码/Embed、多实例隔离、route inventory 或多 Client 激活任一核心 seam 无法证明时暂停 apply、修订 OpenSpec 并请求重新评审，不默认转为完整 WorkspaceBrowser 重写。

## 2. Package、构建与清单骨架

- [x] 2.1 新建 `packages/dsh-federation/` 社区 bundle 骨架、Host/Client exports、`cordis.patch.yml`、README、CHANGELOG、NOTICE 和独立版本，标准构建产物保持不入 Git。
- [x] 2.2 在 `dsh.yaml` 增加默认禁用的 local package 条目和完整风险/回滚说明，并更新根 lockfile、peer/version-family 检查与 artifact 检查。
- [x] 2.3 建立 `core/host/client/contract` 目录和 import-boundary 检查，禁止 Core 导入 Cordis、React、fs、HTTP/WS、OpenSSH 或 DSH wire 类型。
- [x] 2.4 将 M0 Workspace Embed 获取、hash 校验和 patch 过程接入 local package build，保证失败发生在替换已部署 package 之前。
- [x] 2.5 为 Workspace Embed 生成物增加 provenance manifest（DSH version、release commit、目标 hashes、patch hash），并验证未变输入的第二次 build 复用缓存。
- [x] 2.6 建立 rc.2 compatibility matrix 和脱敏 protocol/UI fixture 目录，阻止真实路径、token、完整 history、截图和原始用户内容进入版本控制。

## 3. Stable Federation Core

- [x] 3.1 定义 `NodeId`、`WorkspaceRef`、`SessionRef`、`NodeState`、capability、delivery state、domain error 和 `DshNodePort` 稳定契约。
- [x] 3.2 实现 `fed1` workspace/session ID 严格编解码、长度/字符校验、类型校验和未知节点 fail-closed 路由。
- [x] 3.3 为 ID 增加 round-trip、畸形输入、未知版本、类型混用、重命名稳定性和跨节点 native-id 碰撞的属性测试。
- [x] 3.4 实现 Node registry 领域模型、不可变 local/remote node id、顺序、启用状态和显示名/alias 变更语义。
- [x] 3.5 实现 Node/Workspace/Session/Ungrouped/archived 投影及跨节点状态聚合，保证路径始终携带节点归属而不被解析为本机路径。
- [x] 3.6 实现命令路由器，覆盖 workspace/session/list/history/prompt/cancel/model/queue/attachment/search/archive/respond 等稳定命令和 capability 门禁。（`workspace.insertSessionBefore` 已补齐 Port→Router→Uplink→Adapter 全链；并由 `tests/federation-central-path-live.test.mjs` 以真实浏览器 `client-request` envelope 驱动真实远端 rc.2，读远端 `workspace.list` 验证持久顺序。）
- [x] 3.7 实现每节点 baseline/generation 对账：session seq/asOfSeq higher-seq-wins；无全局 seq 的 Host frames 使用预缓冲、完整快照、tombstone 和权威 refresh；测试 list-subscribe 窗口、双流乱序、重复、迟到、删除和 refresh race。（生产 `establishRc2NodeSession` 已接 `NodeReconciler`：先开双流再取权威 baseline、缓冲重放、host 窗口触发权威 refresh，收敛后才发布 port。）
- [x] 3.8 实现写操作 ledger 与 NOT_SENT/SENT_AWAITING_RESPONSE/ACCEPTED/REJECTED/OUTCOME_UNKNOWN 转移，证明断线后不会自动重放。（`LedgeredNodePort` 是生产唯一写包装；SENT 以 carrier 真实 fetch 边界为准，pre-send 失败保持 NOT_SENT，UNKNOWN 后迟到的明确业务拒绝可收敛为 REJECTED。）
- [x] 3.9 实现 per-operation unknown reconciliation：prompt 仅按持久 rpcId，具 seq/revision 操作按唯一证据；cancel/model selection 等无证明时无限保持未知，并测试相同文本和并发远端 GUI。（重连建链时按 session 分组、最多 20 页扫描 history，仅 `user/message.data.source.rpcId` 精确匹配可收敛；相同文本或他客户端 rpcId 不构成证据。注：rc.2 未为 rename 等提供响应前可比的持久 seq，故该类在响应丢失后按规范无限保持未知。）

## 4. Registry Storage 与 OpenSSH Tunnel Manager

- [x] 4.1 实现 `$DSH_HOME/plugins/dsh-federation/nodes.json` versioned schema、owner-only parent、regular-file/no-follow、generation/CAS、0600 temp、file/dir fsync、rename 和保守读取。
- [x] 4.2 测试 registry 缺失、symlink、权限过宽、截断、未知版本、并发写、陈旧 temp、写中断和损坏文件不被空配置覆盖。
- [x] 4.3 实现只做 BatchMode 登录的 SSH identity probe；保存/alias 修改与之后的 DSH readiness 分离，不执行远端 `command -v` 或通用 exec。
- [x] 4.4 实现 per-node OpenSSH Tunnel Manager，严格 argv/option boundary、alias 字符验证、OS 分配候选端口 + bind 冲突有界重试，并仅在自有 SSH ready 与 DSH protocol probe 成功后发布回环 endpoint；跟踪 process/generation。
- [x] 4.5 实现 SSH stderr 有界采集和脱敏分类，映射 SSH_UNREACHABLE、TUNNEL_ERROR、DSH_UNAVAILABLE、NON_DSH_SERVICE、INCOMPATIBLE 等节点状态。
- [x] 4.6 实现节点 disable/delete、正常 unload、可捕获退出信号和失败重试时的幂等 disposer，测试无遗留自有 ssh 进程/socket/timer且不误杀其他 SSH；不可捕获终止不宣称同步清理，重启不得按端口/命令行猜测归属；存在 unknown ledger 时删除需确认并保留最小诊断。
- [x] 4.7 实现带抖动上限的 per-node reconnect backoff，验证单节点故障不阻塞本机和其他远端。

## 5. Carrier 与 rc.2 Remote Adapter

- [x] 5.1 实现只接收 Tunnel Manager 回环 endpoint 的 HTTP unary carrier，包含 timeout、AbortSignal、body 限制、结构化 transport/protocol error 和 generation。
- [x] 5.2 实现 `/api/events.mux` 与 `/api/events.host` 双流生命周期、验证、背压/有界缓存、断线通知和旧 generation 丢弃。（生产使用官方 schema validator；联合 open 具共享失败门与 commit 前双流校验，半开失败关闭对端；失败流的排队帧在 message/drain 两层拒收。）
- [x] 5.3 实现 rc.2 只读 host/version/capability probe，并按 SUPPORTED/EXPERIMENTAL/INCOMPATIBLE 矩阵保守开放读写能力。（拆为 `probeUnary` 与 `finalizeProbe`；写/事件能力只在 Carrier 生成的 module-private branded 双开 token 验证后授予，调用方伪造对象被拒。）
- [x] 5.4 实现 `DshRc2NodeAdapter` 的 workspace/session baseline 与增量事件转换，Core 不接触 rc.2 schema。（已接生产双流与 `NodeReconciler`；`stream/error` 提升为致命 stream fault。）
- [x] 5.5 实现 Workspace CRUD/reorder、Session create/history/prompt/cancel/rename/fork/model/queue/attachment/search/archive/respond 的稳定命令转换。（补齐 `workspace.insertSessionBefore` 的 method/payload/response 契约。）
- [x] 5.6 为每个 adapter 方法增加 rc.2 fixture contract test，覆盖 remote business error、未知字段、可选能力缺失和 abort/断线。（fixture 已对齐官方 `WorkspaceView` 完整字段，含时间戳与 session `blank/updatedAt`。）
- [x] 5.7 证明 Adapter 不调用 Settings/Subscriptions/Credentials、provider secret、host.openPath、文件同步或远端安装/启停接口。

## 6. Central Adapter 与原子激活

- [x] 6.1 实现 Central rc.2 Adapter 的本机 Node port，使 This Mac 与远端经过同一联合 ID/Core 路径但仍执行本机 Host 语义。
- [x] 6.2 实现联合 workspace/session baseline 到中央 rc.2 Runtime 视图的投影，包含 archived、Ungrouped、current session、blank 和 collision-safe IDs。
- [x] 6.3 实现 Core domain events 到中央 mux/host frames 的转换，覆盖 conversation streaming、approval、plan、question、workspace changed、archive 和 model state。
- [x] 6.4 实现中央上行 exact-route handlers，先校验联合 ID/node ownership/capability，再解码并调用所属 Node port。
- [x] 6.5 实现有效 composed Connection `/api` handler 的本机 pass-through，验证 Typert/interceptor-before-fallback 语义不被绕过。
- [x] 6.6 实现 route registration transaction、冲突诊断和反向 disposer；用每个注册位置故障注入证明无部分接管。
- [x] 6.7 实现进程级 Host activation coordinator，只在 Core/registry/local adapter/inventory routes ready 后提交，并安全支持官方裸本机 ID 与联合 ID。（host `apply()` 已真实接线并验证：无 registry/无启用远端时完全不接管）
- [x] 6.8 实现 per-client UI activation：bridge/Node Shell/Workspace Embed/Picker ready 才 shadow 官方 slots；timeout/entry crash 只回退当前 Client，不影响 Host 或其他 tab。（bridge/Node Shell/Embed/Picker 均已真实接线并对真实 rc.2 SlotCore 验证：远端节点由 `NodeProjectionRuntime` 提供投影、baseline 就绪才激活、baseline 失败则整个浏览器保持官方、entry crash 同时处置两个面、Hero 渲染真实 `FederatedHeroPicker`。见 `checking/client-bridge-report.md`）
- [x] 6.9 增加 unknown/forged node id、错误对象种类、跨节点 anchor 和过期 generation 请求的安全拒绝测试。

## 7. 联邦 Node Shell 与官方 Workspace Embed

- [x] 7.1 实现 `DshRc2WorkspaceEmbedAdapter` 的 node-scoped hooks/actions/hostDescription/current/view-store/dialog/portal/drag 绑定，并为每个 Node 渲染构建期导出的 `Rc2WorkspaceNodeSection`。
- [x] 7.2 实现 Node 行、online/connecting/degraded/incompatible/offline/stale 状态、折叠、待回答/运行聚合和中央持久顺序。
- [x] 7.3 实现全局 grouped/flat/manual/updated 控制；flat 模式仍保留 Node 分区并复用官方 Session rows/order behavior。
- [x] 7.4 实现 Node-scoped Workspace add/rename/delete/create-session 和 This Mac/远端目录选择入口，保证所有 path action 显式绑定 node id。
- [x] 7.5 实现远端应用内 Miller-column directory flow、路径输入、隐藏目录、单级创建、断线重试和 This Mac native/browse capability 分支。
- [x] 7.6 实现联邦 Hero Workspace Picker，使 New Session/空白页面与侧栏共享 Node/Workspace 选择和 blank-session reuse 语义。（注：本条此前已标完成，但 `entry.tsx` 的 Hero 实际是复用 sidebar 子树的占位；round 18 才真正接入 `FederatedHeroPicker` 并以渲染断言验证 node/workspace 选择与 blank-session reuse。）
- [x] 7.7 实现全局搜索 coordinator：250ms debounce、AbortSignal、每节点独立超时、metadata/content 合并、20 条上限、hasMore 和部分失败警告。
- [x] 7.8 实现搜索结果 Node/Workspace context、联合 session 打开与查询保持，测试同名/同 native id 不误选。
- [x] 7.9 实现 Node drag scope；官方 Workspace/Session drag 仅在同 Node/同 Workspace section 内生效，跨 Node/Workspace 不显示 marker 且不发 RPC。（接收链已补齐：真实浏览器 envelope 经 Connection→Uplink→Router→Adapter 落到远端 rc.2，并在远端权威 `workspace.list` 中验证持久顺序；跨 node/workspace 在 Router 与 Uplink 双层拒绝。）
- [x] 7.10 实现 stale/offline 节点树骨架和写禁用，确保其他节点、搜索成功结果与本机 conversation 不受影响。
- [x] 7.11 将官方 rc.2 WorkspaceBrowser 行为清单转为自动 UI 回归矩阵，覆盖默认五条/show-more、blank、menus/dialogs、status/subagent、hover/copy、rail、keyboard/ARIA/reduced-motion。

## 8. 本机插件兼容与按节点扩展

- [x] 8.1 在 `Rc2WorkspaceNodeSection` 声明并渲染兼容的 `sidebar.workspaces.row-menu` list seam，验证官方 rename/delete 与第三方 rows 的顺序、关闭和错误隔离。
- [x] 8.2 适配 `dsh-open-in-vscode`：This Mac 保留动作并只传本机 cwd；远端默认隐藏，不把远端路径交给中央 `code`。
- [x] 8.3 为 `sidebar-session-provider-icon` 增加正式 Row renderer，复用 selector-current 优先和 projection fallback 数据，不重复实现品牌判定。
- [x] 8.4 联邦激活时停止 provider-icon DOM 注入、回退官方模式时恢复，测试无重复 logo 且不改变 StateDot、时间、菜单和拖拽。
- [x] 8.5 回归 `ui-archive-manager` 与 `worktree-session` 的 This Mac 行为；远端只在 capability probe 证明协议存在时显示对应扩展操作。
- [x] 8.6 回归 cost meter、subscriptions、better-sidebar、sidebar-qa 和 width-tiers 与单一官方 Conversation/SessionRuntime 的组合，记录任何明确不兼容项。

## 9. 可靠性、安全与性能验证

- [x] 9.1 对节点添加/编辑/删除、SSH/DSH 状态和分级错误建立 Host 与 Client 测试，确保诊断可执行且日志不泄漏 secret/完整会话内容。
- [x] 9.2 执行断 tunnel、杀 ssh 子进程、双流半断、HTTP response 丢失、baseline 延迟、旧帧注入和中央重启故障测试。（`tests/federation-connectivity-live.test.mjs` 以真实 OpenSSH 隧道与真实隔离 rc.2 覆盖断流降级、baseline 不再作为 live 服务、远端重启后中央自动新 generation 恢复；半开/失败流/旧 generation 由 Carrier 层反例覆盖。）
- [ ] 9.3 执行多客户端并发测试：中央 GUI 与远端 GUI 同时 prompt/cancel/approve/rename/reorder，验证远端 Host 最终权威且无联邦锁。（production ledger/reconciler/reorder 接线未完成，历史组件测试不足以证明本条。）
- [x] 9.4 执行跨节点安全测试：未知 node、伪造联合 ID、跨 Node drag、远端 path 本机打开、任意 SSH target/command 和明文 LAN endpoint 均 fail closed。
- [x] 9.5 建立侧栏规模基准（至少三 Node、多 Workspace/Session、一个离线节点），验证首屏、搜索、展开和事件更新无明显主线程阻塞或无界缓存。
- [x] 9.6 验证禁用 federation 后官方 routes、sidebar、Hero Picker、provider logo、本机 session 与插件完整恢复，远端没有安装物或数据变更。

## 10. 三节点验收、文档与启用

- [x] 10.1 在隔离 DSH_HOME 配置 This Mac、VM A、VM B，并人为制造相同 native workspace/session id，完成全部 namespace 与 Node→Workspace→Session 验收。
- [ ] 10.2 使用 VM 自有 Claude 订阅完成真实 prompt、stream、tool、approval/question、model switch 和中央断线后远端独立完成/重连恢复验收。（断线独立/重连恢复已由 `tests/federation-disconnect-recovery.test.mjs` 对真实 rc.2 证明；仅剩消耗订阅的真实 model turn 待操作者驱动）
- [x] 10.3 完成远端 workspace 浏览/创建/重命名/注册删除、session create/blank/rename/fork/archive/search/reorder 和禁止跨节点拖拽验收。
- [x] 10.4 编写节点准备、SSH alias、远端 `dsh web`、状态修复、兼容矩阵、OUTCOME_UNKNOWN、隐私边界、禁用/回滚和升级 Workspace Embed patch 的运维文档。
- [x] 10.5 运行 package typecheck/lint/unit/integration/UI tests、根 `npm test`、`npm run check:artifacts` 和 OpenSpec strict validation，并记录实际结果。
- [ ] 10.6 在启用前运行 `node scripts/sync.mjs`/`dsh build` 两次验证幂等；确认旧 profile 可安全回滚后才将 `dsh.yaml` 条目切为 enabled。（隔离 DSH_HOME 下的 build/deploy/幂等/回滚/再启用已由 `tests/federation-sync-rollback.test.mjs` 证明。**真实 `~/.dsh` 幂等已在 `enabled:false` 下验证**：修掉 `llm-subscriptions` 的装饰版本 `0.5.2+pr40`→`0.5.2` 后，连续两次 sync 均报 `no changes`，部署面与基线逐项一致（104 模块 / 89 版本 / AGENTS.md 全同），现有 Host 未受影响；该幂等缺陷已由 `tests/manifest-version-drift.test.mjs` 固化防回归。仅剩切换 `enabled:true` 后的真实部署待操作者决定。）
- [ ] 10.7 重启现有 DSH Web Host、刷新 `http://127.0.0.1:3080` 验证实际注入 GUI；不得启动替代 server 冒充现有页面。
- [ ] 10.8 完成最终安全/兼容审查和 M0–M3 验收报告，确认无剩余阻断项后再进入 change 归档流程。（仓库侧安全/兼容审查与 M0–M3 报告已完成：`checking/m0-m3-acceptance-report.md`，含禁止面静态审查、24 项 mutation 覆盖汇总与已知限制清单。剩余部分依赖 10.2/10.6/10.7 的操作者执行结果，故不勾选。）
