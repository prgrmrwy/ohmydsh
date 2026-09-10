## 1. 配对协议与状态模型

- [x] 1.1 在 `wire.ts` 定义 Settings 可见的 pairing 判别联合类型，并扩展 `PetChannelView`；用 wire/route 类型检查确认只暴露非机密状态，成功、失败或过期后不含 code/command。
- [x] 1.2 新增 Host-only 配对控制器，使用 `randomBytes()` 和无歧义 32 字符字母表生成 `xxxx-xxxx`、40-bit、5 分钟有效的单次配对码；单测固定随机源覆盖格式、熵长度、到期、取消、重新生成和 Host stop 代际失效。
- [x] 1.3 为配对控制器实现 `starting → waiting → claiming → succeeded|failed` 原子状态迁移、generation fence 与 unref expiry timer；并发单测证明两个正确事件只能有一个完成 `waiting → claiming`。
- [x] 1.4 增加源代码/运行测试，断言配对码与完整 `/pair` 命令不会进入 Pet SQLite schema、日志、错误诊断、Task/Invocation 或 session 事件。

## 2. 单一 consumer 的运行原因协调

- [x] 2.1 将 `ChannelService` 的 imperative start/stop 改为 formal Channel 与 pairing 两种 run reason 的统一 reconcile；服务单测覆盖只启用正式 Channel、只启用配对、两者同时存在和两者都消失四种矩阵，始终最多 spawn 一个 consumer。
- [x] 2.2 发起配对前复用 lark-cli 版本和 `botIdentity(expectedAppId)` 验证，但不要求 allowlist/default workspace/config.enabled；测试未绑定、身份不匹配、CLI 过低均拒绝且不 spawn。
- [x] 2.3 让 pairing 从 consumer ready edge 才进入 `waiting` 并开始 5 分钟有效期；测试慢启动时页面不提前暴露命令，已连接的正式 Channel 则立即激活且使用独立配对水位。
- [x] 2.4 完成、取消、替换、过期、失败和 `ChannelService.stop()` 后按 run reason 回收；测试 pairing-only 使用 SIGTERM、正式 Channel 仍启用时不停止、共享 lark-cli bus daemon 从不被终止。

## 3. 配对消息前置分支与原子授权

- [x] 3.1 把订阅 line intake 重构为“解析一次 → 配对前置分支 → 既有 InboundPipeline”，保持普通 pipeline 行为不变；回归测试覆盖已启用 Channel 的现有 allowlist、mention、dedup、QA 与路由用例。
- [x] 3.2 实现严格候选判定：仅 `im.message.receive_v1`、user sender、p2p、text、合法 `ou_...`、不早于配对水位且 trim 后精确匹配；表驱动测试覆盖群聊、Bot、非文本、额外参数、大小写差异、错误/旧码与历史消息全部静默。
- [x] 3.3 在第一个正确事件同步认领后，经 `updateChannelConfig()` 去重追加 `allowOpenIds`；并发与重投测试证明只加入一个发送者，已存在成员的配对保持幂等且旧成员不丢失。
- [x] 3.4 尽力从触发消息解析显示名并仅写 `knownNames`，测试历史读取失败仍按 `open_id` 授权，名称变化或缺失不影响准入。
- [x] 3.5 保证配对路径不创建 Task、Invocation、chat binding、channel association、默认 workspace 路由或任务表情；仓储/协调器 spy 测试断言这些端口零调用。
- [x] 3.6 仅在持久化成功后通过 bot 身份回复固定成功文案；测试写入失败不回复成功且进入可重试失败态，回复失败则授权保留并只记录低基数诊断。

## 4. 管理路由与 Settings 交互

- [x] 4.1 扩展 `ChannelControl` 与严格 `channelMutate` body allowlist，新增无 caller-supplied code/id/expiry 的 `pair-start`、`pair-cancel` 动作；route-validation 测试覆盖多余字段、伪造 sender/code、未确认 Bot 和替换现有配对。
- [x] 4.2 将 Host pairing 投影合入每次 `channelView`，终端状态不回显旧 secret；route 测试覆盖 starting/waiting/claiming/succeeded/failed 形状和重启后的 absence。
- [x] 4.3 在“允许触发的成员”面板实现生成、完整命令、5 分钟倒计时、复制、取消、重新生成、认领中、成功与失败 UI，并把手工 `open_id` 输入收进次级兜底；JSDOM 测试覆盖可访问标签、按钮门禁、clipboard 拒绝与状态渲染。
- [x] 4.4 对非终态使用有界可取消刷新，重新挂载总是读取 Host truth；假时钟测试覆盖 ready edge 早于首次轮询、快速成功、过期、取消、组件卸载后无残留 timer/request。
- [x] 4.5 更新 onboarding 文案与完成判定，使配对成功只完成 allowlist 步骤、不自动选择 workspace 或启用 Channel；客户端测试覆盖首位成员和后续成员两种流程。

## 5. 安全与回归验证

- [x] 5.1 增加恶意与边界用例：暴力错误码不改变状态也不回复、正确码在群内无效、两个并发发送者只有一个成功、重新生成旧码立即无效、Host 重启清空未完成配对；运行 `cd packages/dsh-pet && npm test` 全量通过。
- [x] 5.2 运行 `cd packages/dsh-pet && npm run typecheck && npm run build`，确认 Host/Client 类型与 bundle 构建通过且无新依赖或持久化 schema migration。
- [x] 5.3 运行仓库级 `npm test`、`npm run check:artifacts` 与 `npx --yes @fission-ai/openspec@latest validate pair-pet-allowlist-member --strict`，记录全部通过结果。
- [x] 5.4 执行 `dsh build` 两次，确认首次物化新 Pet 产物、第二次报告 no changes；核对 `$DSH_HOME/plugins/dsh-pet/` 中无 pairing code 持久化痕迹。

## 6. 真机验收与收尾

- [x] 6.1 重启 DSH，在 Channel 关闭、allowlist 为空、default workspace 未设置的真实环境生成配对码；确认唯一 consumer 到达 ready 后页面才显示 `/pair xxxx-xxxx`。
- [x] 6.2 用真实飞书账号单聊发送正确命令，确认固定成功回执、Settings 出现姓名/open_id、allowlist 持久化，并核对无 Task、Invocation、chat binding、channel association 或任务表情产生。
- [ ] 6.3 真机演练错误码、群聊正确码、过期、取消、重新生成与 pairing-only consumer 回收；确认未授权路径全部静默且进程以 SIGTERM 清理。
- [x] 6.4 更新 `packages/dsh-pet/README.md`、`dsh.yaml` Pet 审查 note 和相关集成陷阱说明（若实现发现新陷阱），并用文档审查确认“bearer code 首个发送者获权”和回滚语义写清。
- [x] 6.5 修复真机暴露的 Cordis 异步 `inject()` 组合竞态并退役空的失败 executor 壳；异步组合路径测试、全量测试与重发消息真机验收均通过。
