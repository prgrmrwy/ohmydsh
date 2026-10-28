## ADDED Requirements

### Requirement: 本机 DSH_TRUSTED_HOSTS 声明额外 Host fence 授权

启动器可(MAY)从环境变量 `DSH_TRUSTED_HOSTS`（含 `.env.local` 注入）读取额外信任的 Web authority，以逗号或空白分隔。启动器必须(SHALL)在前台与后台官方 `dsh web` 启动路径(含 `dsh restart`)上，按声明顺序为每项追加一组 `--trusted-host <值>`，位于启动器强制的 `--no-open` 之后、用户命令行透传参数之前；变量未设置或为空白时不得(SHALL NOT)追加任何 `--trusted-host`。每项必须是 bare `host[:port]`（主机名、IPv4 或带方括号的 IPv6），否则启动器必须报错并非零退出，且必须在 `dsh restart` 停止现有 Host 之前完成该校验。公开 `dsh.yaml` 不得(SHALL NOT)承载具体部署域名。

#### Scenario: 未设置保持纯回环 fence
- **GIVEN** 环境与 `.env.local` 均未设置 `DSH_TRUSTED_HOSTS`
- **WHEN** 启动器冷启动 `dsh web`
- **THEN** 官方 argv 不含 `--trusted-host`

#### Scenario: 声明的条目逐项传入
- **GIVEN** `.env.local` 含 `DSH_TRUSTED_HOSTS=a.example.com,b.example.com:8443`
- **WHEN** 启动器冷启动或 restart
- **THEN** 官方 argv 含 `--trusted-host a.example.com --trusted-host b.example.com:8443`

#### Scenario: 写错时 restart 不停机
- **GIVEN** `DSH_TRUSTED_HOSTS` 含 `https://a.example.com`，且健康 Host 正在运行
- **WHEN** 运行 `dsh restart`
- **THEN** 启动器报 `DSH_TRUSTED_HOSTS` 错误并非零退出，现有 Host 未被停止
