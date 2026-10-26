# Pet Locus 固定源码兼容运行时

[English](README.md) · 简体中文

## 这是什么

当前 `dsh.yaml` 固定 DSH `0.2.0-rc.2`。Pet unified locus 需要该正式包尚未发布的
宿主能力，因此本目录维护针对固定 tag 的兼容 artifacts。

**2026-10-04 按 `dsh-v0.2.0-rc.2`（`639ed015`）重新推导**（change `upgrade-dsh-0-2-0-runtime` W5）：
四个 seam 在干净 HEAD 中仍为 0 命中（`git grep` 核对），故全部保留；`child-agent.ts` 的源码 hunk
经三方合并后语义与 0.1.5 一致（0.2.0 的 `agentPresets.mount` 仍返回 `{ id }`）；`list-children.spec.ts`
的 hunk 作废——上游已删除它修改的那个用例。上游 subagent 规格：未打补丁 316 通过、打补丁后 328 通过
（多出的 12 例即 seam 用例，包含全新 runtime 冷恢复后仍保持 silent settlement 的回归测试）。

**当前 overlay 保留 `@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-tools`，以及 native-managed-effects 的四个工具 owner 包（`tool-subagent`、`tool-subagent-control`、`tool-workflow`、`tool-ralph`）；另有下述 model-display 五包扩展。所有包均使用 `@deepseek-ai/dsh-` 前缀。**

承载的 seam（对应 5 个能力 marker）：

- `settlementNotice: 'silent'` —— 抑制子代结算向父会话的自动投递。父非 idle 时
  官方走 `steer`，会在最近一个 step 边界插入父正在进行的轮次；而 locus child 的
  结果已通过飞书汇报给真实受众，父不是受众。官方唯一的抑制开关 `announced` 语义是
  「该子代从未真正存在」，与此不符。已向上游报告：discussions #7508（交叉引用 #5360）。
- `createIdleContinuable` —— 创建 durable child 但不提交首条 prompt。官方
  `SubagentStartRequest.prompt` 必填，而 locus 创建是两阶段的（建 child → 建群 →
  提交 locus 行 → 才投递首条真实 Delivery），中间那段 child 必须存在但不能开始工作。
- `contextMode: 'independent-v1'` + durable `toolFilter` —— 子代从**自己持久化的
  preset** 独立 mount 一份组合，并核验挂到的就是 header 记录的那个，挂错即 throw。
  官方 `composeFrom` 绑定的是**父的** standing mount 实例，保证的是「已存活子代不被
  父的后续变更污染」，而冷恢复需要的是「能独立于父重建自己的组合」。
  调用方可用 `agentPreset` 显式指定该 preset（marker
  `supportsIndependentChildAgentPreset`）；两条冷恢复路径都从 descriptor 读回它并
  mount，缺失即 `NOT_RESUMABLE`。Pet 固定传 `dsh-pet-executor`，使 locus 子代的工具面
  不取决于主会话跑的是哪个 preset——`standard` 的 `tool-subagent` 带
  `modelSelectionSettings: true`，按 agent 注册进子代自有层，`toolFilter` 只过滤继承层，
  删不掉它。没有这一项，要么拒绝 `/bind` 到用户的普通会话，要么产出能委派出
  `bash`/`lark-cli` 的子代。
- `withLiveContinuableChildSession` —— 在 continuation owner 内访问准确的 child
  Session。官方泛化 Session 路由**有意**不解析 continuation-owned child。

- `dispatchToolBody` 最终 guard 重检——async `tools/execute` wrapper 等待期间撤销 scoped guard 时，在注册工具 body 尚未开始前拒绝调用；不取消已开始的 body，也不约束绕过 ToolRuntime 的任意副作用。

### model-display 五包扩展（AMD2）

`model-display.patch` 在既有 owner/build 中增加可选 resolved-model `displayGroup {id,label}` 的校验与 detach、Host catalog 投影、模型菜单和 `/model` 共用的展示 buckets/搜索，以及只读透出已有 `lastUsed` 的 actual/next effort 文案。一起重建 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-client-ui-model-selection`、`@deepseek-ai/dsh-client-ui-commands`；不能漏掉 aggregate `api-remotes`，否则生成 Remote codec 会丢字段。

精确 pin 为 `639ed015397290b3745d163aafe02ffee4aa3f84`，patch SHA-256 为 `0a9980ef42f621ba1977c3541196c1cb13bbcfab0eb146104b352f2c17f8ae19`，五包版本为 `0.2.0-rc.2-model-display.1`。stock rc.2 仍可正常用 Magpie 插件 route/生成，但列表保持 flat、不显示实际/下次 effort 差异。metadata 不改真实 provider/model id 或名字；同模型“最近实际：High · 下次：Medium”是两个真实事实，不是 effort 未生效。current/pending/check/提交仍按 Next；展示不调用会保存全局 defaults 的官方 `selectModel`，不覆盖投影、不改变 MANUAL 请求。

**正面证据**：reviewed stock rc.2 发布产物 `@deepseek-ai/dsh-llm/lib/types/types.d.ts:304–315` 的 `LlmModelInfo` 无展示 metadata；`@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:537–557、980–1022` 直接用 `group.id` 作选择/current/pending 真实身份，公开 `ModelSelectInjected` 仅提供 directory/load/select，不提供子组 renderer。伪 provider 不能安全表达纯展示归属。授权接缝与证据边界见[change design D13–D15](<../../../../openspec/changes/add-dsh-magpie-plugin/design.md#d13-amd2-选择器展示分组本轮已授权受管宿主扩展待独立-recheck>)。

**退役条件**：reviewed 官方 release 须同时支持 resolve/prepare 校验 detach、Host catalog、controller 与 aggregate Remote codec 保留字段、两种 selector 入口一致分组搜索且 actions 保持真实 route，以及 actual/next 无写回展示。逐项行为与实际加载图通过后，才一并退役本 patch、五包 override/template/pins/测试；不要连带移除其它 Pet seam。本处没有完整 seam 的上游报告或已发布版本记录。本地隔离 build 不等于已部署或 live GUI 验收。

### 已移除的 seam（不要加回来）

- **Storage 原子 batch / SQLite 独占**（曾替换 `storage`、`storage-domain`、
  `storage-json`、`storage-sqlite` 四个包）：`@deepseek-ai/dsh-storage` 公开导出
  `StorageBackend` / `KvFacet` / `KvUnit` 与 `BackendRegistry`，并明述路由归消费者，
  因此 Pet 改为**注册自己的 backend**（`src/host/storage/`），上游零改动。
- **`isolateQueuedTurnClaim`**（曾替换 `core/agent`、`core/agent-loop`）：只服务
  B035 的推送式 inquiry 派发，而该路径已被拉取式上下文工具取代；override 从未启用，
  台账 0 行。

重新引入任一项都需要按 `pet-compat-minimization` 重新正面举证，不是 revert。

本目录保存固定 upstream tag、可审查 patch/hash 与可重建脚本。生成的
`.upstream/`、`lib/`、`.launcher/`
均不是部署真相，不进入 Git。

`.upstream/` 是构建缓存（约 2.3 GB，重建需要联网），复用规则由 `upstream-cache.cjs`
决定：每次**成功**构建后在 `.upstream/.git/dsh-compat-cache.json` 记录本次的上游
commit 与 patch 哈希；下次构建若两者一致才复用被忽略的构建产物（`node_modules`、
`lib/`），否则（或没有记录、构建中断）先 `git clean -ffdx` 删除所有未跟踪与被忽略的
文件再构建。因此升级 DSH 版本或修改 patch 时**不需要手工清缓存**。曾出现的事故：
0.1.5 时期的缓存在升级 0.2 时被直接复用，已被 0.2 删除的包留下的 `lib/` 被打进
host 构建，`MISSING_EXPORT: SettingsProvider` 导致 DSH 无法启动（2026-10-08，VM）。

## 声明式选择与作用域

`dsh.yaml` 的本地 `dsh-pet` customization 声明：

```yaml
hostRuntimeCompatibility:
  kind: pet-unified-locus-v1
  supportedDshVersion: 0.2.0-rc.2
```

该声明表达“Pet 请求 Host 级兼容运行时”，技术效果是整个长期 `dsh web` Host
使用隔离 DSH 依赖根；它不是只影响 Pet 插件内部的局部替换。

只有 `scripts/dsh-server-bin.mjs` 解析此声明。`dsh build`、sync、plugin、
`--dump-config` 等一次性命令在没有人类显式 `DSH_BIN` 时仍使用 `dshVersion`
指定的官方精确 CLI，不构建、不加载该 overlay。`DSH_BIN` 仍是跨命令紧急逃生门，
不再是 Pet 的正常持久配置。

旧机器若 `.env.local` 仍含当前 checkout 的历史 Pet launcher 路径，`bin/dsh`
会识别由该文件新注入的精确值、打印迁移告警并忽略；调用方在 shell 中显式设置
同一路径时仍优先，其他路径绝不猜测或删除。

## 构建与安全边界

Host 首次准备会执行 `build-launcher.cjs`；fingerprint 命中时只做轻量自证，
不 clone、build、install 或访问 registry。fingerprint 覆盖：

- 固定 DSH 版本与 checkout canonical path；
- 五个 patch 及其固定 SHA、tools/native-tools/model-display package templates；
- Subagent/launcher/lock/timeout builders；
- Subagent / agent-loop package templates；model-display 四个专用测试文件、config 与 verifier。

重建时使用一把跨进程、可恢复 stale owner 的共享锁，覆盖 Subagent 源码与 launcher
整条链，并固定 `npm@11.19.0`（launcher）及上游声明的 `pnpm@11.7.0`（源码构建），以消除机器全局包管理器漂移。源码 checkout 仅在 install 子进程设置 `CI=true` 跳过无关的开发仓库 Lefthook 安装，依赖自身 install scripts 仍执行；tsc/tsdown 构建不继承该环境。reviewed DSH 源码要求 Node `^22.19.0 || >=24.0.0`，旧 Node 会在 clone/install 前明确失败。所有外部 git/corepack/npm 子进程通过有界 supervisor
运行，超时会终止进程组。launcher 在同文件系统 sibling staging 中完成：

1. 固定 tag 构建并验证各 patch 的 capability marker 与运行时行为；
2. 安装官方 `@deepseek-ai/dsh@0.2.0-rc.2`、上述 reviewed overrides（含 native-tools 与 model-display 五包）
   与显式声明的框架版本（cordis / cordis-plugin-include，值从 reviewed 上游树读取）；
3. 从源码 `install-script-policy.json` 生成精确版本脚本策略；固定 npm 强制项目模式、strict=true、ignore/dangerously-allow-all=false，未知脚本版本拒绝，不自动 approve-all。新执行许可须单独审查确认；当前策略仅包含已分别确认的精确许可和禁止项；
4. 验证依赖树唯一性、package identity/version/provenance、实际能力与 DSH
   `--version`；
5. 把 file links 转为自包含 package copies。POSIX 原子替换指针；Windows 共享锁内备份→发布→验证，失败恢复（有短暂无指针窗口，不承诺原子可见性）。调用方持同一锁读取版本/fingerprint并固定物理generation入口；发布不自动清理历史generation。未知/dangling实体或previous/next/restore残留拒绝继续，恢复失败保留备份供人工决策，不删除目标。

锁回收只针对同一目录 inode、同一 token/PID 且已确认死亡的 owner。`mkdir` 后尚未写出 owner 的目录即便很旧，也不是进程死亡证明；缺失/损坏 owner 或遗留 `.reclaim-*` 会有界等待后报错，不自动删除。遇到这些情况须由操作人员先确认所有构建进程已停止，再清理明确的锁残留；禁止在不确定时绕过锁启动第二个构建。锁测试复制源文件到临时目录运行，不清理实际 builder 的锁。升级此锁实现后，应确认没有仍加载旧实现的 builder/waiter 进程，再开始新的并发构建；磁盘改动不会更新已运行进程。

任一步失败都不会删除已有 `.launcher`；本次 Host 启动 fail closed，不静默回退
官方 runtime。启动控制台和 `dsh-startup.log` 会记录 runtime kind、owner、compat
kind 与版本。

### model-display 独立源码测试

只对 pin 上的 clean checkout 创建独立 copy/worktree，按 builder 顺序 apply 五个受管 patch；在该 copy 中运行：

```sh
DSH_COMPAT_SUBAGENT_CHECKOUT=/absolute/isolated/upstream node ./node_modules/vitest/vitest.mjs run --config /absolute/ohmydsh/packages/dsh-pet/compat/subagent/model-display.vitest.config.mjs
node ./node_modules/vitest/vitest.mjs run packages/llm/llm/tests/service.spec.ts packages/api/session-controller/tests/session-models.host.spec.ts packages/client/ui-model-selection/tests packages/client/ui-commands/tests
```

用 `finally`/EXIT 逆序恢复 patch，保留原 node_modules/生成物；不 apply/scrub shared `.upstream` 或在用 launcher。builder 在 semantic gate 后恢复源码，故 build 后未 patched 源码测试失败不是产品回归。专用测试现为25（owner 的24 + finding2跨组键盘精确回归）；新增用例是 test gap 修复，对正确且未改的生产代码直接 GREEN，不虚构新代码 RED/GREEN。

`node verify-model-display.mjs --graph /absolute/isolated/launcher` 检查 compiled provenance、真实 controller catalog、生成 Remote schema 与 client artifacts。测试本身也是 fingerprint input；修改测试后旧 graph 不再等于最终 source。后续正式 build 必须重算 fingerprint、复核 resulting graph 后才能部署，旧隔离 graph 通过不证明最终源码新鲜。

## 版本升级与移除

`supportedDshVersion` 必须精确等于 `dshVersion`。sync 在任何 profile 副作用前
校验，plain Host start 也独立复核。自动升级只改官方 pin，故新版本会有意触发
mismatch、sync rollback 和停止启动；绝不会自动把旧 patch 套到未知新源码。

升级前必须重新审查 upstream：

1. 若官方已发布全部能力，删除 `hostRuntimeCompatibility` 和本目录相关 overlay；
2. 否则针对新固定 tag 重新推导 patch、hash、能力验证与 compatibility kind/version。

不要仅修改版本字符串让构建继续。

**逐个 seam 复核，两个方向都要正面举证**（`pet-compat-minimization` 的要求）：

- 判定某个 seam **仍需保留**：引用目标版本 `.d.ts` 行号或文档原文，说明官方为何
  表达不了；
- 判定某个 seam **可以移除**：证据必须覆盖它承担的**每一项**语义，不是其中一项。

**举证必须用 `git grep <字符串> HEAD`，不要读 `.upstream/` 工作区，也不要按行号区间取。**
`build.mjs` 在该目录上 `git apply` 本补丁；构建现在会在退出时还原（含失败路径），但
构建进行中、或还原失败时，工作区里的 patch 内容与上游代码**外观完全一致**。
2026-09-23 的评审中，三位独立读者据此把 `settlementNotice` 与
`withLiveContinuableChildSession` 判成官方能力——两者在干净 HEAD 中均为 **0 命中**。
最具迷惑性的是补丁自己的 marker 注释（"Literal proof that this runtime honors …"）：
它读起来像上游承诺，实际只是让 Pet 自检补丁是否生效。

行号同样不可信：`notifySettlement` 在干净 HEAD 是 `:823`，打补丁后偏移到 `:855`，
且偏移量随 hunk 变化。**`git show HEAD:<file> | sed -n '行号区间'` 取到的是别的内容**；
验证某段代码是否存在于上游，只能按字符串搜。

先跑 `git -C .upstream status --short`：输出为空才说明工作区可信；非空时，清单内文件
一律按上述方式读，清单外目录（`core/`、`api/`、`workspace/`、`session/`、`preset/`）
可直接读。

第二条是 2026-09 实测的教训。当时据「官方 `startContinuable` 接受 `spec.childId`」
判定 `createIdleContinuable` 可退，却漏了它同时承担的「不提交初始内容」——而官方
`prompt` 必填；又据 `composeFrom` 的 "bind, not a mount" 判定 `independent-v1`
可退，但那句话保证的是「已存活子代不被父的后续变更污染」，不是「能独立于父重建
组合」。**形近 API 常常解决的是相邻问题。**

### 退役还取决于 Pet 自己的架构前提（2026-09-23 补）

上面两条只检查**上游能不能表达**。但一个 seam 的必要性同时由 **Pet 这一侧的结构
前提**决定，而后者可能先于上游改变。当前四个 seam 的实际阻塞项：

| seam | 阻塞 | 说明 |
|---|---|---|
| `settlementNotice: 'silent'` | **需要旁路 locus 主会话** | 其论证前提是「父 = 用户正在使用的主会话」，故 `notifySettlement` 走 `parent.steer()` 会插进用户的轮次。上游实际代码是 `parent.status === 'idle' ? 'queue' : 'steer'`——父若是 Pet 自有的 standby 主会话（几乎恒为 idle），走 `queue`，在它自己的会话里开一轮，不打断任何人。**前提由架构消除，不必等上游发布。** |
| `contextMode: 'independent-v1'` + `agentPreset` | **只要 locus 能绑定用户自己的会话就不能退** | 子代的组合必须由 Pet 指定、且冷恢复不随父漂移。`/bind` 可指向运行 `standard` 的用户会话，官方 `composeFrom` 只能继承父的组合，无法表达「子代用另一个 preset」。 |
| `createIdleContinuable` | 失败补偿需重新设计 | 官方 `startContinuable({ childId })` 可接受预留 id，改为「先留 id → 先提交 locus 行 → 首条真实 Delivery 作为创建 prompt」即可绕开 `prompt` 必填。但当前顺序是「child 先存在才提交行」，反转后行可能指向不存在的 child。与 BACKLOG B036 是同一条。 |
| `withLiveContinuableChildSession` | **只要子会话仍是 subagent child 就不能退** | 泛化 Session 路由**有意**拒绝 continuation-owned child（判据即 `origin === 'subagent'`）。生产消费面 3 处：sandbox policy 的 apply/resolve、启动恢复的 delivery 证明——均需读写子会话自身的 Session 对象，无替代路径。 |

**因此这些 seam 都不能独立退役**：它们各自的退役入口是 Pet 的结构改造，而不是
一次 patch 清理。判定可退时，除了引用上游 API，还必须指出**是哪次架构变更消除了
该 seam 的前提，以及该变更是否已经落地**。

同一纪律的反向用法：若某次架构改造声称「顺带让某 patch 可以退役」，必须在改造
**落地并验收之后**才移除 patch，不得在同一批改动里既建立新前提又依赖它。

## Gate O2：不阻塞无进程执行基线

当前基线不保留 `bash`、`pwsh`、`run_code` 或其它任意进程/代码执行能力。只有另行
实现并验证独立 UID/container、Lark 凭据隔离以及到 Lark API 的网络 egress policy，
才可评估保留通用 shell；Host 的受管 `pet_locus_finish` broker 还必须在该隔离下继续
可用。独立 HOME、PATH 隐藏、Skill 省略、prompt 提醒和 command 字符串过滤均不能
替代这些隔离证明，也不得作为启用 shell 的理由。Gate O2 未实现不阻塞当前
`independent-v1` + allow-based safe composition，但禁止把基线改回带通用进程执行。
