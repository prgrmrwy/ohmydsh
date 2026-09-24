# sync-local-deploy-refresh Design

## Context

问题与动机见 proposal.md「Why」,行为契约见 specs/sync-local-deploy-refresh/spec.md。关键事实(2026-09-03 实测):

- pnpm v10 对 `file:` 目录依赖是**合并不覆盖**:重装时更新新增/顶层文件(package.json、README.md),但**已存在的子树文件(lib/*)保持旧内容**;`pnpm install --force`、`pnpm rebuild` 均不刷新。`rm -rf` 部署目录后重装才拿到新内容。
- sync.mjs 现有逻辑:local 内容漂移 → `dshCli(['plugin','--profile',PROFILE,'add',...spec])`,**无部署前清洗**;state 只记录源内容 hash(`localPackageHashes`),从不校验部署面 → 漂移重装静默无效,且后续 sync 均判定 up-to-date。
- sync.mjs 已有"修复不完整部署"(missing files)路径:完整的两阶段修复(先 add,再 evict + add + 恢复),其中 evict/quarantine + 失败恢复是成熟先例。

## Goals / Non-Goals

Goals:
- `dsh build` 后 local 包内容迭代真正生效(部署副本 = 源发布字节),无需人工操作。
- 校验 + 刷新对全部 local 包生效;幂等、原子、fail-closed。

Non-Goals:
- 不改 pnpm 配置或换包管理器(profile 已 pin pnpm 10、`nodeLinker: hoisted`;pnpm 行为是外部事实,适配而非对抗)。
- 不改 remote 包 / skill / patch 流程;不引入部署面 hash 进入 state 的持久化(部署面是派生物,每次运行现场校验即可)。
- 不修 DSH web 侧的 rev 缓存问题(与本次无关)。

## Decisions

### D1: 现场校验部署面,而非持久化部署 hash
每次 sync 运行,对判定为"需重装"的 local 包,现场计算部署副本发布字节哈希与源发布字节哈希比对。不新增 state 字段。理由:部署面是源内容的派生物,pnpm/人工都可能改它,持久化反而引入陈旧判定;现场校验开销(单包小文件)可忽略。备选(持久化部署 hash)被否:与"人工手动 rm -rf 重装后 sync 误判 drift"的既有哲学冲突。

### D2: 复用 quarantine 模式,新隔离名 `.<name>.ohmydsh-refresh`
既有修复路径用 `.<name>.ohmydsh-recovering`;新路径用独立后缀,避免两条路径互相踩踏(并发的两次 sync 或交错场景)。流程:`rename(部署目录, 隔离名)` → `dshCli add` → 复验:
- 复验一致 → `rm(隔离名)`
- 失败/复验不一致 → `rename(隔离名, 部署目录)` 恢复 + fail(恢复时若部署目录已被 add 新建,则先删新目录再 rename 回;顺序保证与既有 restoring 分支一致)
此流程与既有"stage 1 plain add → stage 2 evict + add"的区别:**新路径直接 evict + add 一次完成**(因为 pnpm 的合并语义决定了 plain add 必然无效,没有 stage 1 的意义);但保留"先 rename 后 add、失败可回滚"的原子性。

### D3: 哈希口径 = localInstallContentHash 同款(发布字节)
复用 `localInstallContentHash` 的收集逻辑(included = package.json + dsh.bundle.patch + files 清单),分别对源目录与部署目录计算。部署目录的 `files` 清单以**源 package.json** 为准(部署副本的 package.json 可能因 pnpm 改写不同)。先验证部署目录存在;不存在视为不一致(缺失即刷新)。实证(2026-09-03,`pnpm pack` 实测):`git check-ignore` 虽标记源 `lib/`(构建产物不入库),但 pnpm 打包 tarball **包含** `lib/*`——以 package.json `files` 白名单为准,不应用 gitignore 排除。部署副本 = files 白名单内容,D3 口径与 pnpm 实际打包语义一致。

### D4: 与"不完整部署修复"路径的交互
两条路径按顺序评估:先 missing-files 修复(全量部署完整性),后 content 校验(漂移刷新)。同一包在一次运行中最多走一条路径(前一条已使部署到位则后一条复验一致)。隔离名不同 + 恢复逻辑各自独立,互不干扰。

## Risks / Trade-offs

- [evict 窗口内 DSH 正在运行并热读部署文件] → 窗口极短(重装 <2s),且 DSH 对 local 包文件的读取发生在启动/重建时;如已确认运行中读取,可把 evict 推迟到 `dsh build` 完成提示重启(当前项目惯例即为"构建后重启验证")。
- [pnpm 行为未来变化(不再合并),重装即生效] → 复验逻辑天然兼容:部署一致 → 无额外动作,一致后 up-to-date。
- [`files` 清单与 pnpm 实际打包规则存在差异,导致复验永不一致] → 已实证 pnpm pack 以 files 白名单为准(不应用 .gitignore 排除),此风险基本解除;若未来 pnpm 打包语义变化导致复验永不一致,退化为"以部署后首次校验校准"并在 note 记录,不得无限重装(参照既有 unrepairable 熔断思想,加刷新尝试计数熔断)。
- [`rm -rf` 语义破坏其他并发 sync] → sync 本就单实例(仓库级命令),沿用既有 quarantine 的 rename(原子)而非直接删除,窗口内不可观察。

## Migration Plan

1. 实现校验 + 刷新路径与仓库级测试(mock profile 目录与本地假包)。
2. 实机验证:改一个 local 包源码 → build → 确认部署副本哈希更新、浏览器加载新 rev;再跑一次 sync 幂等。
3. 无需迁移既有 state(不新增字段);已处于"部署旧、state 新"的包首次运行即被校验修复。

## Open Questions

无(熔断尝试上限实现期定,不影响本 spec 行为)。