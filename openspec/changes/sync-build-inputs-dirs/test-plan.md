## Test Plan

PRECHECK：第 2 轮 `VERDICT: APPROVE`，无要求修改。

MODIFIED requirement 保留的 35 个历史场景也逐一映射。红色表示本 change 尚未逐行验收，不表示已存在的测试当前失败；实施时复用真实断言，不为不变行为制造故障。新增目录行为必须先在旧实现上失败，然后实现变绿。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 缺失时行为不变 | tests/sync-local-manifest-overlay.test.mjs | no overlay: sync behaves exactly as before | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 条目被追加物化 | tests/sync-local-manifest-overlay.test.mjs | overlay entry is appended and materialized | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 条目出现在启动清单与升级检查 | tests/sync-local-manifest-overlay.test.mjs | startup listing includes overlay entries; update check covers overlay remote entries | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | id 与公开 manifest 冲突时拒绝运行 | tests/sync-local-manifest-overlay.test.mjs | id colliding with the public manifest is rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 声明顶层字段时拒绝运行 | tests/sync-local-manifest-overlay.test.mjs | overlay declaring a top-level field is rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 条目不因来源而放宽校验 | tests/sync-local-manifest-overlay.test.mjs; tests/sync-build-inputs-dirs.test.mjs | overlay entries are not exempt from per-field validation; missing required field is rejected for overlay entries; overlay-regression-06: missing fields, remote identity and runtime mismatch fail before writes | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 存在但不可解析时拒绝运行 | tests/sync-local-manifest-overlay.test.mjs | present but unparsable overlay fails closed; overlay whose root is not a mapping fails closed | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 环境变量指定 overlay 路径 | tests/sync-local-manifest-overlay.test.mjs | DSH_LOCAL_MANIFEST replaces the default overlay path | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 公开 manifest 不承载不可公开定制的痕迹 | tests/sync-build-inputs-dirs.test.mjs | overlay-regression-09: public manifest exposes no private fixture entries | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 含 overlay 时 sync 仍幂等 | tests/sync-local-manifest-overlay.test.mjs | sync stays idempotent with an overlay present | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 外部 overlay 根的 patch 与 skill 从该根物化 | tests/sync-overlay-root.test.mjs | external overlay root materializes its own patch and skill | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 外部 overlay 根缺少条目源码时在物化前拒绝运行 | tests/sync-preflight.test.mjs | missing overlay patch fails before rewriting cordis.patch.yml | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 公开条目缺少源码时同样在物化前拒绝运行 | tests/sync-preflight.test.mjs | missing public skill fails before any materialization | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 源码经符号链接越出所属根时拒绝运行 | tests/sync-preflight.test.mjs | symlinked patch escaping its root is rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | compat 依赖目录缺失或越界时在物化前拒绝运行 | tests/sync-preflight.test.mjs | missing or escaping compat dependency fails before dependency sync | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 全新环境预检失败时不创建 profile | tests/sync-preflight.test.mjs | preflight failure on a fresh DSH_HOME leaves it empty | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | DSH_LOCAL_MANIFEST 为相对路径时拒绝运行 | tests/sync-overlay-root.test.mjs | relative DSH_LOCAL_MANIFEST is rejected by sync | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | DSH_LOCAL_MANIFEST 为相对路径时启动清单降级 | tests/sync-overlay-root.test.mjs | relative DSH_LOCAL_MANIFEST degrades the startup listing with a warning | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 外部 overlay 根的 local package 在该根内构建并安装 | tests/sync-overlay-root.test.mjs | external root local package builds in its own workspace | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 外部 overlay 根的 local package 构建失败 | tests/sync-overlay-root.test.mjs | external root build failure stops before install | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | buildInputs 越出 overlay 根时拒绝运行 | tests/sync-overlay-root.test.mjs | buildInputs escaping the overlay root are rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 经符号链接置于仓库根 | tests/sync-overlay-root.test.mjs | repo-root overlay symlink resolves sources from the link target | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 以相同 npm 包名顶替公开 package 时拒绝运行 | tests/sync-overlay-root.test.mjs | overlay package reusing a public npm name is rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay package 与顶层 dependencies 同名时拒绝运行 | tests/sync-overlay-root.test.mjs | overlay package reusing a top-level dependency name is rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay package 与 compat 依赖同名时拒绝运行 | tests/sync-overlay-root.test.mjs | overlay package reusing a compat dependency name is rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 自动升级不改写 overlay 条目 | tests/plugin-update-overlay.test.mjs | plugin-update skips overlay rows without touching dsh.yaml | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 升级检查的每一行携带来源标记 | tests/plugin-update-overlay.test.mjs | every update row carries fromOverlay | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 升级检查按 scope 解析 registry | tests/plugin-update-overlay.test.mjs | scoped package metadata goes through npm with profile auth | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | npm spec 与 name 不一致时拒绝运行 | tests/sync-overlay-root.test.mjs | name disagreeing with the npm spec is rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 禁用的 overlay local package 缺少源码不阻止 sync | tests/sync-preflight.test.mjs | disabled local package without source is removed via the ledger | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | overlay 源码缺失不阻止 reset | tests/sync-preflight.test.mjs | reset succeeds when overlay sources are gone | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 运行体兼容源码缺失不阻止 reset | tests/sync-preflight.test.mjs | reset succeeds when the host runtime builder is missing | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 禁用 local package 的 package.json 越出所属根时拒绝运行 | tests/sync-preflight.test.mjs | disabled local package.json escaping its root is rejected before reading | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 条目自行声明所属根时拒绝运行 | tests/sync-overlay-root.test.mjs | reserved sourceRoot and overlaySource fields are rejected | 🟢 green |
| specs/repo-layout/spec.md → 本地 manifest overlay 追加不可公开定制 | 启动清单列出外部 overlay 根的 local package | tests/sync-overlay-root.test.mjs | startup listing resolves local names from the overlay root | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 目录内被收录文件变化触发重建 | tests/sync-build-inputs-dirs.test.mjs | dir-input-01: 外部源码变化构建并上线新字节，mtime 无关且第二次幂等 | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 目录内新增、删除或改名文件改变哈希 | tests/sync-build-inputs-dirs.test.mjs | dir-input-02: 目录内新增、删除或改名文件改变哈希 | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 范围外与默认跳过内容不改变目录条目的哈希贡献 | tests/sync-build-inputs-dirs.test.mjs | dir-boundary-filters: dir-input-03 ignored scope; dir-input-12 nested lib/test are source | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 嵌套 lib 与 test 源码被收录 | tests/sync-build-inputs-dirs.test.mjs | dir-boundary-filters: dir-input-03 ignored scope; dir-input-12 nested lib/test are source | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 空目录条目的哈希稳定且不同于无条目 | tests/sync-build-inputs-dirs.test.mjs | dir-input-04: 空目录条目的哈希稳定且不同于无条目 | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 条目书写顺序不影响哈希 | tests/sync-build-inputs-dirs.test.mjs | dir-boundary-overlap: dir-input-05 ordering, duplicates, file+dir and self overlap keep contributions | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 目录条目不存在时预检失败 | tests/sync-build-inputs-dirs.test.mjs | dir-input-06: 目录条目不存在时预检失败 | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 既非文件也非目录时预检失败 | tests/sync-build-inputs-dirs.test.mjs | dir-boundary-input-kinds: file/dir accepted, FIFO/socket rejected, strict kinds retained | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 原有文件条目仍通过预检 | tests/sync-build-inputs-dirs.test.mjs | dir-input-08: 原有文件条目仍通过预检 | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 目录条目越出所属根时拒绝运行 | tests/sync-build-inputs-dirs.test.mjs | dir-boundary-links: internal file/dir links ignored; top-level in-root accepted, dir-input-09 escape rejected | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | overlay 目录条目按 overlay 根解析 | tests/sync-build-inputs-dirs.test.mjs | dir-boundary-root-isolation: dir-input-10 public and overlay use only their owning root | 🟢 green |
| specs/repo-layout/spec.md → local package 的构建输入可声明文件或目录 | 既有文件条目的哈希保持不变 | tests/sync-build-inputs-dirs.test.mjs | dir-input-11: 既有文件条目的哈希保持不变 | 🟢 green |

## Coverage Notes

- 共 47 行：35 个继承的回归场景 + 12 个新增目录场景，无漏项、无 N/A。原有用例的名字必须保持与真实源码一致。
- `tests/sync-build-inputs-dirs.test.mjs` 是新增 suite，使用 Node 原生 `node:test` 和 `assert`，不安装依赖。复用现有 overlay fixture 的隔离 DSH_HOME / fake CLI；构建脚本必须实际消费外部库文件，不触碰日常 profile、不启动或重启当前 GUI。
- inherited `overlay-regression-09`：独立 public/overlay fixture，断言同步前后公开 manifest 字节不变且不含仅在 private fixture 中生成的 id/包名；不读取用户实际私有 overlay。其余 34 行有已有具名用例；若其断言弱于 scenario THEN，先补足该用例断言。
- 哈希断言通过隔离 sync 写出的 `localPackageBuildInputs` 记录观察，避免为测试新增产品 API。冻结旧哈希算法只放测试里，保持当前 Node 进程/版本、输入、编码与排序，不依赖旧部署的现场数据。
- **额外参数化用例（design D4，必须实现）**：

| Test Name | 断言 / oracle | 关联场景 |
|---|---|---|
| dir-boundary-input-kinds | file/dir 成功；FIFO/socket 写前失败；原有 strict file/dir 错型仍拒绝，DSH_HOME 快照不变 | dir-input-06, 07, 08 |
| dir-boundary-overlap | 重复条目、file+dir 重叠、自身目录不去重；显式 file 覆盖目录范围外或默认跳过文件时仍计入，冻结旧编码计算预期 | dir-input-05, 11 |
| dir-boundary-filters | 验证源码范围之外的 test/lib 不计入；默认 dot/node_modules 忽略；嵌套 lib/test 普通源码计入，不新增过滤选项 | dir-input-03, 12 |
| dir-boundary-links | 内部 file/dir symlink 放在可遍历 src 下，目标含根内外，均不计入；顶层目录 symlink 根内成功、根外拒绝 | dir-input-03, 09 |
| dir-boundary-root-isolation | 公开根与外部 overlay 根同名不同字节，各自只取所属根 | dir-input-10 |
| dir-boundary-freshness | 自身目录输入时 lib 漂移，或输入不变但产物记录缺失，仍重建；实际外部源码变化产物上线且连续第二次幂等 | dir-input-01, 03, 11 |

- 验证命令：`DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-build-inputs-dirs.test.mjs tests/sync-local-manifest-overlay.test.mjs tests/sync-overlay-root.test.mjs tests/sync-preflight.test.mjs tests/plugin-update-overlay.test.mjs tests/sync-build-freshness.test.mjs`。
- 新增 suite 与六组参数化均已实现；最终六 suite 68 passed、0 failed/skipped。分组测试映射使用真实名称，详见 implementation-log.md 的逐行断言映射。
- 开工前基线（2026-10-17）：运行上述命令中的五个既有 sync/overlay suites，再加 `tests/tracked-artifacts.test.mjs`，56 tests passed、0 failed、0 skipped；尚不存在的新增目录 suite 未包含在这次运行中。`npm run check:artifacts` 与两份 change 的严格校验通过。

- 第 2 轮简化后不再实现或测试 excludeDirNames；消费者 fixture 明确以源码目录与所用配置为输入，构建直接消费当前源码，防止打包陈旧 lib。
