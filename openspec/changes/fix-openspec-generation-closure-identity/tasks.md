## 1. 依赖闭包命名去路径化

- [x] 1.1 Write failing test: P/generation-closure.test.ts `relocated_identical_versions_reuse_generation_without_collision`；红态已用**部署中的修复前构建**（`~/.dsh/profiles/web/node_modules/dsh-openspec/lib`）对同一 fixture 复现：第二次物化抛 `generation-identity-collision`
- [x] 1.2 Implement: 闭包规划（依赖名排序、确定性深度优先、optional 缺失语义与依赖名校验保持）与 `key = <name>@<version>~<content8>~<ctx8>`；`content8` 为包自身内容的无路径哈希（与拷贝 filter 一致地排除嵌套 `node_modules`、跟随链接、目录去重防环），`ctx8` 由直接依赖身份 `depName->childName@childVersion` 排序后哈希派生；首次放置某 key 时写链接并拷贝，重复 key 只复用（链接签名不同则 `dependency-closure-ambiguous` fail closed）
- [x] 1.3 Refactor；`nested_versions_and_absent_optional_dependency_work_without_flattening_or_external_links`、`dependency_cycles_are_internal_and_substring_version_smoke_is_rejected`、`concurrent_same_identity_publication_converges_without_staging_leaks` 保持绿（同名同版本但内容不同的两份拷贝必须仍是两份，`~<content8>` 即为此）
- [x] 1.4 补断言：闭包目录名不含任何宿主路径片段（`^[A-Za-z0-9@._+-]+~[0-9a-f]{8}~[0-9a-f]{8}$`）

## 2. 闭包身份

- [x] 2.1 Write failing test: P/generation-closure.test.ts `closure_identity_is_layout_independent_and_version_sensitive`（同版本换布局 → 身份不变；依赖版本变化 → 身份变化）
- [x] 2.2 Implement: `closureIdentity(sourceRoot)`（只解析不拷贝，返回排序 key 集合 + 根包直接依赖签名的 sha256 前 16 位）
- [x] 2.3 Refactor；全套保持绿

## 3. 身份接线

- [x] 3.1 Write failing test: P/closure-identity.test.ts `changed_closure_derives_a_new_generation_instead_of_colliding`（受控 `closureIdentity`；闭包变化 ⇒ id 变化、两次都物化成功、旧 generation 目录逐字节保留）
- [x] 3.2 Implement: `generationIdentity(version, fingerprint, workflowIds, closure, telemetry)`；`apply()` 与 `refreshSurface()` 都传入当前闭包身份
- [x] 3.3 Refactor；`upgrade-entry.test.ts` 的 telemetry 重挂载场景保持"无 `generation-identity-collision`"

## 4. 启动失败可观测且 fail closed

- [x] 4.1 Write failing test: P/startup-failure.test.ts `startup_failure_logs_stable_code_and_registers_nothing`（活动 generation 不可加载：logger 恰好一条含稳定诊断码且不含错误正文/路径的消息；零 command、零 Skill provider；失败前注册的两个路由服务都被撤销）
- [x] 4.2 Implement: `contribute()` 的贡献全部登记 undo；失败时逆序撤销后再经 `ctx.logger.error` 上报一条有界诊断（`code` 字段 → 构造函数名 → `unknown`，不含错误正文与路径），不上报错误正文，也不升级为 Host 启动失败
- [x] 4.3 Refactor；全套保持绿

## 5. 文档与校验

- [x] 5.1 更新 `packages/dsh-openspec/README.md`（新增「Generations and the host dependency layout」：闭包命名/身份/失败日志）与 `dsh.yaml` 条目 `note` 的一句话记录
- [x] 5.2 运行 package 的 build/typecheck/vitest 与仓库级 `npm test`、`npm run check:artifacts`。结果：package 38 files / 162 tests 全绿；`check:artifacts` 通过；仓库级 `npm test` = 320 pass / 7 fail / 2 skipped，**7 个失败在改动前完全相同**（fixture 把 repo 根的 `node_modules` 软链进去后跑 sync 的 `tsc -p tsconfig.json`，而 worktree 的 lean 依赖里没有 `typescript`，报 `sh: tsc: command not found`），与本 change 无关，需在 promote/主 checkout 环境复核
- [x] 5.3 运行 `openspec validate fix-openspec-generation-closure-identity --strict`（passed）
- [x] 5.4 记录实机取证的只读复现步骤到 `docs/notes/dsh-openspec-generation-identity.md`（不含 token/secrets，只写可复核步骤与结论）
- [x] 5.5 新增 `packages/dsh-openspec/vitest.config.ts`（`testTimeout/hookTimeout = 30s`，与 `dsh-memex`/`session-links` 等兄弟包一致）：这些用例每个要多次物化真实官方包，vitest 默认 5s 预算在改动前就已贴边（实测 4596ms/4492ms），内容寻址后再超时；这不是放宽断言
