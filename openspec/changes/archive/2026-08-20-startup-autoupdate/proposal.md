# startup-autoupdate

## Why

启动器 `bin/dsh` 每次从 `dsh.yaml` 的 `dshVersion` pin 启动 DSH,升级需要人工「改 pin → 重跑 sync」,容易长期落后于 registry 最新版本。目标是让每次启动/构建自动检测最新版本:**一旦有更新,先阻塞启动,完成「dsh 运行体更新(pin)→ yml 更新(同族 pin 联动)→ build 更新(重物化)→ 自动 commit」,再启动**,尽量从最新 DSH 版本开始。

## What Changes

- 新增顶层 `autoUpdate` manifest 配置:`enabled`(逃生门总开关)与 `channel`(追踪 `latest` / `next`),支持 `DSH_SKIP_UPDATE=1` 与环境变量 `DSH_UPDATE_CHANNEL` 覆盖。
- 新增 `scripts/check-update.mjs`:**直连 npm registry**(不走 `npm view`,规避本机 npm 缓存隐患),读取 `dshVersion` 与 `dist-tags.<channel>`,用 semver 比较,输出机器可读 JSON。
- `bin/dsh` 的 `dsh`(start)/ `dsh -b` / `dsh build` 三个入口都接入检测:
  - **有更新且 git 工作区干净** → 自动升级:行级改写 `dsh.yaml`(`dshVersion` + 同族 `@deepseek-ai/dsh-*` 且 pin 等于旧运行体的 spec/version,一并升到新运行体;改写前写 `.bak`)→ 重跑 `node scripts/sync.mjs` → `git add dsh.yaml && git commit --no-verify`,默认 message `chore(dsh): auto-bump <旧> → <新>` → 继续启动/构建。
  - **有更新但工作区有未提交改动** → 跳过自动升级,在启动/构建输出中说明原因与再触发条件。
  - **offline / 检测失败** → 警告 + 按当前 pin 继续(fail-open)。
  - **build 失败** → 从 `.bak` 恢复 `dsh.yaml`,报错退出,**不启动**。
  - **commit 失败** → 报错退出,不启动,提示手动处理 git。
- `dsh history` 启动日志增加 autoUpdate 事件记录(升级/跳过及原因)。
- `package.json` 新增 `semver` devDependency(预发布序 `rc.N` 比较)。
- 约定修订(非 BREAKING):README「不自动漂移,升级 = 改 pin」被 `autoUpdate` 取代为默认自动追赶;逃生门 `autoUpdate.enabled: false` 保留「钉在旧版」能力。

## Capabilities

### New Capabilities

- `startup-autoupdate`: DSH 启动/构建入口自动检测 registry 最新版本,并在满足条件时阻塞式完成 DSH 运行体升级(改 pin + 同族联动 + 重物化 + 自动提交)后再启动的行为契约。

### Modified Capabilities

- (无) `repo-layout` 的 manifest 契约围绕定制列表与 sync,新增 `autoUpdate` 属新行为域,不改变既有定制/sync 语义。

## Impact

- `bin/dsh`: 启动/`-b`/`build` 路径新增「检测 → 升级 → 继续」分支。
- `scripts/check-update.mjs`(新增)、`package.json`(`semver` devDependency)。
- `dsh.yaml`: 新增 `autoUpdate` 顶层字段;`dshVersion` 与同族 `@deepseek-ai/dsh-*` pin 将可被自动改写(遵守上面分支规则)。
- `README.md`: 升级约定段落修订。
- 外部依赖:` @deepseek-ai/dsh` 的 registry `dist-tags.latest/next`(只读)。
