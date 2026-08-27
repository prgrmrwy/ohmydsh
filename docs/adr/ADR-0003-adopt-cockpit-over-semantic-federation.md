# ADR-0003: 多机 DSH 采用驾驶舱外壳，不采用语义联合 Host

- **Status**: Accepted
- **Date**: 2026-08-27
- **Relates to**: OpenSpec change `federated-dsh-control-plane`（本 ADR 使其转为“已探索但不采用”）；后继独立项目 `dsh-cockpit`

## Context

目标一直是“用一个页面管理 This Mac、VM 与未来 devbox 上的多个 DSH”。
`federated-dsh-control-plane` 选择的路径是**语义联合 Host**：中央 DSH 接管
workspace/session API，把远端 baseline 与事件改写进本机 rc.2 Runtime，从而在
本机侧栏呈现一棵 `Node → Workspace → Session` 树。

该路径实施到 77/82，并在多轮独立只读验收中修掉 10 个真实缺陷（见 commit
`5060459`）。技术上可行，但它的**成本结构**在实施后期才完全显露：

1. 为了在官方 composed handler 内取得唯一 `/api` middleware 与可复用的
   Workspace 子树，必须引入**两个钉死上游 commit 的 compatibility patch**
   （Workspace Embed 与 Connection），长期需要跟随上游手工升级。
2. 因为中央要“操作”远端，就必须自行承担联合 ID 编解码、命令路由、写操作
   交付 ledger、双流 generation 对账与中央 frame 转换——这批机制正是那 10
   个缺陷的来源域。
3. 规范明令禁止代理远端 Settings/Subscriptions/Credentials
   （`specs/federated-workspace-sessions/spec.md`「订阅凭据、设置和文件仍归
   节点所有」）。因此**远端 settings、usage、以及远端自己的插件 UI 在中央
   拿不到**——而这些恰是日常关注项。
4. 每个远端未来新增的 DSH 能力，都要在联邦侧再适配一次。

也就是说：这条路径付出极高复杂度换到的核心收益只有一项——**多机器同时展开
成一棵树**（及其衍生的跨机搜索、全局待办聚合）；而它换不到 settings/usage/
插件继承。

### 决定性实测证据（2026-08-27，全部对真实 `lumevm` 执行）

重新评估时，用真实远端而非模拟验证了“外壳”路径的全部核心假设：

| 假设 | 结果 |
| --- | --- |
| 远端仅需标准 `dsh web`，无需插件 | ✅ `host.describe` 正常（`attachedSessions 5`），`session.list` 返回 26 会话且 `running` 可直接查询 |
| 官方事件流可经隧道消费 | ✅ `/api/events.mux` 与 `/api/events.host` 均打开成功；mux 收到 `session/subscribed`×5 与 `session/jobs` |
| 三件关注项官方已覆盖 | ✅ `host/session-status`（在跑）、`approval/requested` 与 `question/requested`（要人决策）、`*/resolved`（已处理） |
| 真实远端变更可被外部消费者收到 | ✅ 建 workspace→`host/workspace-changed`；建 session→`host/session-added`；归档→`host/archived-sessions-changed`；删→`host/workspace-removed` |
| **rc.2 单消费者语义是否抢占外部订阅** | ✅ **已证伪**：真实 Safari 打开该台 GUI 全程 45 秒，外部两条流 `close: null`，从未被踢；4 条流并发共存，期间外部 RPC 仍 `ok`。单消费者约束在浏览器端 `ConnectionHandle`，不在服务端事件流 |
| 远端 GUI 可被 iframe 嵌入 | ✅ 无 `X-Frame-Options`、无 CSP `frame-ancestors` |
| 回环端口是 secure context | ✅ 每个 `127.0.0.1:<port>` 均满足，`crypto.randomUUID()` 可用 |

附带实证一条设计原则：向远端传本机路径 `/tmp/...` 被拒为
`workspace-invalid-path: ENOENT`，说明**远端路径不可按本机路径处理**在两种
架构下都成立。

## Decision

**采用驾驶舱外壳（cockpit shell），不采用语义联合 Host。**

- **操作面零协议耦合**：驾驶舱不接管任何 workspace/session API。选中设备后
  直接承载该设备**原生 DSH Web**（经回环隧道的 iframe），因此 settings、
  usage、远端自有插件与未来新能力**天然继承**。
- **统筹面只读**：驾驶舱自行常驻消费官方双事件流与只读 RPC，聚合“几个在跑 /
  有无待人决策”。不代理凭据、不写远端、不引入远端插件。
- **两通道相互独立**：状态聚合走驾驶舱直连，工作台走 iframe；跨域使父页面无法
  读取 iframe DOM，但架构上无此需要，且获得故障隔离。
- **载体**：独立本地服务 + 浏览器页面，与本机 DSH 解耦，本机 DSH 不可用时
  驾驶舱仍可用。
- **实现位置**：独立项目 `dsh-cockpit`（含其自身 OpenSpec），不继续在
  `ohmydsh` 内演进。

因此以下机制**不再需要**：两个上游 compat patch、联合 ID 编解码、
CommandRouter、写操作 ledger、generation 对账、中央 frame 转换、联邦 Node
Shell 与 Hero Picker。

### 明确放弃的能力

驾驶舱**一次专注一台**，故放弃“多机器同时展开成一棵树”，以及依赖该树的
跨机器并排对照。跨机器**全局搜索**改为统筹层的后续能力（并行查询各设备
只读 API、结果标注设备），架构留位但 V1 不做。

### 已知边界（协议限制，非实现取舍）

`SessionSummary` 只含 `running` / `blank` / `updatedAt` / `cwd` /
`projections`，**没有 pending interaction 字段**。因此
`approval/requested` 只有事件、不可查询：驾驶舱关闭或 ws 断连期间到达的
approval 无法回读，手动刷新亦无字段可查。缓解方式是进入该设备工作台后由其
自身 UI 正常呈现。不为此引入持久待办账本，以免制造与设备自身相竞争的
第二个真相源。

## Consequences

**正面**

- 去掉两个 fork 上游 commit 的 patch，长期维护成本下降一个数量级。
- 远端保持标准 `dsh web`，零改造即可纳管；升级远端不需要联邦侧适配。
- 本机 5 个 UI 插件（`better-sidebar`、`sidebar-qa`、`width-tiers`、
  `sidebar-session-provider-icon`、`cost-meter`）完全不受影响——驾驶舱不改
  本机 sidebar，无需兼容回归。
- 远端 settings/usage/插件从“禁止代理”变为“天然继承”。

**负面**

- 失去单页多机同时展开与跨机并排对照。
- 全局搜索需在统筹层重新实现（V1 不做）。
- 浏览器载体没有系统级通知；若日后强需要，需另评估桌面壳。

**资产处置**

`federated-dsh-control-plane` 归档为“已探索但不采用”。以下经独立验收加固的
模块为真实资产，迁移至 `dsh-cockpit` 复用：

- 节点注册表持久化：generation/CAS、0600、fsync、regular-file/no-follow、
  损坏文件不被空配置覆盖
- OpenSSH 隧道生命周期：仅 BatchMode 身份探测、严格 argv/option boundary 与
  alias 注入防护、OS 分配候选端口与 bind 冲突有界重试、`ExitOnForwardFailure`、
  keepalive、stderr 有界采集与脱敏、进程跟踪
- 终结性信号清理：清理后不得再 spawn；启动窗口不得留 `ppid=1` 孤儿；
  空转信号不得烧毁一次性 latch
- 状态分级：`SSH_UNREACHABLE` / `TUNNEL_ERROR` / `DSH_UNAVAILABLE` /
  `NON_DSH_SERVICE` / `INCOMPATIBLE`，及 per-node 抖动退避与 attach/detach
- 能力探测 `probeUnary` 与官方事件 envelope 校验（只读部分）
- 删除节点的确认门禁与最小脱敏诊断保留（含不可逆摘要）

不迁移的部分随归档保留为历史证据，不再维护。`packages/dsh-federation`
在资产提取完成后从 `dsh.yaml` 移除（当前即为 `enabled: false`，从未部署到
真实 `~/.dsh`）。

## Notes

社区现状（2026-08-27 调研）：多机隧道管理有
[dsh-ssh-tunnel](https://github.com/thirsty5034/dsh-ssh-tunnel)，多会话并排有
[dsh-multi-chat](https://github.com/daetz-coder/dsh-multi-chat)，usage 聚合有
[dsh-hub-oauth-gateway](https://github.com/lninghaha/dsh-hub-oauth-gateway)；
**“多机器完整工作台切换”尚无实现**。实现前应先读 `dsh-ssh-tunnel`，判断连接层
是复用还是自研，而非凭 README 推断。
