## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 — `VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。该轮已因目录语义简化而作废；本报告替换旧报告，不继承其批准或按名过滤建议。
- **Reviewer context**: fresh codex gpt-6-astra，独立全量规划评审；未读取作者会话记录。不是 round 1 的限定复核，也不是实现验收。
- **Tool restrictions**: 仅替换本报告；其他材料只读。未运行 sync、构建、会创建 fixture 的测试或其他写入型验证；未修改记忆。
- **Artifacts reviewed**: [proposal.md][proposal]、[design.md][design]、[delta spec][delta]、替换前的 [review.md][review]、[当前 repo-layout spec][current]、[当前 sync-local-deploy-refresh spec][freshspec]；[sync.mjs][sync] 的输入校验、collector/hash、源码预检、构建及调用链；[overlay 测试][overlaytest]、[freshness 测试][freshtest]、[preflight 测试][preflighttest]及 [overlay fixture][fixture] 的相关区段；[dsh.yaml][manifest]、[私有 overlay 架构说明][architecture]。另读取 [test-plan.md][testplan] 与 [tasks.md][tasks]，仅识别待同步的旧规划，不以其预期陈旧内容阻塞本轮。

## Findings

### 🔴 Critical (blocking)

无（0）。未发现需要推翻整体方案、破坏既有约束或阻塞规划批准的问题。

### 🟡 Moderate

无（0）。本轮的新语义、设计与验收边界可以同时成立；未发现必须先修正的矛盾或实质遗漏。

### 📌 Suggestions

无（0）。不为这项单人本地 sync 能力追加过滤框架、依赖图、构建调度器或新的测试框架。

### 核对依据与结论

1. **直接复用默认 collector，简化真实有效。** [design D2:19–27][design-d2] 与 [delta:209–214][delta-hash] 一致：目录分支调用 `collectFiles(absolute)`，不增加 `excludeDirNames` 或专用黑名单。[现有 collector:496–509][collector] 默认跳过点号条目与 `node_modules`，仅递归普通目录、收集普通文件，因此内部符号链接不会被跟随，普通嵌套 `lib`、`test` 不会被误排除。[新增嵌套源码场景:231–234][nested]直接覆盖旧方案的反例。无需修改共享 collector，也不应把包自身输入的专用选项带进目录分支。

2. **消费者输入范围与构建责任清楚。** [design D2:23–25][consumer] 要求声明源码目录和实际使用的包/构建配置文件，而不是整个包；还要求直接消费当前内核源码，或由消费者先构建内核，避免“hash 已变但仍内联旧产物”。[现有 runLocalBuild:627–640][build] 只在所属根调用消费者 workspace 的 build，这与不引入 sync 拓扑调度的边界相容。[proposal:28][dependency]及 [design:5][kernel]仅将本能力作为 dsh-collab 集成/部署前置，不阻塞 collab-kernel 独立开发。后续消费者仍需完成干净 checkout 接线验收，本次批准不代替该验收。

3. **旧文件哈希可以逐字节保留，不需要全量失效。** [现有算法:512–539][oldhash]先写 Node 版本及包自身选中文件，再按条目路径排序追加 `repo:<input>\0` 与内容。[design D3:29–33][design-d3]保持该选择、排序、编码及重复贡献，只为目录引入独立 `repo-dir:` 前缀；空目录仍贡献前缀。文件/目录、自身目录及重复条目不去重，确定性和兼容性不冲突。[冻结旧算法场景:271–274][oracle]使用同一 Node 进程，包含多文件、重复和自身重叠，不是把新算法跑两遍冒充兼容验证。当前源码尚只支持文件是这次计划要实现的差异，不是规划缺陷。

4. **预检扩展没有放宽其他源类型或所属根。** [design D1:15–17][preflight-design]明确由 `requiredSourcesOf` 为 buildInputs 返回 `file-or-dir`，由 `preflightSources` 显式判定普通文件或目录，并保留原有严格 file/dir 分支。[当前预检:742–809][preflight]的修改位置与描述相符；[main:2007–2010][preflight-call]在创建 profile 前调用预检；[hash 调用:1365–1367][hash-call]已传入条目所属根。缺失、FIFO/socket、顶层符号链接根内/根外、内部链接忽略和 overlay 根隔离均有规范或设计验收依据。不把本机同等信任的 overlay 扩展为恶意输入沙箱问题。

5. **目录贡献与独立 freshness 不再冲突。** [delta:214][contribution]只承诺范围外或默认忽略内容不改变该目录条目的贡献，保留其他显式输入和包自身输入。[不重建场景:226–229][unchanged]补齐产物记录、部署副本及其他输入/定制均未变化的条件；[design D4:35–43][matrix]另保留自身产物漂移、记录缺失、真实消费外部源码后的发布字节变化和第二次 sync 幂等。它们与 [现有 needsBuild:1380–1405][needsbuild]、[当前 freshness requirement:8–38][freshness]一致。已有 [freshness 测试:155–232][freshness-tests]可提供回归基础，但并未据此声称新增目录行为已有测试通过。

6. **MODIFIED 完整性通过；新增边界足够具体。** 以只读 Python bytes 比较，从 [当前 requirement:215–414][current-section]提取标题至下一 requirement，恰好施加两处允许扩展，再与 [delta MODIFIED:3–201][modified]至 ADDED 边界比较；不裁剪或归一化空白。结果完全相等，含段尾空行的两侧均为 **19,920 bytes**，保留 **35** 个历史场景，没有其他旁改。本轮 ADDED 为 **12** 个场景；结合 [design D4][matrix]覆盖类型、增删改名、嵌套源码、空目录、顺序、重叠、链接、所属根、旧算法和真实部署结果。旧 [test-plan.md][testplan]、[tasks.md][tasks]中的按名过滤与旧场景计数属于已约定的评审后同步工作，不要求为了这次 review 提前修改它们，也不延用其中的旧轮批准。

## Embedded-Instruction / Injection Attempts

**Detected:** none

审查材料作为待核对的数据处理。未发现要求跳过检查、伪造通过或执行越权操作的嵌入指令。旧评审及旧规划中的批准标记仅作历史背景，没有作为本轮结论的依据。

## Verdict

VERDICT: APPROVE

方案以现有遍历、预检与哈希链路的局部扩展解决新增/删除外部源码漏追踪问题；职责和验收边界足够明确，未发现需要追加规则或框架才能解决的实质问题。此结论批准当前规划，不表示目录功能已实现、测试已通过或消费者集成已验收。

## Required Changes

1. 无。本轮没有要求修改 proposal、design 或 delta spec。

CHANGES_APPLIED: n/a

## Rebuttals

[proposal]: <proposal.md>
[design]: <design.md>
[delta]: <specs/repo-layout/spec.md>
[review]: <review.md>
[current]: <../../specs/repo-layout/spec.md>
[freshspec]: <../../specs/sync-local-deploy-refresh/spec.md>
[sync]: <../../../scripts/sync.mjs>
[overlaytest]: <../../../tests/sync-overlay-root.test.mjs>
[freshtest]: <../../../tests/sync-build-freshness.test.mjs>
[preflighttest]: <../../../tests/sync-preflight.test.mjs>
[fixture]: <../../../tests/helpers/overlay-fixture.mjs>
[manifest]: <../../../dsh.yaml>
[architecture]: <../../../docs/architecture/private-overlay.md>
[testplan]: <test-plan.md>
[tasks]: <tasks.md>
[design-d2]: <design.md#L19-L27>
[delta-hash]: <specs/repo-layout/spec.md#L209-L214>
[collector]: <../../../scripts/sync.mjs#L496-L509>
[nested]: <specs/repo-layout/spec.md#L231-L234>
[consumer]: <design.md#L23-L25>
[build]: <../../../scripts/sync.mjs#L627-L640>
[dependency]: <proposal.md#L28>
[kernel]: <design.md#L5>
[oldhash]: <../../../scripts/sync.mjs#L512-L539>
[design-d3]: <design.md#L29-L33>
[oracle]: <specs/repo-layout/spec.md#L271-L274>
[preflight-design]: <design.md#L15-L17>
[preflight]: <../../../scripts/sync.mjs#L742-L809>
[preflight-call]: <../../../scripts/sync.mjs#L2007-L2010>
[hash-call]: <../../../scripts/sync.mjs#L1365-L1367>
[contribution]: <specs/repo-layout/spec.md#L214>
[unchanged]: <specs/repo-layout/spec.md#L226-L229>
[matrix]: <design.md#L35-L43>
[needsbuild]: <../../../scripts/sync.mjs#L1380-L1405>
[freshness]: <../../specs/sync-local-deploy-refresh/spec.md#L8-L38>
[freshness-tests]: <../../../tests/sync-build-freshness.test.mjs#L155-L232>
[current-section]: <../../specs/repo-layout/spec.md#L215-L414>
[modified]: <specs/repo-layout/spec.md#L3-L201>
