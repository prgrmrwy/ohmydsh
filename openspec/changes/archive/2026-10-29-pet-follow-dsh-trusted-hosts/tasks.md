# Tasks

## 1. 实现

- [x] 1.1 `http.ts` 删除 `DSH_PET_TRUSTED_HOSTS` 解析与匹配，`authorizeBrowserRequest` 放行时记入 `WeakSet`，`isTrustedRequest` 对非回环 Host 只受理已记入的请求；403 `message` 指向 `--trusted-host`。`index.ts` 删除启动解析与日志，`api.ts` 更新注释。验证：`npx vitest run test/http.test.ts test/api-client.test.ts` 与 `npm run typecheck` 通过。
- [x] 1.2 测试覆盖 spec 四个场景（fence 放行同源 200、跨源 403 带 `ok:false`、fence 拒绝时不进 Pet、未包 fence 只认回环）。验证：同上。

## 2. 文档

- [x] 2.1 README "Serving Pet behind a domain" 改为只需 `--trusted-host`；`dsh.yaml` 备注同步（≤600 code point）。验证：根目录 `manifest-notes` 测试中 dsh-pet 不报超长。

## 3. 集成验证

- [x] 3.1 包内 build/typecheck/test，根目录 `npm test`，`node scripts/sync.mjs` 连跑两次第二次无变化。（2026-10-29：通过；另有 4 个既有失败与本 change 无关——pet `locus-lark-port` 2 个、根目录 magpie-connector note 超长与 README semver 2 个。）
- [x] 3.2 删除 `.env.local` 的 `DSH_PET_TRUSTED_HOSTS` 后重启：新 Host 环境不含该变量；经域名 Host、同源 Origin、有效 cookie 访问 `/dsh-pet/api/config` 返回 200。（2026-10-29 实测：新 Host PID 192879，环境只有 DSH_TRUSTED_HOSTS；同源 200 `ok:true`，跨源被 DSH fence 403。）

## Workflow follow-up

- 验收后合并 delta 到 `openspec/specs/dsh-pet/spec.md` 并归档；更新记忆卡 `dsh-public-domain-loopback-only-features`。
