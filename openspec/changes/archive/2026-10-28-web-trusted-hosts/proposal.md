## Why

把本机 DSH Web 放到一个带独立认证层（如反向代理 + SSO/OTP）的域名后面访问时，官方 `/api` Host/Origin fence 只信任回环与显式 `--trusted-host`。启动器虽可透传该参数，但每次手动传易遗漏，`dsh restart` 后入口会静默 403。

该域名是单台机器的部署事实，本仓库公开，不能写进 `dsh.yaml`；私有 overlay 又禁止覆盖 `web` 段。因此由本机 gitignored 的 `.env.local` 声明。

## What Changes

- 启动器读取 `DSH_TRUSTED_HOSTS`（通常来自 `.env.local`，逗号或空白分隔 bare host[:port]），在前台/后台官方 `dsh web` 启动路径上逐项追加 `--trusted-host`；未设置时不追加，保持纯回环 fence。
- 启动器校验形状，写错时报错退出，不忽略也不放宽；restart 在停机前完成校验，避免停掉健康 Host 后起不来。规范形式仍由官方 connection 在加载时严格判定。
- `.env.local.example` 记录该变量及其放宽面；dsh-system-clock、home-network-model-guard 的备注改为说明本机变量会一并放宽其通道。

## Impact

- `scripts/launcher/args.mjs`、`scripts/launcher/main.mjs`、`tests/launcher-args.test.mjs`、`.env.local.example`、`dsh.yaml`（仅两条备注）。
- 放宽面：所有 Connection RPC channel 都可经所列域名访问，前面必须另有认证层；具体域名与基础设施记录在本机私有配置与私有运维仓库，不入本仓库。
