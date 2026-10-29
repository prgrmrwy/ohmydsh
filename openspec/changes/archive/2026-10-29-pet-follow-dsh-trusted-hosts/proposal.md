# Proposal

## Why

`pet-trusted-host-access` 让 Pet 另读 `DSH_PET_TRUSTED_HOSTS`，与官方 `--trusted-host`（ohmydsh 里的 `DSH_TRUSTED_HOSTS`）分开声明。实际用下来是两份同值配置：经 `--trusted-host` 放行的域名本来就能开会话、让 agent 执行 shell，权限比 Pet 管理面大，单独给 Pet 加一道闸挡不住更大的入口，只多一处会写错、会漏配的地方。settings-system-clock 的先例只约束那一个 channel，不该外推到 Pet。

## What Changes

- **BREAKING（仅本仓库刚引入、未提交过的配置）**：移除 `DSH_PET_TRUSTED_HOSTS`。Pet 不再维护自己的 host 列表。
- Pet 的来源检查改为：`Host` 是回环，或本次请求刚被官方 Connection fence 放行（即 Host 在 `--trusted-host` 内且通过 cookie 认证）；`Origin` 存在时仍须同源，非回环 Host 要求完全一致（含端口）。
- 未经官方 fence 的路由对非回环 Host 仍一律拒绝，漏包 fence 不会放宽 Pet。
- 403 信封保留，`message` 改为指向 `--trusted-host`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-pet`：移除「只受理回环或显式声明的同源来源」要求，新增「只受理回环或 DSH 已信任的同源来源」，并更新错误信封要求里的提示文案。

## Impact

- 代码：`packages/dsh-pet/src/host/http.ts`（删除允许列表解析，改用 fence 放行标记）、`src/index.ts`（删除启动时解析与日志）、`src/client/api.ts` 注释、对应测试。
- 文档：`packages/dsh-pet/README.md` 的 "Serving Pet behind a domain"，`dsh.yaml` dsh-pet 备注。
- 部署：本机 `.env.local` 删掉 `DSH_PET_TRUSTED_HOSTS` 一行，`dsh build` 后重启。只配 `DSH_TRUSTED_HOSTS` 即可。
