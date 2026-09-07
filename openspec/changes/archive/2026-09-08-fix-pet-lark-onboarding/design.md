## Context

见 `proposal.md`。当前实测环境中，绑定后的 SQLite 配置为 `enabled:false`、`allowOpenIds:[]`，事件 bus 为 `not_running`；因此群内 @ 从未进入 pipeline。代码又在 allowlist 为空时拒绝启用，而 UI 只接受事先知道的 `ou_...`，形成 onboarding 死结。

当前 lark-cli 带来两项已实测的契约变化：

- `config init` 的命名 profile 参数是 `--name`，`--profile` 是选择一个**已存在** profile 的全局参数。现有 Pet 调用 `config init ... --profile dsh-pet` 没有创建该名称；实际仅存在以 App ID 命名的 active profile。
- `auth status --json --verify` 的成功结果位于响应顶层，包含 `identities.bot.{status,openId,appName}`、`appId`/有效身份信息，可在绑定后直接证明 bot 身份。不可按统一 `{ok,data}` 信封读取。

探索阶段曾尝试以首次群成员列表回填身份，但实测需要额外 `im:chat.members:read` scope，且与“身份未确认前不得启动 consumer”形成不可达循环。最终设计改为只支持能由 `auth status --json --verify` 直接证明 open_id 的 CLI，并对其它目标群权限错误保留安全诊断。

## Goals / Non-Goals

**Goals:**

- 让“绑定完成”和“channel 可用”成为两个清晰、可判定的状态。
- 适配当前 lark-cli 的 profile 与身份输出契约，并保持多 profile 隔离。
- 绑定后必须直接证明 bot open_id；版本过低或身份输出不兼容时明确要求升级。
- 在不向飞书侧响应未授权消息的前提下，提供不泄露消息/身份内容的安全诊断。
- 保留 allowlist、mention、watermark、dedup、route 与 Task 边界。

**Non-Goals:**

- 不自动申请/授予飞书权限，不自动发布应用版本。
- 不自动把任何观察到的 sender 加入 allowlist。
- 不新增 user 身份或 contact scope；Pet channel 继续只用 bot 身份。
- 不改变群消息的文字回复策略、Task 形态或 QA 群信任模型。
- 不将原始入站事件或消息正文持久化为诊断证据。

## Decisions

### D1：专属 profile 由 `--name dsh-pet` 创建，所有后续命令用 `--profile dsh-pet` 选择

Bootstrap 创建和连接命令分别使用：

- `lark-cli config init --new --name dsh-pet`
- `lark-cli config init --app-id ... --app-secret-stdin --name dsh-pet`

订阅、`whoami/auth status`、成员列表、历史、表情、回复等 Pet channel 命令统一显式加入全局 profile 选择。实现提供一个集中 argv builder，避免只有部分命令带 profile。

**替代方案：继续依赖 active/default profile。** 拒绝；用户新增或切换 profile 会让 Pet 静默串到另一个 app，违反已有专属 profile 规范。

**兼容处理：** 若检测到数据库已有绑定 App ID，但 `dsh-pet` profile 不存在，管理面显示迁移诊断。只有在能够证明当前有效 profile 的 App ID 与绑定 App ID 一致时，才可通过 lark-cli 的 profile rename/add 能力显式迁移；不得盲目切换或覆盖默认 profile。实现阶段优先提供可诊断的重连流程，不把破坏性 profile 变更藏在启动时。

### D2：绑定终态后执行一次 bot identity probe，再原子写 Pet 配置

Bootstrap 的“CLI 进程退出 0 且读到 App ID”不再立即等价于完整绑定。Host 随后对新建的专属 profile运行 `auth status --json --verify`，解析顶层身份结构，并验证：

1. bot token ready / verified；
2. 返回 App ID 与 bootstrap App ID 一致；
3. `openId` 是合法 `ou_...`；
4. 名称仅作为展示字段。

验证成功后一次性写 `botAppId/botOpenId/botName`。失败则保留 bootstrap diagnostic，不写半配置。parser 以独立纯函数和真实输出 fixture 测试，防止再把顶层结果误当 `data`。

**替代方案：继续等待首次群 @。** 拒绝；启用前要求已确认 open_id，而群回填又要求先启动 consumer，两者形成不可达循环。Pet 只支持能由 `auth status --json --verify` 直接证明 bot open_id 的 lark-cli；版本低于已验证基线 `1.0.93` 或输出不兼容时明确提示升级。

### D3：启用 readiness 由 Host 计算，UI 只渲染并执行显式操作

新增 channel readiness view，至少包含：bound identity、bot identity confirmed、allowlist non-empty、default workspace resolvable、subscription phase，以及阻断项的稳定 code/message。`set-enabled(true)` 仍在 Host 重新验证全部条件，不能信任 UI。

绑定后的身份 probe 提前发现版本、token、profile 与身份问题。其它目标群操作若返回结构化权限错误，Host 只抽取安全化的 `missing_scopes` 与 `console_url` 写入 channel 非秘密诊断，并触发 change feed；不把 diagnostics 当授权，也不因为诊断缺失而放宽准入。

### D4：ignored outcome 进入低基数安全诊断，不记录 payload

`ChannelService.onOutcome` 不再无条件丢弃 ignored outcome，而是将 reason 映射为固定分类并记计数/最后发生时间；日志只写：

```text
dsh-pet channel: inbound ignored: not-allowed-sender
```

不得附 chat_id、message_id、sender open_id、mention、正文或原始错误对象。对身份识别 API 的结构化权限错误，仅抽取允许展示的 error code、`missing_scopes` 和官方 `console_url`；未知错误只保留通用分类。

**替代方案：记录完整事件便于调试。** 拒绝；与“未授权消息不进入可信处理面”和仓库不保存 raw evidence 的原则冲突。

### D5：异步生命周期以代际和最新配置隔离

subscription 的每个 child、重试 timer 与 enable identity probe 都绑定操作代际；stop、disable、reconnect 或新绑定会使旧代际失效。迟到的 exit/probe 不得清除新 child、启动新 consumer 或覆盖最新配置。配置 read-modify-write 串行化，失败回滚只修改 `enabled`，不覆盖并发 allowlist/workspace 更新；已启用时不得清空 readiness 前置。

绑定 bootstrap 同样是 single-flight：新尝试显式终止旧 child，cancel 后的迟到回调不得提交配置；自由文本错误若包含 stdin secret 只降级为通用诊断。

### D6：Channel 页对过渡态做有界追踪，不依赖一次 change-feed edge

`set-enabled(true)` 必须快速返回，不能为了等 WebSocket ready 阻塞 HTTP；其返回值因此合法地是 `starting`。Host 随后的 stderr ready marker 已正确切到 `connected`，问题是设置页只在 `awaiting-authorization` 轮询，且不消费 Pet change feed，错过 ready edge 后就永远保留旧快照。

ChannelTab 在 view 为 `starting` 或 `reconnecting` 时启动一个可取消的短间隔 refresh（与授权轮询同一模式），每次直接读取 `/channel` 当前状态；进入 `connected/down/stopped` 或组件卸载立即停止。mutation 完成后如果返回过渡态，该 effect 当场生效，因此不依赖“先订阅再 publish”的无竞态时序。

**替代方案：让 `set-enabled` 等待 ready。** 拒绝；连接可能失败、退避或长期挂起，HTTP mutation 不应承载长生命周期状态机。

**替代方案：只接 change feed。** change feed 是 edge-triggered generation；客户端在 mutation 返回后才开始等待时可能已经错过该代变化。轮询只存在于短暂过渡态，成本有界且语义可靠。后续若提供带 cursor 的长轮询，可替换实现而不改变规范。

## Risks / Trade-offs

- **[旧安装只有 App-ID profile，升级后找不到 `dsh-pet`]** → 不自动重命名/覆盖；验证 App ID 后提供重连/迁移诊断，保持 fail closed。
- **[不同 lark-cli 版本身份 JSON 形状不同]** → 启动/绑定识别 CLI 版本并要求至少 `1.0.93`；parser 只接受已确认的顶层身份形状，不识别时明确要求升级，不猜 open_id。
- **[ignored 日志被高流量刷屏]** → 按 reason 节流/聚合，保持低基数，不逐条输出外部标识。
- **[权限 console URL 可能含 App ID]** → App ID 已是设置页公开的非秘密标识；只接受 `https://open.feishu.cn/` 域名，其他 URL 不展示。
- **[绑定成功后 identity probe 短暂网络失败]** → 保持“Bot 凭据已写入 lark-cli、Pet 尚未绑定”的可恢复状态，提供显式重试，不写半配置。

## Migration Plan

1. 添加纯 parser/argv/readiness/diagnostic tests，再修改实现。
2. 对当前环境执行 profile 检查：已绑定 App ID 为 `cli_aa14740a43f81cd4`，现有 profile 同名且 active，但 `dsh-pet` 不存在；升级后通过设置页显式重连为命名 profile，不自动破坏现有 profile。
3. `npm test`、typecheck/build、仓库测试、artifact check、OpenSpec strict validation。
4. `node scripts/sync.mjs` 连续两次验证物化幂等，重启 DSH。
5. 实机验收：设置页显示阻断步骤；完成权限与 allowlist 后启用到 connected；首次群 @ 正常识别并产生状态反馈/Task；切换默认 lark-cli profile 后仍使用 Pet bot。
6. 回滚只涉及代码与规范；Pet SQLite 的新增诊断字段均为 optional，旧记录继续可读。