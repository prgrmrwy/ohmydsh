## Why

`dsh build`(sync.mjs)对 local 包的"内容漂移重装"在 pnpm v10 下静默失效:pnpm 对 `file:` 目录依赖是**合并不覆盖**语义,已存在的子树文件(如 `lib/client.js`)在重装时保持不变,而 sync 只比较源内容 hash、从不校验部署副本,导致 local 包每次代码迭代后浏览器加载的永远是首次部署的旧 bundle(实测:README 等顶层文件会同步、`lib/` 子树恒不更新,`pnpm install --force` 也无济于事;已由 dsh-session-links 迭代全过程证实)。影响所有 local 包(system-clock、session-title-copy、worktree-session 等)的后续迭代。

## What Changes

- sync 在判定 local 包"内容漂移需重装"时,增加**部署副本内容校验**:哈希校验部署目录(`node_modules/<name>/`)的发布字节与源发布字节是否一致。
- 不一致时执行**evict + add** 强制刷新:先把部署目录移入隔离名(沿用既有 quarantine 模式),再 `dsh plugin add` 重新物化;失败时恢复旧部署并报错,绝不留下半部署状态。
- 一致时保持现状(up-to-date),不引入额外重装。
- 部署校验对**所有 local 包**生效(不只是出现问题的包);`state.localPackageHashes` 语义不变(仍记录源内容 hash),新增部署面校验与修复路径。
- 不改变 remote 包、skill、patch 的既有流程;不改变 manifest 格式。

## Capabilities

### New Capabilities
- `sync-local-deploy-refresh`: sync 对 local 包部署副本的内容一致性与强制刷新 — 漂移重装前校验部署面,不一致时以"隔离 + 重装 + 失败恢复"原子刷新,保证 `dsh build` 后浏览器加载的确实是最新产物。

### Modified Capabilities
<!-- 无现有 spec 行为变化。 -->

## Impact

- 修改 `scripts/sync.mjs`(重装分支与校验辅助函数),及相应仓库级测试(`tests/` 的 node --test)。
- 与既有"修复不完整部署"的 quarantine/恢复路径共用同一套隔离语义,需保证两条路径互不干扰。
- 行为视角:`dsh build` 后 local 包内容更新真正生效,无需人工 `rm -rf` 部署目录。
- 风险面:evict 期间若 DSH 正在运行并热读部署文件,可能读到缺失;重装失败必须恢复旧副本(fail-closed)。