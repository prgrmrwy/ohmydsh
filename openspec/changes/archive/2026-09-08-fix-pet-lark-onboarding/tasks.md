## 1. 固定失败与外部契约

- [x] 1.1 为当前 lark-cli 创建/连接命令写 argv 回归：命名 profile 使用 `--name dsh-pet`，不得再把 `--profile dsh-pet` 误传给 `config init`。
- [x] 1.2 为订阅、身份查询、成员列表、历史、表情和回复写 profile 隔离回归：所有 Pet channel 命令显式选择 `dsh-pet`，默认 profile 切换不影响 argv。
- [x] 1.3 用当前 `auth status --json --verify` 的真实脱敏结构写 parser 测试，覆盖顶层 `identities.bot.openId/appName`、App ID 不一致、token 未 ready、无 openId 与非 JSON。
- [x] 1.4 为 CLI/目标群权限错误写真实 stderr 前缀测试：缺 scope 时保持 fail closed，并只产出安全化权限诊断。
- [x] 1.5 为 onboarding readiness 写测试：未绑定、bot identity 未确认、allowlist 为空、默认 workspace 不可用、全部满足五种状态。
- [x] 1.6 为 ignored outcome 写隐私测试：固定原因分类可见，但日志/诊断不含正文、chat/message/sender 完整 ID、token 或原始 payload。
- [x] 1.7 为连接状态收敛写客户端回归：mutation 返回 `starting` 后即使 ready generation 已在等待前发布，页面也会重新读取并显示 `connected`；`reconnecting` 最终收敛到 `connected/down`，终态和卸载停止刷新。

## 2. lark-cli profile 与 Bot 身份

- [x] 2.1 在 channel 层集中定义 Pet profile 选择与 argv builder，避免 bootstrap、subscription 与 API client 各自漂移。
- [x] 2.2 更新 BotBootstrap：`config init` 使用 `--name dsh-pet`；secret 仍只经 stdin，现有无秘密持久化测试保持通过。
- [x] 2.3 实现 bot identity probe：专属 profile 下执行 `auth status --json --verify`，解析顶层结果并验证 App ID/openId/token 状态。
- [x] 2.4 绑定终态改为身份 probe 成功后原子写 `botAppId/botOpenId/botName`；失败保留可重试诊断，不写半配置。
- [x] 2.5 为已存在的 App-ID 命名 profile 提供安全迁移/重连诊断：不得在启动时自动 rename、切换或覆盖用户 profile。

## 3. Channel readiness 与 UI onboarding

- [x] 3.1 扩展 Host channel view，返回稳定的 onboarding step 状态和 blocker code/message；不返回 secret 或原始 CLI 输出。
- [x] 3.2 `set-enabled(true)` 在 Host 重新验证 bot 绑定、bot openId、allowlist、默认 workspace 与身份状态，不满足时返回具体错误。
- [x] 3.3 设置页按顺序展示“Bot → 身份 → 允许成员 → 默认 workspace → 启用/连接”，绑定成功但不可用时突出下一步，而非只显示 Bot 已绑定。
- [x] 3.4 允许清单输入继续只接受已确认 `ou_...`；增加说明如何从群 owner/管理员或组织查询取得，不自动信任观察到的 sender。
- [x] 3.5 对缺少 bot scope 的诊断展示缺失 scope 与官方 `open.feishu.cn` 申请链接；拒绝展示非官方域名 URL。
- [x] 3.6 ChannelTab 在 `starting/reconnecting` 期间有界刷新 `/channel`，到 `connected/down/stopped` 或卸载时停止，确保 UI 不因错过 ready edge 永久显示“启动中”。

## 4. 版本、生命周期与安全诊断

- [x] 4.1 识别 lark-cli 版本并要求至少已验证的 `1.0.93`；版本过低、不可识别或身份输出缺 openId 时提示升级并 fail closed。
- [x] 4.2 为 subscription、enable probe 与 bootstrap 增加操作代际/single-flight，阻止迟到 exit、timer、probe 或取消后的绑定提交。
- [x] 4.3 ChannelService 对 ignored outcome 输出节流的低基数分类日志/Diagnostics，飞书侧仍不添加表情或回复。
- [x] 4.4 权限错误仅抽取 error code、missing scopes 与受信官方 console URL；未知错误降级为通用分类，不保存原始响应。
- [x] 4.5 配置更新串行化；启动/重连重验完整 readiness，已启用时不得清空 allowlist/workspace，重绑必须替换 consumer。
- [x] 4.6 绑定失败诊断按 stdin secret 脱敏，并覆盖 secret 位于最后错误行、并发替换与 cancel 后迟到成功。

## 5. 验证、部署与实机验收

- [x] 5.1 运行 `packages/dsh-pet` 的完整 test、typecheck 与 build；确认新旧 channel、QA 群与 Pet executor 测试全绿。
- [x] 5.2 运行仓库 `npm test`、`npm run check:artifacts` 与 `openspec validate "fix-pet-lark-onboarding" --strict`。
- [x] 5.3 更新 `dsh.yaml` 的 dsh-pet note，记录新版 lark-cli profile/身份契约、onboarding 顺序与安全诊断边界。
- [x] 5.4 连续运行两次 `node scripts/sync.mjs`，首次成功物化、第二次输出 `no changes`。
- [x] 5.5 重启 DSH 后实机验收：设置页可判定展示 blocker；配置群主 `ou_2d041181c79cbeb34dd43b08f8201783`、所需 scope 与默认 workspace 后启用到 connected；群内首次 @ 产生状态反馈并创建/复用 Task；切换默认 lark-cli profile 后仍使用 Pet bot。
- [x] 5.6 将 delta spec 同步到 `openspec/specs/pet-lark-channel/spec.md`，严格校验后归档 change。