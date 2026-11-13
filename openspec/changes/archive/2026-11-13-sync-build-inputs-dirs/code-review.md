# Code review — sync-build-inputs-dirs

## REVIEW PASS

独立审阅实际实现及连接代码，未发现需要修复的实现缺陷。**Critical / High / Medium / Low findings：0 / 0 / 0 / 0。** 本结论不沿用 planning APPROVE，也不代表全仓测试、生产部署或 change 归档已完成。

## What this change does

让 local package 的额外构建输入支持目录：在任何 home 写入之前验证类型和所属根；哈希使用现有 collector 默认规则，将目录标记、排序后的文件路径和内容纳入原有输入哈希。没有扩展消费者构建流程，没有重写 freshness 判定。

审阅基线：`ef1d02e06f9b4014c70a0dbf344c3e1cb7f85e11` 上的当前工作树。完整产品 diff 仅三处，`+19/-6`。同工作树的其他并行改动不在本评审范围。

## 规范与连接代码核查

依据当前 [repo-layout spec](<../../specs/repo-layout/spec.md#L215-L242>)、[directory delta](<specs/repo-layout/spec.md#L205-L274>)、[design](<design.md>) 及 [freshness spec](<../../specs/sync-local-deploy-refresh/spec.md>)：

| 检查点 | 审阅结论与证据 |
|---|---|
| 类型与失败原子性 | 仅 buildInputs 改为 `file-or-dir`；其他 file/dir 约束保持严格。stat 后仍执行 realpath containment。源码预检在 profile 创建和账本迁移之前。[requiredSourcesOf / preflightSources:751–820](<../../../scripts/sync.mjs#L751-L820>)、[main:2020–2028](<../../../scripts/sync.mjs#L2020-L2028>)。 |
| collector 与目录编码 | 直接调用默认 `collectFiles(absolute)`，未添加排除选项；dot、node_modules、内部 symlink 跳过，普通嵌套 lib/test 保留。目录先写 marker，再按所属根相对文件路径排序写入路径 NUL 与内容；空目录、重复和重叠条目均保留贡献。[collector / hash:496–549](<../../../scripts/sync.mjs#L496-L549>)。 |
| 文件兼容性 | Node salt、包自身输入选择、输入排序和旧 `repo:<input>\0` + bytes 分支均保持。冻结旧算法 oracle 使用多个、重复及自身重叠文件，未调用产品哈希实现。[legacy oracle:39–64](<../../../tests/sync-build-inputs-dirs.test.mjs#L39-L64>)、[compatibility test:301–307](<../../../tests/sync-build-inputs-dirs.test.mjs#L301-L307>)。 |
| root 所有权 | requiredSources 与哈希调用都使用 `item.sourceRoot ?? REPO`；目录路径不借用另一根。双根同名目录测试分别修改两边，只改变对应消费者哈希。[call site:1380](<../../../scripts/sync.mjs#L1380>)、[root isolation:280–299](<../../../tests/sync-build-inputs-dirs.test.mjs#L280-L299>)。 |
| freshness 与部署 | 输入哈希、产物存在、成功构建产物证据仍是独立重建条件；既有产物与部署内容路径未改。[build decision:1382–1418](<../../../scripts/sync.mjs#L1382-L1418>)。未把“哈希没变”误作“产物当前”。 |
| 最小改动 | 无新 collector、黑名单、去重层、依赖图、API export、自动配置推断或消费者集成。实现范围与设计一致，无需为了抽象而额外拆分。 |

## 测试质量与实际验证

新测试不是只检查日志：通过真实 sync 子进程读取持久化哈希、快照临时 home、验证 deployed bytes。目录编码 oracle 使用明确的预期文件集合，而不是复制一个 collector；其排序、重复与重叠输入有精确值断言。[explicit oracle:66–78](<../../../tests/sync-build-inputs-dirs.test.mjs#L66-L78>)。

fixture 的真实 workspace build 直接读当前外部源码，而非复用旧 lib；source byte 变化即使恢复 mtime 也必须部署新内容，纯 mtime 变化则不重建，下一次 sync 比较完整 home 快照。[consumer fixture:91–103](<../../../tests/sync-build-inputs-dirs.test.mjs#L91-L103>)、[end-to-end assertions:309–331](<../../../tests/sync-build-inputs-dirs.test.mjs#L309-L331>)。

新 own-directory freshness 用例中的 lib 漂移也会改变输入哈希，因此不能单独证明产物证据独立性；它后半段保留输入账本而删除 generation record，确实验证了输入不变仍重建。既有 [freshness test:155–181](<../../../tests/sync-build-freshness.test.mjs#L155-L181>) 另行覆盖输入不变、lib 陈旧的关键场景。两者组合足够，不据此提出重复测试要求。

独立运行命令（与后来读到的 [implementation-log:20](<implementation-log.md#L20>) 最终命令相同）：

```bash
DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-build-inputs-dirs.test.mjs tests/sync-local-manifest-overlay.test.mjs tests/sync-overlay-root.test.mjs tests/sync-preflight.test.mjs tests/plugin-update-overlay.test.mjs tests/sync-build-freshness.test.mjs
```

- 工作目录为本 managed worktree；job `bash-483`，**exit 0，68 passed，0 failed/cancelled/skipped/todo，7168 ms**。
- 新 suite 为 13 个顶层测试 + 6 个子测试，合计 19；全部六 suite 合计 68。早期 18 / 48 的数值是中间快照，不是本次最终验证结果。
- `git diff --check -- scripts/sync.mjs tests/sync-build-inputs-dirs.test.mjs` 无输出且成功；最终重新检查完整产品 diff，exit 0。
- 已读取实施日志；其中 RED、preflight-only RED、artifact check 和 strict OpenSpec validate 是实施者提供的历史记录，本 reviewer 未复跑这些阶段，不将其当作自己的独立执行证据。

## Findings 与边界

**无 findings；无须提供缺陷复现或最小修复。** 通过结论仅针对上述实际实现、测试及受影响连接路径。

未运行默认/生产 sync、部署或新的真实消费者集成；未重复父 agent 的全仓 `npm test`，不宣称其通过。生产 package manager 的真实部署验证不由 fake CLI fixture 替代；本次仍以既有部署机制未改及相关回归结果为依据。全仓验证、任务/测试台账收尾、current spec 同步和归档由父 agent 在授权范围内继续处理。

本 reviewer 的唯一仓库写入为本报告；未修改规划评审、产品代码、测试、manifest、依赖或任务文件，未部署、提交或写 memory。
