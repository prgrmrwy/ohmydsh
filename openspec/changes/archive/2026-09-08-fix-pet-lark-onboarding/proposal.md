## Why

Pet 的飞书 Bot “绑定成功”目前并不意味着可以接收消息：绑定后 channel 仍默认关闭，allowlist 为空又禁止启用，UI 只接受用户事先知道的 `ou_...`；与此同时首次 @ 的 bot 身份识别只有 consumer 启动后才发生，并依赖尚未提示的群成员读取权限。结果是用户按页面完成绑定后在群里 @ Bot，消息根本没有进入 Pet，界面和 Host 日志也没有解释。

当前 lark-cli 还已演进：`config init` 的命名 profile 参数从 `--profile` 变为 `--name`，且 `auth status --verify` 已能直接返回可信 bot `openId/appName`。Pet 仍按旧 CLI 行为假定存在名为 `dsh-pet` 的 profile，并把首次群消息当成唯一身份发现路径，形成兼容性与可诊断性缺口。

## What Changes

- 绑定流程使用当前 lark-cli 的 `--name dsh-pet` 语义创建/更新专属 profile，并让订阅及所有 Pet channel 命令显式选择该 profile，避免污染或误用用户默认 profile。
- 绑定成功后立即通过 `auth status --json --verify` 读取并持久化可信的 bot `openId/appName`；仅支持具备该身份契约的 lark-cli，并在版本过低或输出不兼容时明确要求升级，不再依赖不可达的首次群成员回填。
- Channel 设置页把“绑定 → 身份 → allowlist → 默认 workspace → 启用/连接”呈现为可判定步骤；缺少任一前置时，在启用前给出具体诊断而不是让用户面对无反应。
- 修复连接状态投影竞态：启用 mutation 返回 `starting` 后，页面持续读取 Host 的过渡状态并最终收敛到 `connected/down`，不因错过快速 ready edge 永久显示“启动中”。
- 允许用户用当前群 owner 的已确认 `open_id` 完成 allowlist；不降低 allowlist、mention、watermark、dedup 或 bot 身份证明边界。
- 为静默拒绝增加只含分类、不含消息正文或敏感标识的 Host 诊断，使 `disabled`、`not-allowed-sender`、`no-mention`、`too-old` 等故障可排查，同时继续不在飞书侧回复未通过准入的消息。
- 增加新版 CLI argv/版本、绑定后身份探测、并发取消与重连代际、多 profile 隔离、secret 脱敏及首次群 @ 的回归测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-lark-channel`: 明确 Bot 绑定后的身份发现、专属 profile、onboarding 前置检查及安全诊断行为。

## Impact

- `packages/dsh-pet/src/host/channel/bootstrap.ts`：新版 lark-cli profile 参数与绑定后身份探测。
- `packages/dsh-pet/src/host/channel/lark.ts`、`subscription.ts`、`service.ts`：所有 channel 子进程显式 profile、权限/状态诊断与拒绝分类日志。
- `packages/dsh-pet/src/client/settings.tsx` 与 wire/routes：设置页 onboarding 状态与操作提示。
- `packages/dsh-pet/test/channel-*.test.ts`、`client.test.ts`：回归覆盖。
- `dsh.yaml`：补充本次集成审查记录；不新增凭据存储，不改变 Pet SQLite schema 的秘密边界。