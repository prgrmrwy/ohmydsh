## Test Plan

测试名即 vitest `it()` 的标题，取场景名原文；一个测试文件可覆盖同一 requirement 的多个场景。MODIFIED requirement 中沿用的旧场景映射到现有测试文件，实施时须确认原测试仍在并保持断言不变（初始状态记为 🟢 existing），只有新增场景从 🔴 red 开始。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → runtime 注册表与连接 SPI | 注册、列出与连接 | packages/collab-kernel/test/runtime-registry.test.ts | `注册、列出与连接` | 🔴 red |
| specs/collab-kernel/spec.md → runtime 注册表与连接 SPI | 非法与保留 id | packages/collab-kernel/test/runtime-registry.test.ts | `非法与保留 id` | 🔴 red |
| specs/collab-kernel/spec.md → runtime 注册表与连接 SPI | 替换注册使旧代调用失败 | packages/collab-kernel/test/runtime-registry.test.ts | `替换注册使旧代调用失败` | 🔴 red |
| specs/collab-kernel/spec.md → runtime 注册表与连接 SPI | 保留 channel 不能被 provider 占用 | packages/collab-kernel/test/runtime-registry.test.ts | `保留 channel 不能被 provider 占用` | 🔴 red |
| specs/collab-kernel/spec.md → runtime 注册表与连接 SPI | 注销后不可连接 | packages/collab-kernel/test/runtime-registry.test.ts | `注销后不可连接` | 🔴 red |
| specs/collab-kernel/spec.md → 成员地址带 runtime 且兼容旧绑定 | 旧日志成员按 self 解释 | packages/collab-kernel/test/runtime-address.test.ts | `旧日志成员按 self 解释` | 🔴 red |
| specs/collab-kernel/spec.md → 成员地址带 runtime 且兼容旧绑定 | 远端成员的写入形式 | packages/collab-kernel/test/runtime-address.test.ts | `远端成员的写入形式` | 🔴 red |
| specs/collab-kernel/spec.md → 成员地址带 runtime 且兼容旧绑定 | 旧托管成员与远端身份不碰撞 | packages/collab-kernel/test/runtime-address.test.ts | `旧托管成员与远端身份不碰撞` | 🔴 red |
| specs/collab-kernel/spec.md → 成员地址带 runtime 且兼容旧绑定 | 旧托管成员不走远端投递 | packages/collab-kernel/test/runtime-address.test.ts | `旧托管成员不走远端投递` | 🔴 red |
| specs/collab-kernel/spec.md → 成员地址带 runtime 且兼容旧绑定 | 保留 id 与不合规远端地址被拒 | packages/collab-kernel/test/runtime-address.test.ts | `保留 id 与不合规远端地址被拒` | 🔴 red |
| specs/collab-kernel/spec.md → 成员地址带 runtime 且兼容旧绑定 | 纯本机空间可被旧内核读取 | packages/collab-kernel/test/runtime-address.test.ts | `纯本机空间可被旧内核读取` | 🔴 red |
| specs/collab-kernel/spec.md → 跨机错误分层 | 远端认领不可达 | packages/collab-kernel/test/runtime-errors.test.ts | `远端认领不可达` | 🔴 red |
| specs/collab-kernel/spec.md → 跨机错误分层 | 远端拒绝认领 | packages/collab-kernel/test/runtime-errors.test.ts | `远端拒绝认领` | 🔴 red |
| specs/collab-kernel/spec.md → 远端成员的唤醒经其 runtime 投递 | 远端 presence 与投递方式 | packages/collab-kernel/test/runtime-wake.test.ts | `远端 presence 与投递方式` | 🔴 red |
| specs/collab-kernel/spec.md → 远端成员的唤醒经其 runtime 投递 | 远端唤醒成功与失败 | packages/collab-kernel/test/runtime-wake.test.ts | `远端唤醒成功与失败` | 🔴 red |
| specs/dsh-collab/spec.md → 本机 runtime 作为 self 提供 | 无远端 runtime 时行为不变 | packages/dsh-collab/test/self-runtime.test.ts | `无远端 runtime 时行为不变` | 🔴 red |
| specs/dsh-collab/spec.md → 本机 runtime 作为 self 提供 | self 认领仍拒绝子会话 | packages/dsh-collab/test/self-runtime.test.ts | `self 认领仍拒绝子会话` | 🔴 red |
| specs/dsh-collab/spec.md → 远端调用身份由来源 Host 担保 | 远端成员以自身身份写入 | packages/dsh-collab/test/remote-identity.test.ts | `远端成员以自身身份写入` | 🔴 red |
| specs/dsh-collab/spec.md → 远端调用身份由来源 Host 担保 | 跨来源冒用他人 sessionId 与 body 自报来源 | packages/dsh-collab/test/remote-identity.test.ts | `跨来源冒用他人 sessionId 与 body 自报来源` | 🔴 red |
| specs/dsh-collab/spec.md → 远端调用身份由来源 Host 担保 | 来源侧不能冒用同机其它会话 | packages/dsh-collab/test/remote-identity.test.ts | `来源侧不能冒用同机其它会话` | 🔴 red |
| specs/dsh-collab/spec.md → 远端调用身份由来源 Host 担保 | 断开换代后提交被拒 | packages/dsh-collab/test/remote-identity.test.ts | `断开换代后提交被拒` | 🔴 red |
| specs/dsh-collab/spec.md → 远端调用身份由来源 Host 担保 | 托管调用者不能跨机 | packages/dsh-collab/test/remote-identity.test.ts | `托管调用者不能跨机` | 🔴 red |
| specs/dsh-collab/spec.md → 入站 call 是封闭操作集合 | 未知操作与多余字段 | packages/dsh-collab/test/inbound-call.test.ts | `未知操作与多余字段` | 🔴 red |
| specs/dsh-collab/spec.md → 入站 call 是封闭操作集合 | 存储错误不泄露 | packages/dsh-collab/test/inbound-call.test.ts | `存储错误不泄露` | 🔴 red |
| specs/dsh-collab/spec.md → 远端空间引用与读写转发 | 远端 Leader 邀请自身机器与第三台机器的会话 | packages/dsh-collab/test/remote-forward.test.ts | `远端 Leader 邀请自身机器与第三台机器的会话` | 🔴 red |
| specs/dsh-collab/spec.md → 远端空间引用与读写转发 | 远端返回值可再次使用 | packages/dsh-collab/test/remote-forward.test.ts | `远端返回值可再次使用` | 🔴 red |
| specs/dsh-collab/spec.md → 远端空间引用与读写转发 | 单条记录超限 | packages/dsh-collab/test/remote-forward.test.ts | `单条记录超限` | 🔴 red |
| specs/dsh-collab/spec.md → 远端空间引用与读写转发 | 远端大日志分段读取 | packages/dsh-collab/test/remote-forward.test.ts | `远端大日志分段读取` | 🔴 red |
| specs/dsh-collab/spec.md → 远端空间引用与读写转发 | 两边同名空间互不混淆 | packages/dsh-collab/test/remote-forward.test.ts | `两边同名空间互不混淆` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机邀请按被邀请方的信任加入 | 被邀请方信任时自动加入 | packages/dsh-collab/test/remote-invite.test.ts | `被邀请方信任时自动加入` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机邀请按被邀请方的信任加入 | 同意后目标换代不加入 | packages/dsh-collab/test/remote-invite.test.ts | `同意后目标换代不加入` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机邀请按被邀请方的信任加入 | 目标不可达时重放邀请 | packages/dsh-collab/test/remote-invite.test.ts | `目标不可达时重放邀请` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机邀请按被邀请方的信任加入 | 被邀请方不信任或答复丢失 | packages/dsh-collab/test/remote-invite.test.ts | `被邀请方不信任或答复丢失` | 🔴 red |
| specs/dsh-collab/spec.md → 远端空间的发现索引 | 重启后仍能发现远端空间 | packages/dsh-collab/test/remote-index.test.ts | `重启后仍能发现远端空间` | 🔴 red |
| specs/dsh-collab/spec.md → 远端空间的发现索引 | 已移除的条目被清理 | packages/dsh-collab/test/remote-index.test.ts | `已移除的条目被清理` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机工具错误映射 | 不可达与确定拒绝 | packages/dsh-collab/test/remote-errors.test.ts | `不可达与确定拒绝` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机工具错误映射 | 超限请求在本地拒绝 | packages/dsh-collab/test/remote-errors.test.ts | `超限请求在本地拒绝` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机工具错误映射 | 超限 overview 回固定错误 | packages/dsh-collab/test/remote-errors.test.ts | `超限 overview 回固定错误` | 🔴 red |
| specs/dsh-collab/spec.md → 跨机投递失败只显示 | 失败可读、不重投 | packages/dsh-collab/test/remote-delivery.test.ts | `失败可读、不重投` | 🔴 red |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 未声明的 channel 不能接入 | packages/dsh-collab/test/config.test.ts | `未声明的 channel 不能接入` | 🟢 existing |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 非法配置拒绝启动 | packages/dsh-collab/test/config.test.ts | `非法配置拒绝启动` | 🔴 red |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 接入方离开后不可投递 | packages/dsh-collab/test/config.test.ts | `接入方离开后不可投递` | 🟢 existing |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 未声明托管 channel 时工具面与行为不变 | packages/dsh-collab/test/config.test.ts | `未声明托管 channel 时工具面与行为不变` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 被唤醒后一次调用即知下一步 | packages/dsh-collab/test/status.test.ts | `被唤醒后一次调用即知下一步` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 成员文本不进入输出 | packages/dsh-collab/test/status.test.ts | `成员文本不进入输出` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | request 待办带条目 seq | packages/dsh-collab/test/status.test.ts | `request 待办带条目 seq` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 用途只作为数据输出 | packages/dsh-collab/test/status.test.ts | `用途只作为数据输出` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 远端空间与不可达空间 | packages/dsh-collab/test/status.test.ts | `远端空间与不可达空间` | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口隐藏不合规标识 | 旧台账的不合规 itemId 被隐藏 | packages/dsh-collab/test/status.test.ts | `旧台账的不合规 itemId 被隐藏` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口隐藏不合规标识 | 不合规的 spaceId 不出现 | packages/dsh-collab/test/status.test.ts | `不合规的 spaceId 不出现` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口隐藏不合规标识 | 合规标识原样输出 | packages/dsh-collab/test/status.test.ts | `合规标识原样输出` | 🟢 existing |
| specs/dsh-collab/spec.md → 状态入口隐藏不合规标识 | 远端 runtime 段不合规 | packages/dsh-collab/test/status.test.ts | `远端 runtime 段不合规` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 按 relay-contract 接入、对账注册与降级 | 握手后对账注册 | packages/collab-cockpit-shim/test/reconcile.test.ts | `握手后对账注册` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 按 relay-contract 接入、对账注册与降级 | 服务缺失、未连接或处理器被占 | packages/collab-cockpit-shim/test/reconcile.test.ts | `服务缺失、未连接或处理器被占` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 按 relay-contract 接入、对账注册与降级 | 截断快照中消失不注销 | packages/collab-cockpit-shim/test/reconcile.test.ts | `截断快照中消失不注销` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 按 relay-contract 接入、对账注册与降级 | shim 卸载与版本变化 | packages/collab-cockpit-shim/test/reconcile.test.ts | `shim 卸载与版本变化` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 按 relay-contract 接入、对账注册与降级 | 离线、恢复、删除与 cockpit 重启 | packages/collab-cockpit-shim/test/reconcile.test.ts | `离线、恢复、删除与 cockpit 重启` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 信封编码与带类型的标识改写 | 只改写具名字段 | packages/collab-cockpit-shim/test/envelope.test.ts | `只改写具名字段` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 信封编码与带类型的标识改写 | 入站伪造 local | packages/collab-cockpit-shim/test/envelope.test.ts | `入站伪造 local` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → reply 关联、超时与体积 | 正确来源的 reply 被接受 | packages/collab-cockpit-shim/test/reply.test.ts | `正确来源的 reply 被接受` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → reply 关联、超时与体积 | 伪造来源、迟到与中继回执 | packages/collab-cockpit-shim/test/reply.test.ts | `伪造来源、迟到与中继回执` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → reply 关联、超时与体积 | wake 无回执时超时失败 | packages/collab-cockpit-shim/test/reply.test.ts | `wake 无回执时超时失败` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → reply 关联、超时与体积 | 超限请求不发送 | packages/collab-cockpit-shim/test/reply.test.ts | `超限请求不发送` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 入站执行与来源校验 | 每次入站都重新判定授权 | packages/collab-cockpit-shim/test/inbound.test.ts | `每次入站都重新判定授权` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 入站执行与来源校验 | 伪造来源 | packages/collab-cockpit-shim/test/inbound.test.ts | `伪造来源` | 🔴 red |
| specs/collab-cockpit-shim/spec.md → 入站执行与来源校验 | 窗口外重复写命令幂等 | packages/collab-cockpit-shim/test/inbound.test.ts | `窗口外重复写命令幂等` | 🔴 red |

## Coverage Notes

- 共 66 个场景，全部映射；其中 10 个为 MODIFIED requirement 沿用的既有场景。
- 跨机测试不依赖真实 cockpit：kernel 层用两个内核实例 + 内存测试传输（实现 `Connection`、可注入超时/换代/拒绝）；shim 层用 `cockpitRelay` 替身（可控 `state`/快照/`send` 记录/入站投递、`relay` 标记、`contractVersion`）；时间相关场景用可推进的测试时钟。
- 旧内核兼容夹具：打包提交 `743557e5928df2627b3372ddb105c5d74b20682f` 的 `packages/collab-kernel` 到 `packages/collab-kernel/test/fixtures/legacy-kernel/`，记录 sha256；本机行为快照夹具同样固定时钟、cmdId 与投递完成顺序。
- `非法配置拒绝启动` 是既有场景的扩展（新增 `runtime-session` 配置项），在 config.test.ts 中先加失败用例再实现，记为 🔴 red。
- 与 dsh-cockpit 的真实联调不在本 change 的测试门禁内；`dsh.yaml` 中 shim 条目默认禁用，联调通过后另行启用。
