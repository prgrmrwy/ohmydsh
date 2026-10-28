## 1. 实现

- [x] 1.1 启动器 `trustedHostArgs(env)` 把 `DSH_TRUSTED_HOSTS` 映射为 `--trusted-host`，在 restart 停机前校验
- [x] 1.2 单测覆盖未设置、分隔符、IPv6 与非法值
- [x] 1.3 `.env.local.example` 记录变量；两条插件备注改为通用说明

## 2. 验证

- [x] 2.1 `npm test` 全绿
- [x] 2.2 `dsh build` 连续两次，第二次无变化
- [x] 2.3 `dsh restart` 后确认进程 argv 含 `.env.local` 声明的 `--trusted-host`(2026-10-28)
