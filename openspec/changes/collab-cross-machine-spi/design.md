## Context

- 当前 kernel 的接入面只有 `ChannelProvider { claim, deliver, presence }`（`packages/collab-kernel/src/spi/index.ts`），成员绑定是 `{channel, address}`（`model/index.ts`）；dsh-collab 用 `dsh-session` channel 实现本机会话认领与下一回合唤醒（`packages/dsh-collab/src/session-provider.ts`），空间日志由 `FileStore` 在本机独占写入（`host.ts`）。调用者身份由 `SessionAccess.caller(exec)` 从实际执行会话解析，guard 在内核提交与读取边界重验。
- `collab_status`（`status.ts`）只扫描本机已打开日志，按白名单输出，spaceId 须匹配 `^[a-z0-9][a-z0-9-]{0,63}$`；邀请后的代为加入由 `tools.ts` 的 `autoJoin` 以保留 cmdId `dsh-collab:auto-join` 完成，按本机 `memberTrust` 决定。
- `serviceId` 与 spaceId 都不是跨机唯一（memex: collab-serviceid-and-spaceid-not-cross-machine-unique）；cockpit 只有 hub→设备方向（memex: cross-machine-collab-ledger-must-be-hub-initiated）。
- 跨仓契约：协作空间 `cross-machine-collab` 的 charter `relay-contract` revision 4（契约 v3；权威细节在 dsh-cockpit change `cross-device-session-relay` 的 specs）。要点：cockpit 插件提供进程内服务 `cockpitRelay { state, directory, subscribe, send, receive }`；信封 `{msgId, origin, target, kind: claim|wake|call|reply, inReplyTo?, body}`，body ≤1 MiB，origin 由 cockpit 盖章；msgId 由发送方生成，禁用 `:`；尽力而为，两侧都不持久化信封，重启/过期丢弃无回执；目标 shim 自己回 reply，cockpit 只在确定目标未执行时代发 `undeliverable:<msgId>` 回执（带 `relay:true`，见补充）；插件保证同 (origin,msgId) 10 分钟内只调用一次处理器；目录是带 revision 的推送快照，离线体现为 presence 变化，cockpit 重启后 revision 从 1 重新开始。

## Goals / Non-Goals

**Goals:**
- kernel 定义与传输无关的 runtime SPI；本机与远端同构，以 self 比较区分。
- 远端一级会话可被邀请、加入、读写、发现自己所在的远端空间，可以当 Leader（手动 `transferLeader`）。
- 纯本机空间对旧内核仍可读；未接入传输时行为与变更前一致。
- shim 是唯一知道 cockpit 的模块，可通过 `dsh.yaml` 独立启用/禁用。

**Non-Goals:**
- **Leader 自动转交（failover）**：拆到后续 change（暂名 `collab-leader-failover`）。原因见决策 9。
- Pet Locus 三层结构；托管成员跨机；wake 丢失的自动补救；hub 式集中台账；owner 迁移；跨机即时撤销远端会话授权。

## Decisions

1. **runtime 注册表作为普通会话的路由主键；self runtime 是现有 `dsh-session` provider 的适配，presence、supportsMode 与投递仍走原逻辑，远端 runtime 只支持默认投递方式、presence 由注册表决定（审查 R2-M2）。** `runtime-session` 是内核保留 channel，配置与 provider 都不能占用；旧日志中该 channel 下的托管成员照常重放但不能被远端匹配（审查 R2-C2）。 被否：每台远端设备注册一个 ChannelProvider——channel 命名空间混入设备身份，读写转发与发现也无处安放。
2. **self 比较，不设 `local` 字段；`local` 是保留 id，任何远端 id 都不能等于它。** 测试可用两个内核实例互为远端。
3. **注册表可替换并带 generation，`register` 返回 dispose 句柄。** 断开、恢复、目录删除都通过对账表达；generation 让旧连接的 pending 调用与入站 guard 失效（审查 M3、C1）。
4. **本机成员继续写 `dsh-session`，远端成员写 `runtime-session:<runtimeId>/<sessionId>`。** 纯本机日志对旧内核字节兼容。被否：统一写 `runtime-session:local/x`——会让任何新空间都无法回滚。
5. **身份主体 = cockpit 证明的来源 Host + 来源 Host 担保的 sessionId。** 来源 Host 用既有 `caller(exec)` 推导并在发送前重跑 guard；owner 用"来源 generation 未变"作为同步可检查的 call-level guard。代价：来源侧的归档/拒绝名单变化不能实时传到 owner，最迟在来源断开时生效——写入 spec 的担保边界。被否：owner 查目录判定 active——目录只有元数据，既不能证明执行者，也不实时（审查 C1）。
6. **入站 call 是封闭判别联合，按工具层的参数白名单校验，owner 只服务自己的空间。** 不提供 manager/internal/createSpace，不做嵌套转发，错误在 owner 与来源两侧都过 `safeError`（审查 C5）。
7. **标识改写是 shim 内的带类型映射表**，只碰 wake 指针 spaceId、call spaceId、invite recipient、joinConsent spaceRef；日志与内核只见裸 id 或 `runtime-session` 地址。邀请的裸 sessionId 先在调用者 Host 绑定为该 Host（审查 C2）。
8. **跨机代为加入由被邀请方 Host 的 `memberTrust` 决定**，经独立的 `joinConsent` 操作询问；owner 收到同意后用保留 cmdId 代 join。顺序与本机一致：invite 提交（意图唤醒）→ 询问 → 代 join；唤醒可能先于 join 到达，现有唤醒提示已覆盖"仍为 invited 时自行 join"。不复用 wake 承担加入，保持"投递不触发加入"（审查 C3）。
9. **failover 拆出。** 它要修改内核封闭授权表（新增受信宿主写入口）、定义离线计时的重启语义与竞态重验，却不改善 owner 离线时的可用性；首版保留手动 `transferLeader` 即可让远端成员当 Leader（审查 M2、S1）。用户先前确认过"远端可当 leader，owner 自动转交"，这里只改变交付顺序，需用户在审阅时确认。
10. **发现靠每个 Host 的远端成员索引 + 向 owner 的 status call 聚合。** owner 对不存在/非成员/退出的情况统一回成功空片段，既不泄露空间存在性，又给来源侧明确的删索引信号（审查 R2-M1）。远端命令与 overview 返回值的顶层 spaceId 改写为 owner 限定引用；`since` 保留原始记录（审查 R2-M6）。 索引只是提示，owner 是权威；不可达的空间列入新增的 `unreachable` 键；远端片段在本地按白名单再过滤。工具不列出远端目录（审查 C4）。
11. **错误分层**：Connection 只抛 `TransportError{unavailable|rejected}`；内核不新增码；dsh-collab 映射，并新增唯一的 `COLLAB_PAYLOAD_TOO_LARGE`（超限是确定性失败，不应混入"结果未知"）。远端 `since` 读取按体积返回连续前缀，调用方续读；overview 超限回固定错误（审查 M5、M6）。
12. **入站去重只依赖插件的 10 分钟单次调用保证，shim 不缓存 reply。** 每次进入处理器都重新经过准入与 generation guard，避免缓存跨换代重放旧授权结果；窗口外写命令靠 cmdId，wake 可能重复（审查 M1、R2-C1）。

## Risks / Trade-offs

- [owner 离线期间远端成员不可读写] → 契约接受；`unreachable` 与 `COLLAB_SPACE_UNAVAILABLE` 如实显示。
- [撤销延迟：来源会话在请求发出后、owner 提交前被归档或拒绝，请求仍会提交；之后来源 Host 不再发送该会话的请求，owner 最迟在来源断开时失效] → 担保边界写入 spec；这是正常在途操作就会出现的窗口，不需要来源 Host 被攻破。
- [Leader 所在机器长期离线时无人能管理成员] → 首版由其他成员接受现状，后续 failover change 解决。
- [发现索引丢失（dataDir 被清）] → 下一次远端唤醒或转发调用会重建；期间可用 `collab_read(spaceId:'x@dev')` 直接访问。
- [wake 在插件去重窗口外或 Host 重启后可能重复多次] → 唤醒只是"去看 status"的指针，重复不改变状态。

## Migration Plan

1. kernel：runtime 注册表、地址解释、错误分层、远端 wake；现有测试不改即过，并加旧构建读取夹具。
2. dsh-collab：self runtime、入站封闭 call、转发、跨机邀请与 joinConsent、发现索引、status 修改、错误映射。
3. 新增 `packages/collab-cockpit-shim`，`dsh.yaml` 条目默认 `enabled: false`；与 cockpit 设备插件联调后再启用。

回滚：禁用 shim 即注销全部远端 runtime，纯本机空间行为不变；含远端成员的空间在禁用 shim 后其远端成员不可达，空间仍可本机使用。降级 kernel 只保证纯本机日志可读（有测试）；曾有远端成员的空间不承诺旧内核行为（成员退役不会删除历史中的 `runtime-session` 事件），这类空间应保持新内核，或先关闭空间再降级。

## Open Questions

- 契约补充 `relay-contract-addendum-1`（已与 cockpit 商定）：中继回执带 `relay:true` 且 cockpit 会剥除设备信封里的该字段；`cockpitRelay.contractVersion` 本版为 1；cockpit 只对满足 `^[a-z0-9][a-z0-9-]{0,63}$` 且不为 `local` 的设备启用中继，shim 仍对不合规 id 不注册作为纵深防御。
- 决策 9 拆出 failover 需用户确认。
- 跨机 invite 只接受精确 `runtimeId/sessionId`，工具不列出远端目录（按倾向暂定，用户可推翻）。
