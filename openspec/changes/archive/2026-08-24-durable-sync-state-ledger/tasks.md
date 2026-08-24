> 说明:本 change 为已落地修复(commit `1bef127`)的补充规范。实现与验证在提案前已完成,下方勾选项均对应实际执行过的改动与检查。

## 1. 账本标识与迁移

- [x] 1.1 `scripts/sync.mjs` 的 `STATE_FILE` 改为与仓库名无关的 `.dsh-sync-state.json`,并注释说明该命名的历史成因
- [x] 1.2 新增 `LEGACY_STATE_FILES`(`.ohmydsh-` / `.mydsh-` / `.zydsh-`,按新到旧)
- [x] 1.3 新增 `migrateLegacyState()`:当前账本不存在且存在历史命名时,rename 最新世代到当前文件名并记为一次 change
- [x] 1.4 更旧世代以 log 报告为"已被取代、可安全删除",不执行删除
- [x] 1.5 在 `main()` 入口、任何 `loadState()` 之前调用迁移

## 2. 回归测试

- [x] 2.1 新增测试:重建改名前布局(账本为历史命名 + 部署文件带旧 GENERATED 头),断言迁移发生、历史文件被移动而非复制、旧头被改写而非报错、账本哈希与新内容一致、再次运行为空操作
- [x] 2.2 新增测试:多个历史世代并存时采用最新者,更旧者被报告且文件保留

## 3. 引用同步

- [x] 3.1 `tests/sync-agent-instructions.test.mjs` 与 `tests/sync-local-package.test.mjs` 的账本路径改为新文件名
- [x] 3.2 `README.md` 与 `docs/notes/dsh-home-agent-instructions.md` 的账本文件名同步

## 4. 验证

- [x] 4.1 `npm test` 22/22 通过(含新增 2 条);既有 fail-closed 场景("未托管冲突"/"托管漂移"/"安全撤销")全部照常通过,确认语义未被放宽
- [x] 4.2 真实 `~/.dsh` 执行 sync:输出 `migrate sync state .ohmydsh-sync-state.json -> .dsh-sync-state.json` 与 `ignoring superseded sync state .mydsh-sync-state.json`,历史文件保留
- [x] 4.3 连续第二次 sync 报告 `no changes — deployment already matches manifest`,确认迁移幂等
- [x] 4.4 `npm run check:artifacts` 通过
