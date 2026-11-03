## Why

dsh-collab 目前只能在同一 Host 内协作：成员地址是本机 `dsh-session` 会话 ID，空间日志由本机 Host 独占写入。用户需要让不同机器上的一级会话加入同一协作空间（例如本仓 ohmydsh 会话与 dsh-cockpit 会话分别跑在不同设备上）。dsh-cockpit 已有设备目录与 SSH `-L` 隧道，但设备没有回连通道，而且 collab 的 `serviceId` 与 `spaceId` 都不是跨机唯一，不能直接拿来路由。

跨仓契约已与 cockpit 会话商定（协作空间 `cross-machine-collab` 的 charter `relay-contract` revision 4（契约 v3））：collab 只定义与传输无关的 SPI，ohmydsh 侧用 shim 把 cockpit 的目录与不透明中继适配成该 SPI；cockpit 不理解 collab 语义。

## What Changes

- **collab-kernel 新增 runtime SPI**：可替换、带 generation 的 runtime 注册表（`register` 返回 dispose 句柄、`list`、`connect`）；`Connection { generation, sessions, claim, wake, call }`；`Connection` 只以 `TransportError{unavailable|rejected}` 失败。本机 runtime 固定为保留 id `local`，与远端同构，以 self 比较区分。
- **成员地址解释为 `runtimeId/sessionId`**：本机成员继续写 `dsh-session`（纯本机日志对旧内核字节兼容），远端成员写 `runtime-session:<runtimeId>/<sessionId>`；日志不写本机设备 id。远端成员的唤醒经其 runtime 投递，失败只记录不重投。
- **dsh-collab 跨机能力**：远端空间引用 `spaceId@runtimeId`，读写经封闭的入站 call 转发到 owner 执行；身份 = cockpit 证明的来源 Host + 来源 Host 从实际执行会话担保的 sessionId，owner 以来源 generation 作同步 guard；跨机邀请由被邀请方 Host 的 `memberTrust` 决定是否代为加入；每个 Host 维护远端成员索引，`collab_status` 聚合远端空间并新增 `unreachable` 键；跨机错误映射到现有 `COLLAB_SPACE_UNAVAILABLE`，新增唯一错误码 `COLLAB_PAYLOAD_TOO_LARGE`。
- **新增 collab-cockpit-shim**（ohmydsh 仓新 package）：按 relay-contract 读取本机 deviceId、目录与离线事件，对账注册远端 runtime；带类型的标识改写；reply 关联（绑定目标、kind、generation）、超时与 1 MiB 体积；来源校验；入站去重依赖插件保证、shim 不缓存 reply。未握手或契约版本不支持时不注册远端，collab 退回仅同机。
- 远端成员可以当 Leader（手动 `transferLeader`）。**Leader 自动转交拆到后续 change**，本 change 不实现。
- 任务模型不变：request 仍绑定成员，不做 claim 池、`@leader` 或改派；托管成员不跨机；session 上不暴露裸 `peer_*` 工具。

## Capabilities

### New Capabilities
- `collab-cockpit-shim`：用 dsh-cockpit 的设备目录与中继实现 collab runtime SPI 的适配层。

### Modified Capabilities
- `collab-kernel`：新增 runtime 注册表与 Connection SPI、带 runtime 的成员地址、跨机错误分层、远端唤醒。
- `dsh-collab`：self runtime、远端调用身份担保、封闭入站 call、远端空间引用与转发、跨机邀请与 joinConsent、远端发现索引、`collab_status` 输出白名单与标识规则（MODIFIED）、跨机错误映射、跨机投递失败显示。

## Impact

- 代码：`packages/collab-kernel/src/{spi,model,service,domain}`、`packages/dsh-collab/src/{host,session-provider,tools,status,integration}`，新增 `packages/collab-cockpit-shim/`；`dsh.yaml` 增加 shim 条目（默认禁用）。
- 依赖：shim 运行时依赖 cockpit 仓发布的设备侧 Host 插件，只通过 relay-contract 耦合；契约补充 `relay-contract-addendum-1`（relay 标记、contractVersion、deviceId 格式）已商定。
- 兼容：现有同机空间、旧日志、现有工具参数保持可用；`collab_status` 新增可选 `unreachable` 键，仅在有不可达远端空间时出现。
- 安全：远端调用身份只信 cockpit 盖章的来源与来源 Host 的担保；入站操作为封闭集合；错误脱敏；不新增凭据。
- 不在范围：Leader 自动转交、Pet Locus 三层结构、托管成员跨机、wake 丢失自动补救。
