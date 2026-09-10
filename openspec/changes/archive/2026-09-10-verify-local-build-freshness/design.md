## Context

`scripts/sync.mjs` 物化 local package 的链路是：**判定是否构建 → 构建 → 判定是否重装 → 校验部署副本 → 原子刷新**。

其中后半段已由 change `2026-09-03-sync-local-deploy-refresh` 加固：`deployedContentHash()` 校验部署副本发布字节，`refreshLocalDeployment()` 做隔离-重装-复验，fail closed。该能力的契约是"**部署副本 ↔ 源目录产物**一致"，它合理地假定源目录产物本身正确。

缺口在前半段。当前判定（`sync.mjs:826`）：

```js
const needsBuild = typeof localPkg?.scripts?.build === 'string' && (
  previousBuildInputs[name] !== buildInputHash || !localBuildOutputsExist(localDir, localPkg)
)
```

两个条件都只描述输入侧：`buildInputHash` 是源码 hash（`localBuildInputHash` 显式排除 `lib/`），`localBuildOutputsExist` 只检查产物目录**是否存在**、不问内容。二者都无法回答"现存产物是不是由这份源码编译出来的"。

账本 `localPackageBuildInputs` 位于 `$DSH_HOME/.dsh-sync-state.json`，且**只记录源码 hash、不含任何 checkout 路径信息**，因此被同机所有 checkout 共用。这使错配极易发生。

2026-09-08 实测（在 main 上只污染 `lib/index.js`、不动 `src/`）：sync 不重建，直接把被污染产物部署上线，日志打印 `reinstalling atomically`、退出码 0。真实事故是 `dsh-pet` 的修复两次被静默部署成旧版本，表现为"源码已修、测试全绿、已合入主干，但运行时行为是旧的"。

一个额外的既有事实影响设计：`nextBuildInputs[name]` 的写入点在 `sync.mjs:993`，条件是 `installed && ...`，即**部署成功后**才记账，而非构建成功后。同时 `sync.mjs:802` 会把上一轮账本中仍 enabled 的条目**结转**到本轮，用于"构建失败时不擦除上次成功记录"。

## Goals / Non-Goals

**Goals:**
- 使"源目录构建产物由当前源码产生"成为可证明、可判定的前置条件，堵住 build 与 deploy 之间的缺口。
- 无法证明同代时 fail closed（重建），与仓库既有取向一致。
- 保持增量构建与幂等：同代时不重建，连续两次 `dsh build` 无变化。
- 兼容既有账本：升级后首次运行不得因缺字段而失败。

**Non-Goals:**
- 不改动 `sync-local-deploy-refresh` 已确立的部署面校验与原子刷新语义（本变更只补其上游）。
- 不改 remote package、skill、preset、patch 的既有流程。
- 不追求"检测任意外部篡改产物"这一更强性质（见 Decision 1 的取舍）。
- 不改 `dsh.yaml` manifest 结构，不引入新的用户可见配置。
- 不修改任何 DSH 插件的运行时行为。

## Decisions

### Decision 1：记录上次构建实际产出的产物内容 hash

**选择**：新增账本字段 `localPackageBuiltFrom`，在**构建成功后**记录 `{ input, output }`——`input` 是该次构建所用的源码输入 hash，`output` 是构建实际产出的发布内容 hash（复用既有 `localInstallContentHash`，它已覆盖 `files` 契约下的 `lib/`）。`needsBuild` 增加一项：当前产物 hash 与记录的 `output` 不符（含记录缺失）即重建。

**为什么最终落在"直接看产物"而不是间接指标。** 本 change 在实施阶段连续证伪了两版间接方案：

1. **只记 `input`**（提案初版）：账本键只有包名、值只有源码 hash，无法区分"同一份源码在 A 目录构建、却部署 B 目录产物"——正是 2026-09-08 事故形态（worktree 构建后合入主干，主干源码 hash 相同 → 命中 → 跳过构建 → 部署主干那份陈旧 `lib/`）。
2. **记 `{ dir, input }`**：补上目录后仍被测试证伪——同一目录内产物被替换（手工改 `lib/`、或切到源码恰好相同而产物不同的状态）时 `dir` 与 `input` 双双命中，判定认为可证明，陈旧产物照样上线。

两次失败同源：**用"构建的来源"代理"产物的实际状态"**，而代理关系总有绕过路径。记录产物自身的内容 hash 消除的是这层代理，而非再换一个间接指标。`dir` 因此不再需要——跨 checkout 时产物 hash 本就不同，无需单独判目录。

**这不要求构建可复现。** 记录的是"上次构建**实际产出了什么**"这一既成事实，而非"这份源码**应当**产出什么"。时间戳、路径、工具版本带来的输出差异不影响判定：只要没人动过产物，hash 就不变；一旦产物被换成别处的字节，hash 必然不同。

**成本可忽略。** `localInstallContentHash(localDir)` 在既有流程中已被计算（`sync.mjs:885`，用于与部署副本比对），本方案只是把该值多存一份，不新增哈希计算。

**替代方案 A：对 `lib/` 取内容 hash 与"期望产物 hash"比对。** 提案阶段曾以"tsc/tsdown 输出不保证可复现、无稳定预期值可存"否决——**该否决理由是错的**，它假定必须预知"应当产出什么"。本决策采纳的正是此方案的正确形式：存"实际产出了什么"，不需要任何预期值。

**替代方案 B：比较 `src/` 与 `lib/` 的 mtime。** 否决：mtime 在 `git checkout`、`cp`、跨文件系统移动后不可靠——本次事故中恰恰是"产物 mtime 更新但内容陈旧"骗过了初次判断。仓库既有代码也一贯使用内容 hash 而非 mtime。

**替代方案 C：每次都无条件重建。** 否决：牺牲增量构建，`dsh build` 会显著变慢，与既有幂等承诺相悖。

**取舍**：判定的是"产物字节是否仍是上次构建的产物"，因此它同时覆盖跨 checkout、切分支/rebase 与手工篡改产物三类形态。它**不**判断"这份产物在语义上是否由当前源码正确编译"——若有人把产物换成另一份**恰好 hash 相同**的字节，或构建脚本本身有 bug 产出错误内容，本机制不负责，那属于构建工具链的正确性范畴。

### Decision 2：记账时机移到"构建成功后"，与部署成功解耦

**选择**：产物代次记录在 `runLocalBuild` 成功后即写入（针对源目录产物这一事实），不等部署成功。

**理由**：这条记录描述的是"源目录里的产物由哪份源码产生"，与部署是否成功无关。若沿用现有 `installed &&` 的时机，会出现：构建成功但部署失败 → 记录未写 → 下次运行重复构建。虽不产生错误结果，但违背"同代时不重建"的幂等目标。

**与既有 `localPackageBuildInputs` 的关系**：保留该字段现有语义（"上次成功部署所用输入"）不变，新增字段独立承担代次证明，避免改动既有失败恢复与结转逻辑（`sync.mjs:802`）造成回归。

### Decision 3：缺失即重建（fail closed）

账本无该 package 的代次记录时（首次升级、账本被 `dsh reset` 清理、手工删改），一律重建。代价是升级后首次运行每个 local package 各多构建一次，一次性且可预期；收益是不必区分"从未记录"与"记录丢失"，也不会在证据缺失时假定最新。

### Decision 4：新增字段而非复用/改写既有字段

`localPackageBuildInputs` 已被结转逻辑和失败恢复语义依赖，就地改写其含义会牵动 `sync.mjs:788/802/993/1001/1083` 多处。新增独立字段使本变更可加、可回滚，且与 `durable-sync-state-ledger` 既有的"字段缺失按未知处理"惯例一致。`dsh reset` 路径（`sync.mjs:1082-1083`）需同步清理新字段，以免残留记录在重置后仍被当作证据。

## Risks / Trade-offs

- **[升级后首次全量重建]** → 每个 enabled local package 各重建一次。一次性、可预期，日志明确显示重建原因；不影响正确性。
- **[账本与源目录跨 checkout 仍共用]** → 本变更不消除共用，而是让共用不再导致错误结果：另一 checkout 的产物字节与记录的 `output` 不符，直接触发重建。账本仍是每包一条定长记录，不随 checkout 数量增长。
- **[判定需读取产物字节]** → 需在构建判定处计算该包 `files` 契约下的发布内容 hash。同一计算在既有流程中已存在（`sync.mjs:885`，用于与部署副本比对），本变更复用同一函数、不引入新的哈希算法；代价是对大包多一次目录读取。
- **[构建失败后的记录状态]** → 必须确保失败时不写入声称成功的代次记录，否则下次运行会跳过构建并部署陈旧产物，等于把本缺陷永久化。这是本变更最关键的实现约束，需专门测试覆盖（见 specs 中"构建失败不留下被视为同代的产物"场景）。
- **[与既有部署面校验的交互]** → 两者顺序固定：先保证产物同代，再校验部署副本。若顺序颠倒，部署面校验仍可能在两份同样陈旧的产物间判定"一致"。测试需覆盖二者串联后的幂等性。

## Migration Plan

1. 实施后首次运行 `node scripts/sync.mjs`：所有 enabled local package 因缺代次记录各重建一次并写入记录。
2. 第二次运行：应全部报告 up-to-date、无任何重建/隔离/重装动作（幂等验收）。
3. 回滚：移除新判定项与新字段写入即可；残留的账本字段会被忽略，不影响旧逻辑（旧代码只读它不认识的键之外的字段）。无需清理 `$DSH_HOME`。
4. 无部署面数据迁移，无用户可见配置变更。

## Open Questions

（实施后回填，均已解决。）

- **账本字段命名** → 采用 `localPackageBuiltFrom`，值为 `{ input, output }`。
- **是否额外记录 node 版本以覆盖工具链升级** → 不需要。已核实 `localBuildInputHash` 第一行即 `h.update(\`node:${process.version}\0\`)`（`sync.mjs:254`），工具链版本已进入 `input`；且本决策最终以 `output` 为判据，工具链变化导致的产物差异会被直接检出。
- **实施中新发现并已解决**：判定所需的产物 hash 必须在**构建判定之前**计算，而既有 `localInstallContentHash` 调用点在其之后。已将同一函数提前调用，构建后复用 `localHash` 写入记录，确保比对与记账使用同一口径、不会漂移。
