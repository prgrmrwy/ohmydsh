# Tasks

## 1. 来源检查与允许列表

- [x] 1.1 在 `packages/dsh-pet/src/host/http.ts` 增加 `DSH_PET_TRUSTED_HOSTS` 解析：可注入 env，首次调用后缓存；任一非法项则整体失效并返回原因。在 `test/http.test.ts` 覆盖分隔符、大小写、IPv6、带端口与不带端口，以及非法项让整个变量失效。验证：`npm test -- http` 通过。
- [x] 1.2 扩展 `isTrustedRequest`：回环规则保持不变；命中允许列表的 `Host` 要求 `Origin` 缺失或 host 完全一致。测试覆盖 spec 中"未声明时只认回环""声明后同源受理""声明后跨源仍拒绝""带端口的声明只匹配该端口"四个场景。验证：`npm test -- http` 通过。
- [x] 1.3 `petRoute` 的 403 响应体加上 `ok: false`，`message` 说明允许的来源；测试断言信封形状，并断言客户端 `call()` 抛出的错误带有该 message。验证：`npm test` 通过。
- [x] 1.4 Pet Host apply 时触发一次解析；变量无效时用 `[dsh-pet]` console 警告（Pet 惯例：Host logger 不进 dsh.log），不进入 degraded。更新 `client/api.ts` 与 `http.ts` 顶部注释中"只认 loopback"的描述。验证：`npm run typecheck` 通过；临时设置非法值后启动日志可见警告（解析结果已用 tsx 核对；日志行随 3.2 重启核对合法值的 `management also accepts` 记录）。

## 2. 文档与部署说明

- [x] 2.1 `packages/dsh-pet/README.md` 新增一节说明 `DSH_PET_TRUSTED_HOSTS`：用途、格式、需要同时配置 `DSH_TRUSTED_HOSTS`、前面必须另有认证层、修改后需要重启；示例只用 `example.com`。`dsh.yaml` 中 dsh-pet 的 note 补一句该变量（保持 ≤600 code point）。验证：`npm test` 中的 manifest/note 长度检查通过，`npm run check:artifacts` 通过。

## 3. 集成验证

- [x] 3.1 包内 `npm run build`、`npm run typecheck`、`npm test` 全部通过；仓库根目录 `npm test` 通过；`node scripts/sync.mjs` 连续运行两次，第二次无变化。（2026-10-29：本改动相关测试全过；另有 4 个既有失败与本 change 无关——pet `locus-lark-port` 2 个因源码新增 `windowsHide`，根目录 2 个来自 ef35ccc4 的 magpie-connector note 超长与 README semver。）
- [x] 3.2 本机在 `.env.local` 加 `DSH_PET_TRUSTED_HOSTS=<公网域名>` 后由用户执行 `dsh restart`：经域名打开时 Pet 就绪、不再报 403；用 curl 以回环 Host 加跨源 Origin 访问，仍返回带 `ok: false` 的 403。（2026-10-29 实测：新 Host 环境含该变量，dsh.log 有 `[dsh-pet] management also accepts`；经域名 Host、同源 Origin、有效 cookie 访问 `/dsh-pet/api/config` 返回 200 `ok:true`；跨源 Origin 返回 403，但拦截发生在 DSH 官方 fence（纯文本 `forbidden`），因为两边信任列表相同，Pet 层到不了。Pet 层 `ok:false` 信封由 http/api-client 单测覆盖。）

## Workflow follow-up

- 验收后把 delta spec 合入 `openspec/specs/dsh-pet/spec.md` 并归档本 change。
- 更新记忆卡 `dsh-public-domain-loopback-only-features`，写明 Pet 一侧已可通过 `DSH_PET_TRUSTED_HOSTS` 放行。
