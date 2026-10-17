PRECHECK：第 2 轮评审 `APPROVE`，无要求修改。实现与定向验证已完成，最终收尾校验中。

交付 / 证明映射：1 → test-plan 35 个继承场景；2 → dir-input-06/07/08/09；3 → dir-input-02/03/04/05/10/11/12；4 → dir-input-01 和独立 freshness 边界；5 → 全部 47 行与仓库回归。实现范围限 `scripts/sync.mjs` 与对应 Node 测试，无新依赖、无部署、不修改用户实际 overlay。

执行顺序：1 建立基线 → 2 扩展预检 → 3 扩展哈希 → 4 验证真实构建结果 → 5 收尾；本 change 只阻塞 dsh-collab 接入/部署，不阻塞 collab-kernel 独立开发。所有新增行为先写失败测试，确认因旧行为缺失而失败，不能因 fixture 坏掉冒充 RED。既有不变行为不伪造失败。

## 1. 继承场景与隔离基线

- [x] 1.1 运行 test-plan 映射的现有 `sync-local-manifest-overlay`、`sync-overlay-root`、`sync-preflight`、`plugin-update-overlay` suites；逐条核对继承场景的 WHEN/THEN，不以文件名代表覆盖全部断言
- [x] 1.2 在 `tests/sync-build-inputs-dirs.test.mjs` 补 `overlay-regression-09: public manifest exposes no private fixture entries`；使用合成 overlay 标识，断言 public manifest 无私有条目且字节不变；先用反例 fixture 证明断言能检出污染，再确认旧实现通过
- [x] 1.3 为新增 suite 建立临时目录、fake CLI、DSH_HOME 快照、账本哈希读取和真实消费外部文件的构建 fixture；复用 `tests/helpers/overlay-fixture.mjs`，不改部署接口、不安装依赖

## 2. 文件或目录预检

- [x] 2.1 编写失败测试：dir-input-06、dir-input-07、dir-input-08、dir-input-09；以及 dir-boundary-input-kinds、顶层目录 symlink 根内/根外参数化。对目录合法路径在旧实现上的拒绝和错误类型文案作 RED，保留原有文件成功/strict kind 拒绝基线
- [x] 2.2 实现 `scripts/sync.mjs` 的 `requiredSourcesOf` 与 `preflightSources`：为 buildInputs 显式增加 file-or-dir，保留 file/dir 严格检查与先 realpath containment 再物化的顺序；FIFO/socket 拒绝且 DSH_HOME 不变，使 2.1 通过
- [x] 2.3 重构预检分支；运行 `node --test tests/sync-build-inputs-dirs.test.mjs tests/sync-preflight.test.mjs tests/sync-overlay-root.test.mjs` 全绿，更新对应 ledger 行

## 3. 目录输入哈希与兼容

- [x] 3.1 编写失败测试：dir-input-02、dir-input-03、dir-input-04、dir-input-05、dir-input-10、dir-input-11、dir-input-12；以及 dir-boundary-overlap、dir-boundary-filters、dir-boundary-links、dir-boundary-root-isolation。覆盖增删改名、嵌套 lib/test 源码计入、目录范围外测试/产物不计入、默认 dot/node_modules 忽略、空目录、排序、重复/自身/file+dir 重叠；同 Node 冻结旧算法兼容 oracle（含多个文件条目和自身重叠）
- [x] 3.2 实现 `scripts/sync.mjs` 的 `localBuildInputHash` 目录分支：直接复用 `collectFiles(absolute)` 默认遍历，不新增 collector 选项，使用 repo-dir 前缀；文件分支与包自身 collector 字节编码不变；内部 symlink 忽略、公开/overlay 根分别解析，使 3.1 全部通过
- [x] 3.3 重构局部遍历与哈希；运行新增 suite 和 `tests/sync-build-freshness.test.mjs` 全绿，逐行更新 ledger；不增加 glob、依赖图或新 manifest 字段

## 4. 构建、部署副本与独立新鲜度

- [x] 4.1 编写失败集成测试：dir-input-01 和 dir-boundary-freshness；fixture 的构建输出实际包含外部库源码，修改后部署副本必须改变，第二次运行无变化；自身 lib 漂移、产物记录缺失即使目录贡献不变也必须重建。新增目录消费在旧实现上应因拒绝目录而失败
- [x] 4.2 接通 2、3 的目录输入到既有 needsBuild/账本流程；若存在遗漏只修真实集成点，不削弱产物新鲜度/原子刷新、不新增第二套重建判定，使 4.1 通过
- [x] 4.3 重构并运行 test-plan 中完整验证命令，确认原有 35 个场景仍满足原规范、新增 12 个场景及 6 个额外参数化组全绿

## 5. 收尾验证

- [x] 5.1 核对 test-plan 全部 47 行实际测试名与断言，更新状态；额外参数化组不得遗漏。运行 `npm test`、`npm run check:artifacts` 与 `git diff --check`，报告实际环境失败而非静默跳过
- [x] 5.2 运行 `openspec validate sync-build-inputs-dirs --strict`；按 Anvil verify 比较实现 diff、测试日志与批准 spec，不把规划审查当作实现验收
- [ ] 5.3 经实现评审和验证后再同步 delta spec / 归档；不自动提交、合入或清理 worktree，这些动作需要用户批准

收尾状态：5.3 中 delta spec 已同步且语义幂等核验通过；归档、提交、合入与 worktree 清理未获用户授权，保持未执行。两份 verify 如实区分实现通过与 Anvil 全仓零skip要求未满足。
