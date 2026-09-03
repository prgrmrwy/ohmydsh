# sync-local-deploy-refresh Tasks

## 1. 部署面校验工具

- [x] 1.1 在 `scripts/sync.mjs` 实现 `deployedContentHash(profileDir, name, sourcePkg)`:按 `localInstallContentHash` 同款收集口径(included = package.json + dsh.bundle.patch + files 清单,以源 package.json 为准)对部署目录计算发布字节哈希;目录缺失视为不一致
- [x] 1.2 实现 `refreshLocalDeployment(name, spec, compatSpecs)`:rename 部署目录到 `.<name>.ohmydsh-refresh` → `dshCli plugin add` → 复验哈希;成功清理隔离目录,失败/不一致恢复旧副本并返回失败(恢复时若 add 已新建部署目录,先删新再 rename 回)
- [x] 1.3 为校验/刷新路径加"尝试熔断":同一包刷新后复验仍不一致时,本次运行内不再重试(日志说明),避免无限重装 — 实现为单次尝试语义:refreshLocalDeployment 每次运行只执行一次 evict+add,复验不一致即恢复旧副本并 fail(不更新 state hash),运行内无重试循环;测试 `verification mismatch after re-add…` 断言 add 调用数恰好 +1

## 2. 接入漂移重装分支

- [x] 2.1 在 local 包 `content changed, reinstalling atomically` 分支:先把"立即 add"改为"校验部署副本 → 一致则视为 up-to-date(仅更新 state),不一致才走 refreshLocalDeployment"
- [x] 2.2 确保与既有"不完整部署修复"路径顺序正确(先 missing-files 修复,后内容校验),两条路径隔离名不同、互不干扰
- [x] 2.3 校验通过/刷新成功后才写入 `nextLocalHashes`(与现状一致);刷新失败不更新 state 且 report fail

## 3. 测试与验证

- [x] 3.1 仓库级测试(`tests/`,node --test)新增:构造假 local 包 + 临时 profile 目录,覆盖 ①部署一致→up-to-date ②部署残留旧 lib→触发刷新且部署更新 ③重装失败→旧副本恢复且 sync 报错 ④复验仍不一致→熔断不无限重装 ⑤多个包独立处理
- [x] 3.2 实机验证:修改 `packages/session-links` 源(如 README 标记行)→ `node scripts/sync.mjs` → 部署副本哈希更新;连续第二次 sync 幂等无动作;恢复 README
- [x] 3.3 全量回归:`npm test` + `npm run check:artifacts` + 连续两次 sync 幂等
- [x] 3.4 实机确认 DSH 重启后 local 包新产物生效(rev 变化、页面加载新 bundle);回读 spec 确认行为一致后归档 change