# Proposal

## Why

经外部认证层用域名访问 DSH（启动器已用 `DSH_TRUSTED_HOSTS` 让官方 Host fence 放行该域名）时，Pet 的全部管理接口返回 403，Pet 显示"未就绪"。原因是 Pet 在官方 fence 之后还有一道自有检查，只认回环 `Host`，部署方没有任何办法为 Pet 单独声明信任。另外这条 403 的响应体缺少 `ok` 字段，客户端只能报"缺少 ok 标记"，看不出被拒的真实原因。

## What Changes

- Pet Host 新增本机私有环境变量 `DSH_PET_TRUSTED_HOSTS`（逗号或空白分隔的 bare `host[:port]`），在 Host 启动时读取。列入的 authority 与回环同等通过 Pet 的来源检查，但仍须同源（`Origin` 存在时必须与 `Host` 一致），且仍先经过官方 Connection fence 与浏览器会话认证。
- 该变量与官方 `DSH_TRUSTED_HOSTS` 相互独立：只配置后者时 Pet 行为不变，仍只认回环。放宽 Pet 必须单独显式声明。
- 变量未设置、为空或含非法项时，Pet 只认回环（fail closed）；非法项会写入 Host 日志。
- Pet 来源检查的 403 响应改为标准错误信封（`ok: false` + `error` + `message`），客户端据此显示被拒原因，不再报"缺少 ok 标记"。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-pet`：新增"管理接口来源边界"要求。现状是代码里只认回环、spec 未写明，本 change 把它写进 spec，并加入 `DSH_PET_TRUSTED_HOSTS` 这一显式放宽，以及标准错误信封。

## Impact

- 代码：`packages/dsh-pet/src/host/http.ts`（来源检查与 403 信封）、Pet Host 启动处读取环境变量并把允许列表交给路由、`packages/dsh-pet/src/client/api.ts` 注释，以及对应测试。
- 文档：`packages/dsh-pet/README.md` 说明该变量和它的安全含义；`dsh.yaml` 中 dsh-pet 备注提一句。具体域名只写在 gitignored 的 `.env.local`，不进公开仓库。
- 部署：需要的机器在 `.env.local` 加一行 `DSH_PET_TRUSTED_HOSTS`，然后执行 `dsh build` 和 `dsh restart`。未配置的机器行为不变。
- 不涉及：DSH core、官方 Connection fence、设置页保存限制（core 按页面是否回环决定，另行处理）。
