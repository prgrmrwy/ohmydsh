# launcher-host-lifecycle Specification

## Purpose

定义启动器按显式 profile 托管已有非 web Host 的行为，保证不同 profile 的进程身份、端口归属与部署维护彼此隔离，并保留默认 web profile 的标准启动、版本检测和现行停机流程。

## Requirements

### Requirement: 受管 Host 按 DSH_PROFILE 选择 profile

启动器的受管启动路径 SHALL 使用 `DSH_PROFILE` 选择 Host profile，缺省为 `web`，Host 参数 SHALL 为 `<profile> … --port <port> --no-open …`。`DSH_PROFILE` 不是合法 profile 名（须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`）时 SHALL 在任何副作用前非零拒绝。非 web profile SHALL 要求显式 `-p/--port`（`DSH_PORT` 不算显式），且启动前 `$DSH_HOME/profiles/<profile>/cordis.yml` SHALL 已存在，否则在任何探测、脚本或进程创建前非零拒绝。官方 `--profile` 透传语义不变。

#### Scenario: 非 web profile 受管启动
- **GIVEN** `DSH_PROFILE=superagent`，已存在的 superagent profile 目录，空闲端口
- **WHEN** 执行 `dsh -p <port> --no-open`
- **THEN** Host 参数首项为 `superagent`，不含 `--patch`，Host 环境中 `DSH_PROFILE=superagent`，启动成功并在启动记录写入 `profile=superagent`

#### Scenario: 非 web profile 缺显式端口或 profile 目录
- **GIVEN** `DSH_PROFILE=superagent`
- **WHEN** 未传 `-p/--port`（即使设置了 `DSH_PORT`），或 profile 目录缺少 `cordis.yml`
- **THEN** 启动器非零退出并说明原因，不运行脚本、不探测端口、不创建进程

### Requirement: Host 归属按 profile 精确判定

端口归属判定 SHALL 要求监听进程的 argv 第三项与所选 profile 完全相等，并保留既有 Node 可执行文件、`@deepseek-ai/dsh` 入口包身份和唯一 `--port` 匹配要求。web 探测 SHALL NOT 认领非 web 监听者，非 web 探测 SHALL NOT 认领 web 监听者；不匹配的监听者 SHALL 归为 `unknown`，启动、停止与重启都 SHALL 拒绝对其操作。非法 profile 名 SHALL 归为 `probe-error`，且不运行任何平台命令。

#### Scenario: 跨 profile 不互相认领
- **GIVEN** 端口上运行着 superagent profile 的受管 Host
- **WHEN** 以默认 web profile 执行 `dsh stop -p <port>`
- **THEN** 启动器非零退出，Host 进程未收到信号且身份不变

### Requirement: 非 web profile 只托管启动且不跨 profile 部署

非 web profile 的受管 Host SHALL NOT 加载 no-pet-stop patch，因而不发布停机 descriptor。`DSH_PROFILE` 为非 web 时，`stop` 与 `restart` SHALL 在任何探测或信号前非零拒绝，并提示由该 Host 的管理脚本启停或显式使用 `--allow-legacy-restart` 做人工维护。显式维护 SHALL 沿用既有归属校验，并跳过新 Host 的停机协议确认。`build`、`-b`/`--build`、`reset`、`plugin-update`、`doctor` SHALL 拒绝；启动路径 SHALL 跳过 `autoUpdate`。隔离预览环境 SHALL 拒绝非 web profile。`history` SHALL 保持只读可用。

#### Scenario: 非 web stop/restart 无鉴权协议时拒绝
- **GIVEN** superagent Host 正在运行，未传 `--allow-legacy-restart`
- **WHEN** `DSH_PROFILE=superagent dsh stop -p <port>` 或 `restart`
- **THEN** 非零退出，Host 存活且 PID 不变

#### Scenario: 维护命令不写入非 web profile
- **GIVEN** `DSH_PROFILE=superagent`
- **WHEN** 执行 build、`-b`、reset、plugin-update 或 doctor，或冷启动 Host
- **THEN** 维护命令在副作用前拒绝；冷启动不运行 check-update 或 sync

### Requirement: web 受管行为不变

未设置 `DSH_PROFILE` 或其值为 `web` 时，profile 选择 SHALL 沿用标准 web 受管流程，只在启动记录增加 `profile=web` 字段；本能力 MUST NOT 把历史停机行为固化为回滚要求。web Host 的完整进程归属已核验、但没有停机 descriptor 时，launcher SHALL 告警后跳过 Pet 排空并继续原生停机，MUST NOT 将该次视为排空成功；descriptor 存在但无效、鉴权或排空握手失败时仍 SHALL 拒绝停机。非 web profile 仍先适用本能力的前置维护限制，MUST NOT 因缺 descriptor 而绕过该限制。

#### Scenario: web 启动回归
- **GIVEN** `DSH_PROFILE=web`，空闲端口
- **WHEN** 执行 `dsh -p <port> --no-open`
- **THEN** Host 参数为 `web --patch <no-pet-stop overlay> --port <port> …`，执行了版本检测，启动记录含 `profile=web`

#### Scenario: web Host 缺停机凭据时告警后继续
- **GIVEN** web Host 的完整进程归属已核验，且没有停机 descriptor
- **WHEN** launcher 准备停止该 Host
- **THEN** 明确告警并跳过 Pet 排空，继续按原生进程身份保护停机；不声称已完成排空

#### Scenario: 无效停机凭据仍拒绝
- **GIVEN** web Host 已有 descriptor，但其内容无效、鉴权失败或排空握手失败
- **WHEN** launcher 准备停止该 Host
- **THEN** 拒绝停机，不把无效凭据当作缺失凭据放行
