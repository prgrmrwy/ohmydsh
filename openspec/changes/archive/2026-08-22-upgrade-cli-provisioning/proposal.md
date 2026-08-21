## Why

autoUpdate 升级链在改写 `dsh.yaml` 后重跑 sync 物化,期间 `sync.mjs` 会对目标版本 `@deepseek-ai/dsh` CLI 连续发起多次 `npx -y @deepseek-ai/dsh@<新版本> plugin --profile web …` 调用。新版本 CLI 首次使用必须全新下载安装依赖树(本机实测远超 libnpmexec 的 10 秒锁等待上限),而 libnpmexec 对同一 npx 缓存 key 持有安装锁(concurrency lock),后续 npx 调用等待超时即报 `ECOMPROMISED / Lock compromised` → sync 失败 → 升级链按既有规范回滚。2026-08-21 至 22 的 `0.1.1-rc.1` / `0.1.1-rc.2` 自动升级均以此模式反复失败并回滚,升级长期无法生效。

## What Changes

- `scripts/sync.mjs` 的 `dshCli` 改为「首次单次预热 + 其后直连执行」:
  - 目标版本 CLI 首次调用前,先以**单次、串行**的 npx 调用完成安装就绪(此时无并发竞争);就绪后同目标的后续调用**直接执行** npx 缓存内已安装的 `lib/bin.js`(经 `node` 运行),不再发起新的 npx 进程,从机制上消除升级链内的安装锁竞争面。
  - npx 缓存 key 按 npm `libnpmexec` 的目录命名算法(sha512 摘要前 16 位)复刻,并保留对算法变更的自愈回退。
  - `DSH_BIN` 环境变量优先不变;CLI 就绪失败或直连执行失败时沿用既有失败语义(sync 失败 → 升级回滚、不启动),不新增静默路径。
- 本次只改动升级链**实现**,不改变 `startup-autoupdate` 既有检测、脏工作区跳过、回滚、提交语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `startup-autoupdate`: 新增一条 Requirement「升级链 CLI 就绪与复用」——目标版本 CLI 在使用前必须已就绪,同目标多次调用必须复用就绪实例,不得并发竞争安装;并保留失败即停语义。

## Impact

- **代码**: `scripts/sync.mjs`(dshCli 实现),含新增 `scripts/lib/dsh-cli.mjs`(纯函数:缓存 key 计算、bin 路径解析、就绪检查/预热/直连执行)。
- **测试**: 新增 `tests/sync-dshcli.test.mjs`(node:test,key 算法与既有缓存目录一致、路径解析、DSH_BIN 分支、缺失即预热)。
- **行为面**: autoUpdate 升级链可靠性;失败语义不变(回滚即停)。
- **依赖**: 依赖 npm `libnpmexec` 的 npx 缓存目录命名约定(版本约束在注释中标明);不新增第三方依赖。