# Pet Locus 方案 A/B 可量化维护成本对比

> measured 2026-09-23 · 仓库 HEAD `6365f222` · DSH pin `0.1.5-rc.2`
> 本文只做成本分析，不给架构建议。
> 每个数字标注 **[实测]**（附命令/文件行号）或 **[估算]**（附依据）。

---

## 0. 测量口径与一处重要更正

`packages/dsh-pet/compat/subagent/.upstream/` **不是干净上游树**。`build.mjs:116`
会把 `settlement-notice.patch` 用 `git apply` 打进该目录，工作区至今保持已打补丁状态：

```
$ cd packages/dsh-pet/compat/subagent/.upstream && git status --short
 M packages/subagent/subagent/src/child-agent.ts
 M packages/subagent/subagent/src/continuation-activation.ts
 M packages/subagent/subagent/src/continuation.ts
 M packages/subagent/subagent/src/descriptor.ts
 M packages/subagent/subagent/src/index.ts
 M packages/subagent/subagent/src/types.ts
 M packages/subagent/subagent/tests/continuation.spec.ts
 M packages/subagent/subagent/tests/list-children.spec.ts
 M packages/subagent/subagent/tests/service.spec.ts
```

因此**判定「上游是否已原生提供某能力」必须用 `git show HEAD:<路径>`**，读工作区
会把本仓 patch 误计为上游原生能力。已按此口径复核（upstream HEAD =
`fb2c4b9`，tag `release-dsh-0.1.5-rc.2`）：

| seam | types.ts | index.ts | continuation.ts |
|---|---|---|---|
| `settlementNotice` | 0 | 0 | 0 |
| `createIdleContinuable` | 0 | 0 | 0 |
| `contextMode: independent-v1` | 0 | 0 | 0 |
| `withLiveContinuableChildSession` | 0 | 0 | 0 |

**[实测]** 四项在 0.1.5-rc.2 干净上游中出现次数全部为 0 —— 没有一项可因"上游已发布"而退役。

---

## 1. 现状（方案 A）的持续维护成本

### 1.1 patch 本体规模

| 指标 | 值 | 来源 |
|---|---|---|
| patch 行数 | **916** | `wc -l settlement-notice.patch` |
| hunk 数 | **33** | `grep -c '^@@'` |
| 被 patch 文件数 | **9**（6 源码 + 3 测试） | `grep -c '^--- a/'` |
| 新增/删除行 | +617 / −21 | `grep -c '^+' / '^-'` |
| 承载 seam 数 | **4** | README.md:10-24 |

### 1.2 patch 的历史修改次数与原因（核心经验证据）

`git log --oneline -- packages/dsh-pet/compat/subagent/settlement-notice.patch`
共 **9 条 commit** **[实测]**。逐条读 commit message 后的原因分类：

| # | commit | 日期 | patch 行数 | hunks | 原因分类 |
|---|---|---|---|---|---|
| 1 | `0c2f21fc` | 09-11 | 575 | 32 | **新增能力**（unify locus collaboration，patch 诞生） |
| 2 | `24d1f55b` | 09-11 | 692 | 32 | **修复缺陷**（harden unified locus recovery） |
| 3 | `478f09cb` | 09-13 | 1201 | 46 | **新增能力**（独立 child preset 恢复 + 隔离认领，B035 G1/G3） |
| 4 | `996a6568` | 09-15 | 1246 | 48 | **新增能力**（serialize Delivery with unified finish） |
| 5 | `89e2d83a` | 09-21 | 1003 | 40 | **DSH 升版重新推导**（0.1.2→0.1.5-rc.2） |
| 6 | `a02df093` | 09-22 | — | — | merge（无独立语义） |
| 7 | `5256ee4d` | 09-22 | 820 | 32 | **收敛精简**（7 包 72 hunks → 1 包 32 hunks） |
| 8 | `7347413f` | 09-23 | 1074 | 40 | **修复缺陷**（子会话驻留被当作代际可用性，3 处根因） |
| 9 | `d984a998` | 09-22 | 916 | 33 | **修复缺陷**（冷恢复漏传 settlementNotice） |

**分类统计 [实测]**（排除 merge，8 条有效）：

| 原因 | 次数 | 占比 |
|---|---|---|
| 修复缺陷 | **3** | 37.5% |
| 新增能力 | **3** | 37.5% |
| DSH 升版重新推导 | **1** | 12.5% |
| 收敛精简 | **1** | 12.5% |

**关键读数**：在 **43 天内**（09-11 → 09-23）patch 被改 **8 次**，
平均 **5.4 天/次** **[实测]**。其中 3 次是真机抓到的缺陷修复 —— 即
**每约 14 天就有一次 patch 语义缺陷逃过本地测试进入真机**。

**单次 DSH 升版的实际代价 [实测]**：`89e2d83a` 对 patch 文件的 numstat 是
`729 insertions / 972 deletions` —— 即一次 minor 版本跳变**重写了 patch 的绝大部分**
（当时 patch 约 1246 行，改动量 1701 行 ≈ 136%）。同 commit 全仓
`120 files changed, 3264 insertions(+), 3077 deletions(-)`。
这是"每次 DSH 升级必须重新推导 patch"的直接量化证据，不是估计。

### 1.3 升级必做步骤清单

来源 `compat/subagent/README.md:92-134`：

1. 校验 `supportedDshVersion` **精确等于** `dshVersion`（sync 前置校验 + plain Host start 独立复核，README:94-96）。自动升级只改官方 pin，故新版本**有意**触发 mismatch、sync rollback 和停止启动。
2. 重新审查 upstream：若官方已发布**全部**能力 → 删除 `hostRuntimeCompatibility` 与整个 overlay；否则针对新固定 tag **重新推导 patch、hash、能力验证与 compatibility kind/version**（README:98-102）。
3. **逐个 seam 双向正面举证**（README:105-109）：判定保留需引用目标版本 `.d.ts` 行号或文档原文；判定可移除的证据必须覆盖它承担的**每一项**语义。
4. 重建 launcher 并通过全部能力 marker 校验。
5. 额外的本方前提复核（README:117-134）：还必须指出**是哪次架构变更消除了该 seam 的前提，以及该变更是否已落地验收**。

README:111-115 明确记录这条纪律来自一次实测教训：曾据形近 API 判定 3 个 seam 可退，
实施期全部证伪（"**形近 API 常常解决的是相邻问题**"）。

### 1.4 隔离 launcher 的构建成本

| 指标 | 值 | 来源 |
|---|---|---|
| 构建工具链总行数 | **740** | `wc -l build.mjs build-launcher.cjs compat-build-lock.cjs compat-run.cjs` |
| ├ `build.mjs` | 293 | 同上 |
| ├ `build-launcher.cjs` | 305 | 同上 |
| ├ `compat-build-lock.cjs` | 115 | 同上 |
| └ `compat-run.cjs` | 27 | 同上 |
| `build.mjs` 外部进程调用 | **11** | `grep -cE '^\s*run\('` |
| `build-launcher.cjs` 外部进程调用 | **10** | `grep -cE 'run\(\|runNpm\('` |
| **外部进程调用合计** | **21** | |
| `build.mjs` 校验闸门 | **17** | `grep -c 'fail('` |
| `build-launcher.cjs` 校验闸门 | **9** | `grep -cE 'fail\(\|throw new'` |
| **校验闸门合计** | **26** | |

**外部进程链（11 个，`build.mjs` 实测行号）**：
`git clone`(94) → `git checkout --detach`(101) → `git checkout -- .`(102) →
`git apply --check`(108) → `git apply`(116) → `pnpm install`(122) →
`tsx native build --host-addon-only`(123) → node(124) → `pnpm install`(131) →
`tsc -b tsconfig.host.json`(132) → `tsdown --env.DSH_BUILD_FACE host`(133)

**磁盘体量 [实测]** `du -sh`：

| 目录 | 大小 |
|---|---|
| `.upstream/`（patch 后的上游源码树） | **1.7 GB** |
| `.launcher-builds/` | **561 MB** |
| `lib/` | 940 KB |
| **compat/subagent 合计** | **2.2 GB** |

三者均为构建产物、被 gitignore、不是部署真相（README:38-40），但每次 fingerprint
未命中都要重跑上述 21 个外部进程重新生成。

**锁机制复杂度**：`compat-build-lock.cjs` 115 行，实现跨进程、可恢复 stale owner
的共享锁。README:86 记录其保守边界：只回收"同一目录 inode、同一 token/PID 且已
确认死亡"的 owner；`mkdir` 后未写出 owner 的目录**即便很旧也不是死亡证明**；
缺失/损坏 owner 或遗留 `.reclaim-*` 有界等待后**报错而不自动删除**。

### 1.5 `hostRuntimeCompatibility` 的影响范围

声明（`dsh.yaml:109-111`）：
```yaml
hostRuntimeCompatibility:
  kind: pet-unified-locus-v1
  supportedDshVersion: 0.1.5-rc.2
```

**作用域不是 Pet 局部**（README:52-53）："技术效果是**整个长期 `dsh web` Host**
使用隔离 DSH 依赖根；它不是只影响 Pet 插件内部的局部替换。"

解析点 **[实测]** `grep -rn hostRuntimeCompatibility`（排除 worktrees）：
`scripts/lib/dsh-host-runtime.mjs`（4 处：50/53/56/61）、`scripts/dsh-server-bin.mjs`（84 行）、
`dsh.yaml:109`、根测试 2 个文件。全仓唯一 owner 约束由 `dsh-host-runtime.mjs:53` 强制
（`only one customization may own hostRuntimeCompatibility`）。

失败语义：任一步失败**不删除已有 `.launcher`**，本次 Host 启动 **fail closed，
不静默回退官方 runtime**（README:88-90）。

### 1.6 历史事故：根因与两个结构前提的关系

判定口径：
- **(a)** = 根因与「locus 子会话是 subagent child」直接相关
- **(b)** = 根因与「父/主会话是用户自己的会话」直接相关

#### `dsh-plugin-integration-pitfalls.md`（12 个编号条目 + 2 个附录条目）

| # | 标题（行号） | 根因摘要 | (a) | (b) |
|---|---|---|---|---|
| 1 | `meta.agentPreset` 只记录名字（L14） | preset 必须显式 `mount`，只填 meta 得到空组合 | 否 | 否 |
| 2 | `stdio:'ignore'` 让长驻子进程退出（L71） | stdin 立即 EOF | 否 | 否 |
| 3 | lark-cli 结果不在 `data` 信封（L102） | 结果在响应顶层 | 否 | 否 |
| 4 | 事件日志结构必须实测（L122） | 事件类型/角色/文本位置推断全错 | 否 | 否 |
| 5 | `agent/inbox/claimed` 混着 Host 自注入上下文（L151） | 首轮注入 3 条上下文 → observer 判 `mixed` → `currentForChild()` 返回 undefined → 回复授权丢失 | **间接** | **是** |
| 6 | 入队即唤醒，claim 先于持久绑定（L200） | `queueChild()` 入队即唤醒 driver，`bindQueued()` 后落库；claim 早到被 sticky 置 `mixed` 永不恢复 | **是** | **间接** |
| 7 | `tokenStatus` 是 `valid` 不是 `ready`（L246） | 字面量猜错，闸门永不通过 | 否 | 否 |
| 8 | `root_id`/`parent_id` 不是 thread 证据（L292） | 消息级引用当入口身份证据 | 否 | 否 |
| 9 | 闸门要求的事实没有生产者（L338） | 按钮从不发 `executionRoot` 却置 `confirmed` 并隐藏自己 | 否 | 否 |
| 10 | 入站预渲染 vs 出站标记不对称（L385） | mention 已渲染成显示名，模型照抄 | 否 | 否 |
| 11 | 手写规范化丢掉闸门依赖字段（L421） | `normalizeActiveLocus` 漏拷 `childComposition`（类型可选故编译通过）→ 闸门恒真 | **间接** | 否 |
| 12 | `toolFilter` 不覆盖 agent 自有 scope（L518） | own 层注册在 filter 之外；`subagent` 因 `modelSelectionSettings` 落 own 层；后代组合来自委派请求不受 child filter 约束 | **是** | **是** |
| A1 | `ctx.inject()` 回调异步（L576） | 注册后同步断言模式本身不成立 | 否 | 否 |
| A2 | `dsh.client` 与 client bundle 须同批 sync（L625） | 声明与部署不同步 | 否 | 否 |

**(b) 判定依据（原文）**：
- #5 L182-185：`mixed` 判据"防止 **GUI 输入或父会话 steer** 混入飞书轮次"；
  "**真危险**：`user` 来源但不在 Delivery 表里 = **GUI 提问、父会话 steer**"
  —— 该闸门存在的**唯一动机**就是父是用户会话。
- #12 L565-568（修复方案）："**给 child 选组合时不要继承 Host 默认或用户可改的
  preset**。修复把 locus 主会话固定为 Pet 自有的 `dsh-pet-executor`（其委派行没有
  该开关），不再取 Host 默认" —— 修复本身即"让主会话不再是用户可改的会话"。

**(a) 判定依据（原文）**：
- #6 L214-216：调用链固有顺序 `queueChild()`（"driver 立刻被唤醒"）→
  `bindQueued()`（"此时才写入持久层"），L212 明述竞态"**必然发生**"——
  该竞态由 subagent child 的入队/唤醒链决定。
- #12 L555-558：子代组合来自**委派请求**，"子代经 `composeFrom` 绑到 preset 的
  standing key，结构上不在父 child 的 own 层链上，所以「把 toolFilter 传给后代」
  **没有载体**"。

#### 统计 **[实测]**

| 类别 | 数量 | 编号 |
|---|---|---|
| 条目总数 | 14 | #1–12 + A1–A2 |
| 与 (a) 直接相关（"是"） | **2** | #6, #12 |
| 与 (a) 间接相关 | 2 | #5, #11 |
| 与 (b) 直接相关（"是"） | **2** | #5, #12 |
| 与 (b) 间接相关 | 1 | #6 |
| **与 (a) 或 (b) 直接相关（去重）** | **3** | #5, #6, #12 |
| 与两者均无关 | **9** | #1,2,3,4,7,8,9,10 + A1,A2 |

**读数：14 条真实故障中 3 条（21.4%）根因直接由这两个结构前提产生**；
若计入间接相关则 5 条（35.7%）。

#### 补充：`dsh.yaml` note 与 patch commit 记录的同类事故

- `d984a998`（09-22 真机验收）：冷恢复漏传 `settlementNotice` → 重启后 silent 失效，
  父会话收到 **4 条结算通知**。commit message 原文："这个盲区与 independent-v1
  不可移除的理由是同一个：冷恢复要能独立重建子代的全部创建期语义。**静态审查没发现，
  是真机端到端验收抓到的**。" —— 该故障的**可观测症状**（父会话被结算通知打断）
  正是 (b) 的直接产物。
- `7347413f`（09-23）："线上现象是「两个 bot 同群只有一个回」…子会话驻留不再被当作
  代际可用性（复用/重建/重放三处根因）" —— 与 (a) 相关。

---

## 2. 改造成本（方案 B）

### 2.1 代码触及面

#### `parentSessionId` 出现次数与语义分布 **[实测]**

```
grep -rn "parentSessionId" packages/dsh-pet/src/host/locus/ | wc -l   → 298
grep -rn "parentSessionId" packages/dsh-pet/src/            | wc -l   → 551
grep -rn "mainSessionId"   packages/dsh-pet/src/host/locus/ | wc -l   →  41
grep -rn "mainSessionId"   packages/dsh-pet/src/            | wc -l   →  45
```

（与上游 agent 的测量完全一致；`mainSessionId` 41 vs 45 的差异仅为
`host/locus/` 与全 `src/` 的口径差。）

`parentSessionId` 在 locus 内的分布（`grep -rc`，仅列非零）：

| 文件 | 次数 | 文件 | 次数 |
|---|---|---|---|
| controller.ts | **69** | resolution.ts | 8 |
| persistence.ts | **67** | admission.ts | 6 |
| child.ts | **49** | controller-persistence-adapter.ts | 6 |
| repository.ts | **40** | control.ts | 5 |
| management.ts | **28** | aggregate.ts / child-delivery.ts / dsh-port.ts | 各 4 |
| prepublication-staging.ts | 3 | reconcile.ts | 2 |
| composition.ts / context-repository.ts / persistence-helper.ts | 各 1 | | |

**语义分布抽样 [实测]**：

| 语义类别 | 计数 | 测量命令 |
|---|---|---|
| 作为 locus 记录字段 / 身份比较 | ~150 | `grep -rn "record.parentSessionId\|\.parentSessionId ===\|parentSessionId:"` |
| 作为函数参数 | ~102 | `grep -rn "parentSessionId[:)]" \| grep -c "("` |
| 索引键派生（`parentIndexKey`/`defaultQaIndexKey`） | 6 | `grep -rn "parentIndexKey\|defaultQaIndexKey"` |
| 主会话可达性解析（`resolveMainParent`） | 10 | `grep -rn resolveMainParent` |
| 归档探测（`isArchivedSession`） | 3 | `grep -rn isArchivedSession` |

**关键语义观察**：`parentSessionId` **不是单纯的外键**。`repository.ts:870-893`
提供三个同义读方法（`listLociByParent` / `listByParentSession` / `listLociForParent`），
`persistence.ts:373-384` 用它派生两类**持久索引键**（`parent-loci`、`default-qa`）。
生产库中这两类索引实测共 **12 行**（见 2.2）。即 `parentSessionId` 同时是
**身份、索引键、和可达性判据**三重角色，改语义会同时触及这三面。

#### `hierarchy.ts` 中 auto/explicit 特判规模 **[实测]**

`hierarchy.ts` 共 **300 行**，其中 `mainSessionId` 出现 10 次。分支逻辑：

| 位置 | 内容 |
|---|---|
| L39 | `source: 'auto' \| 'explicit' \| 'qa-created'` 三值枚举 |
| L52 | `origin: 'inherited' \| 'explicit' \| 'group-auto'` 三值枚举 |
| L56-68 | `HierarchyRefusal` **6 个拒绝原因**（其中 `group-invalid`/`group-stopped`/`group-retired`/`default-workspace-unavailable`/`group-provisioning-unavailable` 5 个与 main 身份/状态直接相关） |
| L184-202 | 既有 group 的 state 三态特判（invalid/stopped/retired 各自措辞） |
| L206-215 | **explicit 分支**：`/bind` 命名显式源时直接建 group，跳过自动 main |
| L217-239 | **auto 分支**：需 defaultWorkspace + provisioning 两个前置，否则 refuse |
| L260-270 | topic vs chat 分叉：`isTopic ? undefined : explicit`（显式绑定的 topic **不得**把自己的源提升为 group 默认） |
| L274-297 | endpoint 级解析：explicit → `origin:'explicit'`；否则 `isTopic ? 'inherited' : 'group-auto'` |

**特判密度估算 [估算]**：auto/explicit/inherited 三路分支贯穿 L184–L297 约
**114 行**（占该文件 38%）。依据：这是 `ensureGroup` + `ensure` 两个函数的
主体，且每个分支点都同时读 `source`/`origin`/`state` 三个枚举。

全 locus 目录的 auto/explicit 特判点（上游 agent 提供、本文复核确认 **[实测]**）：

| 位置 | 代码 |
|---|---|
| `aggregate.ts:166` | `return source === 'auto' \|\| source === 'inherited'` |
| `controller.ts:601` | `if (explicitParent !== undefined && existing.source === 'explicit')` |
| `persistence.ts:3486` | `(record.source === 'qa-created') !== (input.defaultQaForParentSessionId !== undefined)` |
| `repository.ts:324` | `if (input.source === 'explicit' && isAutomaticSource(current.source))` |
| `repository.ts:330` | `if (current.source === 'explicit')` |
| `repository.ts:456` | `if (current.source === 'explicit')` |

#### `persistence.ts`（4056 行）与 main session 身份相关的面 **[实测]**

| 项 | 值 |
|---|---|
| `parentSessionId` 出现 | 67 次 |
| `mainSessionId` 出现 | 16 次 |
| domain version | `PET_DOMAIN_VERSION = 15`（`spec.ts:105`） |

`mainSessionId` 的 16 处集中在**两个语义簇**：

1. **provisioning 补偿**（L2781/2799/2809/2810）：`mainSessionId` 是补偿器三件套
   （chat / childSession / mainSession）之一，`refs.mainSessionId` 存在才能回收自动建的 main。
2. **一致性断言**（L3346/3352/3364/3515/3563-3569）：5 处 `PROVISIONING_CONFLICT`
   断言，核心不变量是 **`group.mainSessionId === record.parentSessionId`**
   （L3515、L3563、L3566）。方案 B 反转 `/bind` 语义后，这条等式的含义必须重新定义
   —— 这是迁移面上最硬的一处。

`spec.ts` 中 locus 相关 schema 的 main 身份字段：
- L558 `parentSessionId: z.string().min(1)`（**必填**，locus 行核心字段）
- L937-938 `resourceRefs: { parentSessionId?, mainSessionId? }`（provisioning WAL）
- L591-594 topic/chat 的 `parentLocusId` 互斥校验

#### `controller.ts`（1977 行）ensure/bind 路径 **[实测]**

| 方法 | 行号 | 说明 |
|---|---|---|
| `ensureGroup` | 534 | 群级建树 |
| `ensureTopic` | 577 | 话题级建树 |
| `createOrOpenDefaultQa` | 661 | 默认 Q&A（带 `parentSessionId`，复用**当前会话**作 main） |
| `ensureDefaultQa` | 775 | |
| `rebuildLegacyEndpoint` | 786 | |
| `rebuildExplicit` | 831 | |
| `replaceAutomaticGroupParent` | 973 | 改绑 |
| `bindExplicitGroup` | 984 | **`/bind` 入口** |
| `ensureGroupLocked` | 990 | |
| `provisionGroupLocked` | 1009 | |
| `provisionChildLocus` | 1126 | |
| `replaceInheritedTopicParentLocked` | 1193 | |

`parentSessionId` 在 controller 出现 **69 次**，其中 L452-460 是显式参数一致性校验
（`INVALID_PARENT`：`显式 parentSessionId 参数不一致`），L480-486 是
`assertSessionShape` 的父身份断言。

`/bind` 的解析与分发点 **[实测]**：`admission.ts:416`（`'/bind' | '-b' | '--bind'`）、
`qa/command.ts:16`（`BIND_VERB`）、`channel/pipeline.ts:104,305`（`bindCommand` port）。
注意 `qa/` 与 `channel/pipeline.ts` 按 BACKLOG B039 已是**死代码**（约 2336 行未被
`index.ts` 装配）。

#### 文件级改动面汇总 **[实测]**

```
grep -rl "parentSessionId\|mainSessionId" packages/dsh-pet/src/  | wc -l  → 46 文件
                                       同上 | xargs wc -l               → 34,311 行
  其中 locus 目录内                                                      → 18 文件
  其中 locus 目录外                                                      → 28 文件 / 20,006 行
grep -rl "parentSessionId\|mainSessionId" packages/dsh-pet/test/ | wc -l  → 57 文件
                                       同上 | xargs wc -l               → 23,283 行
```

**locus 目录外的 28 个文件**跨 6 个子系统：`client/`（5）、`collaboration/`（9）、
`inquiry/`（2）、`ledger/`（5）、`channel/`（1）、`host/`（3: routes/spec/index）、
`qa/`（1，死代码）、`wire.ts`。即 **main session 身份已渗出 locus 边界**，
不是一个局部改造。

### 2.2 数据迁移面（生产库实测）

测量方法：`cp ~/.dsh/plugins/dsh-pet/state.sqlite /tmp/pet-snap.sqlite` 后查询
（原库被 `PRAGMA locking_mode = EXCLUSIVE` 持有，Host 运行中不能直连）。

| 表 | 行数 |
|---|---|
| `u_dsh_pet_loci` | **16** |
| `u_dsh_pet_locus_indexes` | **40** |
| `u_dsh_pet_locus_deliveries` | **53** |
| `u_dsh_pet_locus_operations` | **354** |
| `u_dsh_pet_locus_permission_audit` | 1 |
| `u_dsh_pet_locus_switch_notices` | 0 |
| `u_dsh_pet_chat_bindings` | 0（legacy，已不读） |
| `u_dsh_pet_ledger_item` | 1 |
| domain version（`select * from units`） | `dsh_pet\|15` |

**16 条 locus 的 source 分布 [实测]**：

| source | 行数 | 语义 |
|---|---|---|
| `auto` | **3** | Pet 自动建的 main |
| `explicit` | **3** | `/bind` 征用的会话 |
| `inherited` | **5** | topic 继承 group 默认 |
| `qa-created` | **5** | Pet 面板建群，复用**当前会话**作 main |

**state 分布 [实测]**：`active` 2 / `invalid` 10 / `stopped` 4
—— 即生产库中 **87.5%（14/16）的 locus 已不可用**。

**parentSessionId 分布 [实测]**：16 条 locus 指向 **8 个不同 parent session**。
按 source 分：`auto`→3 个、`explicit`→1 个、`inherited`→2 个、`qa-created`→4 个。

**关键迁移风险 [实测]**：`session-85620d77-e1a8-4d80-b5d9-66a481bda3c5` 作为
parent 出现 **5 次**（4 条 inherited + 1 条 qa-created），而仓库中存在
worktree 目录 `.worktrees/at-bot-session-85620d77-e1a8-4d80-b5d9-66a481bda/`
—— **同一 id**。这直接证明「用户自己正在工作的会话被征用为 locus 主会话」
在生产中真实发生，且是最高频的 parent。方案 B 要把这 5 条重新指向 Pet 自建
协作主会话，属于**语义迁移而非字段搬迁**。

**index 表的 40 行按 kind 分布 [实测]**：
`child-locus` 16 / `endpoint-current` 12 / `parent-loci` **8** / `default-qa` **4**。
后两类（共 **12 行**）的键**由 `parentSessionId` 直接派生**
（`persistence.ts:373-384`），改 parent 身份必须重建这 12 行。

**迁移机制 [实测]**：`packages/dsh-pet/scripts/` 共 6 个脚本 / 1204 行：

| 脚本 | 行数 | 用途 |
|---|---|---|
| `migrate-state-version.mjs` | 215 | v2..v14 → v15 版本重戳 |
| `repair-truncated-keys.mjs` | 333 | NUL 行键截断离线修复 |
| `verify-storage-cutover.mjs` | 157 | |
| `preflight-storage-cutover.mjs` | 195 | |
| `observe-settlement-isolation.mjs` | 253 | |
| `cutover-backup.mjs` | 51 | |

范式（`migrate-state-version.mjs:26` 头注释）：**停 Host → 备份 →
`--dry-run` → `--yes`**。该脚本必须作为独立进程存在的原因（L4-12）：
SQLite 以 `locking_mode = EXCLUSIVE` 打开，in-process 迁移在 Host 运行时拿不到文件。

**最重要的迁移事实 [实测]**（`migrate-state-version.mjs:15-25`）：
v2→v15 的**全部 13 次版本跳变都是纯加表/加字段**，原文
"**No existing row or log is converted, cleared, or rewritten**"。
方案 B 若要改写 16 条 locus 的 parent 身份 + 重建 12 行索引键，
将是该 domain **史上第一次语义性数据转换** —— 没有同类历史基线可参照，
现有 6 个脚本全部是"重戳/修复/核验"范式，没有一个做过行内容转换。

### 2.3 测试重做面 **[实测]**

```
ls packages/dsh-pet/test/ | grep -c locus     → 47 文件
ls packages/dsh-pet/test/ | wc -l             → 161 文件（locus 占 29.2%）
wc -l packages/dsh-pet/test/*locus*           → 18,599 行
wc -l packages/dsh-pet/test/*.ts              → 52,533 行（locus 占 35.4%）
grep -rl "parentSessionId\|mainSessionId" test/ → 57 文件 / 23,283 行
```

47 个 locus 测试文件中，与主子结构直接相关的（按文件名判定）：
`locus-hierarchy` / `locus-controller` / `locus-controller-races` /
`locus-controller-persistence-adapter` / `locus-persistence` / `locus-repository` /
`locus-resolution` / `locus-child` / `locus-child-delivery` / `locus-startup-recovery` /
`locus-reconcile` / `locus-architecture-acceptance` / `locus-sibling-boundary` /
`locus-production-transaction-gate` / `locus-on-demand-provisioning` —— **15 个**。

**估算**：57 个测试文件（23,283 行）需逐一复核，其中 15 个核心文件需实质重写。
依据：这 57 个文件是 `grep` 出的**实际引用** parent/main 身份的文件，语义反转
必然使其断言失效；15 个核心文件的判定依据是文件名直接对应主子结构模块。

### 2.4 验收成本的历史基线 **[实测]**

`openspec/changes/archive/` 共 **71** 个归档变更，其中 locus 相关 **9** 个：

| change | 任务数 | 已完成 | 文档行数 | 真机提及 | 转入/未实现 |
|---|---|---|---|---|---|
| `2026-09-11 pet-unified-locus-collaboration`¹ | **64** | 59 | **1408** | 1 | **10** |
| `2026-09-15 pet-locus-independent-child` | **53** | 51 | 492 | 0 | 2 |
| `2026-09-15 pet-locus-management-redesign` | 44 | 44 | 441 | 0 | 0 |
| `2026-09-15 pet-locus-multi-binding` | **77** | 0 | **1423** | 5 | 0 |
| `2026-09-15 pet-locus-on-demand-tree` | 22 | 22 | 260 | 0 | 0 |
| `2026-09-18 pet-locus-intent-triage` | 48 | 48 | 574 | 3 | 0 |
| `2026-09-18 pet-locus-write-full-access` | 19 | 19 | 212 | 2 | 0 |
| `2026-09-18 pet-locus-write-grant-reachable` | 17 | 17 | 182 | 1 | 0 |
| `2026-09-19 pet-locus-delivery-safety-hardening` | 35 | 35 | 410 | 5 | 0 |
| **合计** | **379** | | **5402** | | |

¹ 目录名 `2026-09-18-pet-unified-locus-collaboration`，含 `checking/`
（`plan.yaml` 169 行 + **8 个 trail** T1–T8 + 2 个 gate 文件）。

**两个指定基线的详细成本**：

**A. `pet-unified-locus-collaboration`（方案 B 的最近同等规模参照）**
- 任务 **64**（59 完成，5 未实现）**[实测]** `grep -c '^- \[.\]' tasks.md`
- 文档 **1408 行**
- 验收：`checking/` 下 **8 个 trail**，结果 T1–T8 全部 `passed`，
  但其中 1 个 gate 标 `missing`、多个标 `not_needed`
- **转入其它条目/未实现标记 10 处**
- 落地 commit `0c2f21fc` **[实测]** `git show --stat`：
  **134 files changed, 37,286 insertions(+), 1,004 deletions(-)**

**B. `pet-locus-independent-child`**
- 任务 **53**（51 完成，2 未实现 —— 其中 tasks 8.3 的 fault-injection 矩阵
  如实标记未实现并转入 BACKLOG **B038**）
- 文档 492 行
- 落地 commit `478f09cb` **[实测]**：**9 files changed, 883 insertions(+), 95 deletions(-)**
  （注：该 commit 仅 compat 部分；change 全量分散在 16 个 commit，
  `git log --grep=independent -i | wc -l` → 16）

**C. `pet-locus-delivery-safety-hardening`（真机验收记录最完整）**
- 任务 35（全完成），验收文档 `docs/notes/pet-locus-delivery-safety-hardening-live-acceptance.md` **264 行**
- 7 个验收用例 A–G 的实测结果 **[实测]**（该文件 L87-93）：

| 用例 | 结果 |
|---|---|
| A 合法回复与唯一出口 | PASS |
| B reference-only 静默 | PASS |
| C ambiguous 澄清→新 Delivery | PASS |
| D 多人 backlog 串行 | PASS |
| E GUI/user mixed fail closed | **未命中（判据未被执行）** |
| F 图片读取与文本模型降级 | PASS |
| G 旁路出站负测 | **FAIL → 最小修复后新 locus 复验 PASS** |

  文档 L3 记录："A/B/C/D/F PASS，G 首轮 FAIL"，且 L36 有"首轮真机执行结果"、
  L63 有"真机验收结果（重启后）"—— 即**至少 2 轮真机**。

**历史成本区间（9 个 locus 改造）[实测 + 估算]**：

| 指标 | 区间 | 中位 |
|---|---|---|
| 任务数 | 17 – 77 | 44 |
| 文档行数 | 182 – 1423 | 441 |
| 单 change 改动文件数 | 9 – 134 | **[估算]** ~40 |
| 单 change 改动行数 | ~1k – 38k | **[估算]** ~5k |
| 真机验收轮数 | 1 – 2+ | **[估算]** 2 |

**结论：方案 B 的一次性改造成本，以 `pet-unified-locus-collaboration`
为最贴近基线 —— 64 任务 / 1408 行文档 / 134 文件 / 37k 行改动 / 8 个真机 trail。**
理由：两者都是"改 locus 主子结构语义"，而非加功能或改局部。

### 2.5 BACKLOG 中与 locus 相关的已知缺陷 **[实测]**

| 编号 | 标题 | 状态 | 与方案 B 的关系 |
|---|---|---|---|
| **B036** | 拉 bot/建群不应有任何 locus 副作用，整棵树按首个 @ 构建 | **已完成**（2026-09-15，22/22 任务） | 其"要点"明述：两阶段 provisioning 分离是为"发布失败时有可回滚的资源句柄"，**改按需创建需要重新设计失败补偿** —— 与 `createIdleContinuable` 退役是同一条（README:126） |
| **B040** | provisioning 失败补偿只在 Host 重启时跑，运行中永久阻塞同一 endpoint | 想法 / **P1** | 根因：`findBlockingProvisioningOperation`（`persistence.ts:3124`）只排除 `committed`/`compensated`，`failed` 仍阻塞；唯一转 `compensated` 的路径 `reconcileStartup`（`persistence.ts:2735`）只在启动时跑。**影响全部 provisioning kind**，含 `replaceAutomaticGroupParent`（改绑）—— 方案 B 的 `/bind` 反转必然经过这条路径 |
| **B039** | 清理旧 QA 模型的死代码 | 想法 / P2 | `src/host/qa/`（9 文件）+ `channel/pipeline.ts` 共 **~2336 行**未被 `index.ts` 装配。其中 `qa/command.ts:16` 的 `BIND_VERB` 与 `pipeline.ts:104,305` 的 `bindCommand` 都在 `/bind` 的 grep 结果里 —— 会**虚增**方案 B 的改动面估算 |

另：**B038**（Delivery 崩溃窗口 fault-injection 矩阵，P1）是
`pet-locus-independent-child` tasks 8.3 未实现转入的，其背景原文：
"2026-09-15 的真实验收已经证明，这类「跨越边界的不一致」正是**单测最容易漏掉、
而真实链路必然命中**的一类问题。"

---

## 3. 改造后（方案 B）的持续维护成本

### 3.1 四个 seam 的退役可行性逐个核实

| seam | 生产消费点 **[实测]** | 方案 B 下能否退役 | 判据 |
|---|---|---|---|
| `settlementNotice:'silent'` | **9** 处（全在 `child.ts`：93/106/133/886/999/1471/1571/1590/1623） | **可以（条件性）** | 论证前提是"父 = 用户正在使用的主会话"故 `notifySettlement` 走 `parent.steer()`。上游实际代码 `parent.status === 'idle' ? 'queue' : 'steer'`（memex 卡片实测）。父若是 Pet 自建 standby（几乎恒 idle）→ 走 `queue`，在自己会话开一轮。**前提由架构消除，不必等上游** |
| `contextMode:'independent-v1'` + `toolFilter` | **6** + **6** 处（`child.ts` 为主，另 `wire.ts:220`、`client/settings.tsx:728`） | **不能** | README:125：它解决"父后来换了 preset，冷恢复重建不出原组合"。方案 B 的 locus 协作主会话是 Pet 自建的，但**若该会话在侧边栏可见、用户可进去切 preset/模型，该条件即失效**。方案 B 未声明要隐藏该会话 → 前提不成立。另 `toolFilter` 与 `independent-v1` **共用 descriptor v5，拆不干净**（`dsh.yaml` note 原文） |
| `createIdleContinuable` | **7** 处（`child.ts` 6 + `index.ts:1730`） | **不能（不因方案 B 改变）** | README:126：绕开需把顺序反转成"先留 id → 先提交 locus 行 → 首条 Delivery 作创建 prompt"，但"反转后行可能指向不存在的 child"。**与 B036 是同一条**，其退役入口是失败补偿重新设计，与主会话身份无关 |
| `withLiveContinuableChildSession` | **6** 处（`child.ts`） | **绝对不能** | README:127：泛化 Session 路由**有意**拒绝 `origin === 'subagent'` 的 child。**方案 B 明确保留"locus 协作主会话 → locus 子会话"的 DSH subagent 父子边**（题述"（不变）"）→ 子会话仍是 subagent child → 该 seam 结构性不可退 |

**独立核实 `withLiveContinuableChildSession` 的真实消费链 [实测]**：
`child.ts:1164` 暴露公开方法 `withChildSession` → 唯一生产调用点
`channel/locus-controller.ts:1678`（在 `resolveLivePolicy` 即 sandbox 策略核验路径中）。
`locus-controller.ts:1665` 的守卫同时要求 `child.withChildSession !== undefined`
和 `resolveLivePolicy !== undefined`，缺失则返回
`'live sandbox policy verification capability is unavailable'` 且
`repairable: false`（注释：能力对整个组合缺失，新 child 继承同样的缺口）。
即：**该 seam 一旦缺失，locus 的写权限核验能力整体不可用**。

#### 退役收益小结 **[实测]**

| 项 | 值 |
|---|---|
| 可退役 seam 数 | **1 / 4**（仅 `settlementNotice`，且需额外保证 standby 恒 idle） |
| 可退役的消费点 | 9 / 28（32.1%） |
| 对应 patch hunk **[估算]** | ~8 / 33（24%）。依据：patch 触及 6 个源码文件，`settlementNotice` 相关集中在 `types.ts`/`descriptor.ts`/`continuation.ts`/`continuation-activation.ts` 的 activation 构造与 descriptor 还原路径，按 `d984a998`（+27/−2，2 处冷恢复）与初版占比推算 |

**决定性结论**：`withLiveContinuableChildSession` 不可退 ⇒ patch 不能完全删除 ⇒
`hostRuntimeCompatibility` 机制**必须保留** ⇒ §1.4 的
**740 行构建工具链、21 个外部进程、26 个校验闸门、2.2 GB 构建体量、
锁机制、fail-closed 启动语义，以及 §1.3 的 5 步升级清单，全部原样留下**。

### 3.2 新增维护负担：三层结构的生命周期同步

方案 B 引入第三层（用户工作现场 → locus 协作主会话 → locus 子会话），
其中第一层边是"弱关联（仅 Pet 持久记录，无 DSH runtime 边）"。
无 runtime 边意味着**归档/删除/改名的级联必须由 Pet 自己实现**——
DSH 不会再代为传播。

现有同类模块规模 **[实测]**：

| 模块 | 行数 | 职责 |
|---|---|---|
| `switch-notice.ts` | **199** | 来源切换的持久通知 |
| `reconcile.ts` | **192** | 启动对账 |
| `startup-recovery.ts` | **185** | 启动恢复 |
| `expiry-scheduler.ts` | **164** | 过期调度 |
| `retirement.ts` | **146** | 退役 |
| （5 模块合计） | **886** | |

**新增代码估算 [估算]：1 个新模块 180–200 行 + 现有模块改动 ~150 行 ≈ 330–350 行。**

估算依据（三条，均可复核）：
1. **规模类比**：新模块职责（监听第一层会话的归档/改名、维护弱关联记录、
   在关联失效时给出诊断）与 `switch-notice.ts`（199 行）最接近 —— 后者也是
   "观测一个会话身份变化 → 持久记录 → 通知"。取 180–200 行。
2. **现有级联的改动点**：`grep -rn "archiv" host/locus/*.ts` → **108 处，
   分布在 10 个文件** **[实测]**。当前"主会话归档 → locus 失效"的级联是
   **DSH runtime 代为保证的**（`resolution.ts:117-122` 原文：
   "宿主 refuses to resume an archived Session，**所以没有这个事实，
   主会话被归档的 endpoint 会继续服务，归档会静默无效**"）。
   方案 B 把第一层的 runtime 边去掉后，这条依赖失去载体，需在新层重建。
3. **`switch-notice` 的现有消费面** `grep -rn "switchNotice\|SwitchNotice" src/`
   → **51 处 [实测]**，说明这类"身份变化通知"模块的接线成本约为其自身行数的
   1/4 量级，故 330–350 行的总估算中包含约 150 行接线改动。

**注意一项不可忽略的负担**：`persistence.ts:3515/3563/3566` 的不变量
`group.mainSessionId === record.parentSessionId` 在三层结构下含义改变
（group 的 main 变成 Pet 自建会话，而"用户工作现场"是另一个弱关联字段）。
这 5 处 `PROVISIONING_CONFLICT` 断言需要重新定义，且它们是
**写入路径的最后一道闸门** —— 改错会让 provisioning 静默接受不一致状态。

### 3.3 若 patch 无法完全退役，改造的维护收益还剩多少

| 维护成本项 | 方案 A | 方案 B | 收益 |
|---|---|---|---|
| patch 行数 | 916 | **[估算]** ~700（−24%） | 部分 |
| patch hunks | 33 | **[估算]** ~25 | 部分 |
| 被 patch 上游包数 | 1 | **1** | **0** |
| seam 数 | 4 | **3** | 1 |
| 升级必做步骤（§1.3） | 5 步 | **5 步** | **0** |
| 构建工具链行数 | 740 | **740** | **0** |
| 外部进程调用 | 21 | **21** | **0** |
| 构建校验闸门 | 26 | **26** | **0** |
| 构建磁盘体量 | 2.2 GB | **2.2 GB** | **0** |
| `hostRuntimeCompatibility` 机制 | 保留 | **保留** | **0** |
| Host 隔离依赖根 | 是 | **是** | **0** |
| 三层生命周期同步代码 | 0 | **+330~350 行** | **负收益** |
| `mixed` 闸门的 (b) 类故障面 | 有 | **消除** | **正收益** |

**量化结论**：

- patch 本体减少 **~24%**（916 → ~700 行）**[估算]**
- **升级流程成本减少 0%** —— 5 步清单每步都是 per-seam 或 per-overlay，
  seam 从 4 降到 3 只让第 3 步（逐个 seam 双向举证）减少 1/4 工作量，
  其余 4 步（版本校验、重新推导、重建 launcher、本方前提复核）**完全不变**
- **构建体系成本减少 0%** —— 740 行 / 21 进程 / 26 闸门 / 2.2 GB 由
  "是否存在 overlay"决定，不由"overlay 多大"决定
- **新增 330–350 行需长期维护的级联代码**

**最重要的一条 [实测]**：§1.2 显示 patch 的 8 次修改中，
**DSH 升版重新推导只占 1 次（12.5%）**，而
**修复缺陷 3 次（37.5%）+ 新增能力 3 次（37.5%）= 75%**。
方案 B 缩小 patch 体积，主要影响的是"升版重新推导"这个**最小**的成本项；
对"缺陷修复"和"新增能力"这两个占 75% 的驱动因素，没有可测量的影响
—— 因为这两类改动源自 locus 自身能力演进，与 patch 大小无关。

---

## 4. 风险量化

### 4.1 "本地测试全绿但真机失败"的历史比例

#### 直接证据（文档明述该模式）**[实测]**

`grep -rn "单测全绿\|测试全绿\|全绿却\|本地测试全绿" docs/notes/` → **3 处**：

| 出处 | 原句 |
|---|---|
| `dsh-plugin-integration-pitfalls.md:274` | "于是测试长期全绿却掩盖了真机必挂。"（#7 tokenStatus） |
| `dsh-plugin-integration-pitfalls.md:487` | "### 为什么单测全绿"（#11 手写规范化漏拷字段） |
| `dsh-plugin-integration-pitfalls.md:608` | "### 为什么测试全绿却真机失败"（A1 `ctx.inject()` 异步） |

另在归档变更中 **[实测]**
`grep -rn "全绿" openspec/changes/archive/` 命中 **215 处**，其中最直接的两条：

| 出处 | 原句 |
|---|---|
| `2026-09-22-shrink-pet-compat-to-minimal/checking/deployed-overlay-drift.md:20` | "**单元测试 3/3 全绿，真机上却完全无效**" |
| `2026-09-22-shrink-pet-compat-to-minimal/checking/batch-b-self-hosted-storage-impl.md:53` | "去掉 `openMedium` 中强制获取锁的 `BEGIN IMMEDIATE`/`COMMIT` 后，测试**仍然全绿**。" |

#### 按故障条目统计 **[实测]**

14 条 pitfall 中，明确记录"测试全绿/无覆盖但真机失败"的：**#7、#11、#12、A1 = 4 条（28.6%）**。

各条的自证原文：
- **#11** L487-496：闸门与规范化在**同一 commit** 里分别改的，"加了判据，没加生产者"；
  字段类型可选故"漏拷**编译通过、类型检查通过**"
- **#12** L573-575："单测要把被禁工具注册在正确的层。既有用例把 forbidden 工具
  全注册在 global 层，于是永远抓不到 own 层豁免 —— **那种绿色是假的**"
- **A1** L608-612：`test/executor-scope.test.ts` 只做**源码字符串匹配**
  （`expect(install).toContain(...)`），"从未真正执行过 `installPetScope`。
  断言的是'代码长这样'，不是'代码能工作'"
- **#5** L196-197 / **#6** L243-244（规则条）："只测单条 claim 会全绿，但真机必挂"
  / "只测「查得到」的顺路径会全绿，真机必挂" —— 这两条虽未列入上面 4 条，
  但同样自述了该模式

若计入 #5、#6 两条自述，则 **6/14 = 42.9%**。

#### 按真机验收用例统计（最精确的一组）**[实测]**

`pet-locus-delivery-safety-hardening` 的 7 个用例（该 change 已完成 35/35 任务、
本地测试全绿后才进入真机）：

| 结果 | 数量 | 用例 |
|---|---|---|
| 首轮 PASS | 5 | A, B, C, D, F |
| 首轮 **FAIL** | **1** | G（旁路出站负测） |
| 判据未被执行 | 1 | E |

**首轮真机失败率 = 1/6 有效用例 = 16.7%**（E 未命中不计入分母）。

用例 G 的失败内容值得单列，因为它**正是 (a) 类根因**：child 工具面无 `bash`
但 `subagent` 可见 → 派生孙代理工具面 30 个含 `bash` → **真的执行成功**
`lark-cli auth status`，即唯一出口可被绕过。这条**本地测试完全测不出**，
因为需要真实派生孙代理并真实调用 lark-cli。

#### patch 层面的比例 **[实测]**

§1.2 的 8 次有效 patch 修改中，**3 次是缺陷修复**，且其中至少 2 次
commit message 明述是真机抓到的：

- `d984a998`："**静态审查没发现，是真机端到端验收抓到的**"
- `7347413f`："**线上现象**是「两个 bot 同群只有一个回」"

**即 patch 修改中 25%（2/8）是真机专属发现。**

#### 综合结论

| 统计口径 | 比例 | 性质 |
|---|---|---|
| pitfall 条目明述测试全绿 | 4/14 = **28.6%** | [实测] |
| （含自述"只测顺路径会全绿"） | 6/14 = **42.9%** | [实测] |
| 真机验收用例首轮失败 | 1/6 = **16.7%** | [实测] |
| patch 修改中真机专属发现 | 2/8 = **25%** | [实测] |
| **加权估计** | **20–30%** | [估算]，依据上面四组实测的收敛区间 |

### 4.2 方案 B 中无法通过本地测试验证、必须真机验收的部分

逐项给出"为什么本地测不出"的机制性理由（非印象）：

| # | 部分 | 为何必须真机 | 证据 |
|---|---|---|---|
| 1 | **standby 主会话是否真的恒 idle** | `settlementNotice` 退役的**唯一**依据是父走 `queue` 而非 `steer`，而分支判据是运行时 `parent.status === 'idle'`。本地 mock 会直接返回 `idle`，**正好掩盖**真实竞态（用户在 GUI 打开该会话、冷恢复期间、并发 Delivery 期间都可能非 idle） | memex 卡片实测上游代码；pitfall A1 L620-622 规则3："判断依赖包的同步性时以实测为准…**mock 通常是同步的，正好掩盖这类缺陷**" |
| 2 | **冷恢复后三层关联是否仍成立** | `d984a998` 的教训：`settlementNotice` 在 descriptor 里正确、runtime 判据也正确，但**冷恢复路径不传该字段** → 重启后失效。"silent 只在「创建后一直驻留」时有效，Host 一重启就失效，**而重启是常态**" | commit `d984a998` message |
| 3 | **弱关联在用户会话归档/改名时的级联** | 当前级联由 DSH runtime 保证（`resolution.ts:117-122`："没有这个事实，主会话被归档的 endpoint 会**继续服务**，归档会**静默无效**"）。去掉 runtime 边后，只有真实归档一个真实会话才能验证 Pet 自建的级联是否接通 | `resolution.ts:117-122` |
| 4 | **`mixed` 闸门在新结构下的行为** | pitfall #5/#6 都是"首轮才复现"或"入队/绑定窗口才复现"的时序缺陷。#5 L196 明述测试必须"**照抄真实首轮的完整 claim 序列**（1 条 Delivery + 3 条注入）。只测单条 claim 会全绿，但真机必挂" | pitfall L196-197, L243-244 |
| 5 | **16 条生产 locus 的迁移正确性** | 这是该 domain **第一次语义性数据转换**（v2→v15 全部纯加表，`migrate-state-version.mjs:15-25`）。现有 6 个脚本无一做过行内容转换，无同类基线。且 `locus_indexes` 的 12 行 parent 派生键必须与 16 条 locus 同时一致 | `migrate-state-version.mjs:15-25`；生产库实测 |
| 6 | **provisioning 失败补偿（B040）在新路径下** | B040 已证：`failed` 操作**永久阻塞同一 endpoint 直到 Host 重启**，且"影响面不止群/话题建树，`replaceAutomaticGroupParent`（改绑）…等所有走 `beginProvisioning` 的路径都共享同一套阻塞判定"。方案 B 的 `/bind` 反转必经改绑路径 | BACKLOG B040 |
| 7 | **子会话工具面/委派逃逸** | pitfall #12 + 用例 G：需真实派生孙代理并真实调用 lark-cli 才能发现。"既有用例把 forbidden 工具全注册在 global 层，于是永远抓不到 own 层豁免——**那种绿色是假的**" | pitfall L573-575；验收文档 L93 |
| 8 | **`independent-v1` 的前提是否真的成立** | 该 seam 保留与否取决于"用户能否进入 Pet 自建会话切 preset/模型"。这是**部署形态问题**（侧边栏可见性），只能在真机 GUI 上确认 | README:125 |

**估算 [估算]：方案 B 至少需要 8 个真机验收场景**，与
`pet-unified-locus-collaboration` 的 8 个 trail 规模相当。
依据：上表 8 项各自有独立的机制性理由，无法合并到同一个 trail
（1/8 是运行时状态、2 是重启、3 是级联、4 是时序、5 是数据、6 是失败路径、
7 是安全边界）。

---

## 5. 两方案成本总表

### 5.1 一次性改造成本（仅方案 B 发生）

| 维度 | 值 | 性质 |
|---|---|---|
| 需改动源文件 | **46** 个（34,311 行内） | [实测] |
| ├ locus 目录内 | 18 个 | [实测] |
| └ locus 目录外 | 28 个（20,006 行，跨 6 子系统） | [实测] |
| 需复核测试文件 | **57** 个（23,283 行） | [实测] |
| └ 需实质重写 | **[估算]** ~15 个 | 依据：文件名直接对应主子结构模块 |
| `parentSessionId` 语义改写点 | **298**（locus 内）/ 551（全 src） | [实测] |
| `mainSessionId` 语义改写点 | **41**（locus 内）/ 45（全 src） | [实测] |
| auto/explicit 特判点 | **6** 处已定位 + `hierarchy.ts` ~114 行分支主体 | [实测] + [估算] |
| `persistence.ts` 不变量需重定义 | **5** 处 `PROVISIONING_CONFLICT` 断言 | [实测] |
| 生产数据迁移 | **16** locus + **12** 行 parent 派生索引键 | [实测] |
| 迁移性质 | 该 domain **首次**语义性转换（v2→v15 皆纯加表） | [实测] |
| 新增迁移脚本 | **[估算]** ~250 行 | 依据：`migrate-state-version.mjs` 215 / `repair-truncated-keys.mjs` 333 |
| 预期任务数 | **[估算]** 55–70 | 依据：9 个 locus 改造区间 17–77，同等规模基线 64 |
| 预期文档行数 | **[估算]** ~1400 | 依据：`pet-unified-locus-collaboration` 1408 |
| 预期改动行数 | **[估算]** ~10k–37k | 依据：`0c2f21fc` 实测 37,286 插入 |
| 真机验收场景 | **[估算]** ≥8 | 依据 §4.2 八项独立机制理由 |
| 预期真机首轮失败 | **[估算]** 1–2 个场景 | 依据 §4.1 实测 16.7%–28.6% |

### 5.2 持续维护成本对比

| 维度 | 方案 A | 方案 B | 差值 |
|---|---|---|---|
| patch 行数 | **916** [实测] | ~700 [估算] | **−216** |
| patch hunks | **33** [实测] | ~25 [估算] | −8 |
| 上游包数 | **1** [实测] | **1** | **0** |
| seam 数 | **4** [实测] | **3** | −1 |
| seam 生产消费点 | **28** [实测] | 19 | −9 |
| 升级必做步骤 | **5** [实测] | **5** | **0** |
| 构建工具链行数 | **740** [实测] | **740** | **0** |
| 外部进程调用 | **21** [实测] | **21** | **0** |
| 构建校验闸门 | **26** [实测] | **26** | **0** |
| 构建磁盘体量 | **2.2 GB** [实测] | **2.2 GB** | **0** |
| `hostRuntimeCompatibility` | 保留 [实测] | **保留** | **0** |
| Host 全局隔离依赖根 | 是 [实测] | **是** | **0** |
| 三层级联代码 | **0** | **+330~350 行** [估算] | **+340** |
| (b) 类结构故障面 | 2 条直接 + 1 间接 [实测] | 消除 | **−3** |
| (a) 类结构故障面 | 2 条直接 + 2 间接 [实测] | **保留**（子会话仍是 subagent child） | **0** |

**净代码量变化 [估算]**：patch −216 行，新增级联 +340 行 ⇒ **净 +124 行需维护的代码**。

---

## 6. 回本周期估算

### 6.1 可量化的持续成本节省

方案 B 相对方案 A，唯一**可测量**的持续成本节省有两项：

**节省项 1：升级时的 seam 举证工作量**

- 实测基线：§1.2 显示 DSH 升版重新推导发生 **1 次 / 43 天**（`89e2d83a`），
  该次对 patch 的改动为 **1701 行**（729+972）
- 升级清单 5 步中，只有第 3 步（逐个 seam 双向举证）随 seam 数缩放
- seam 4 → 3 ⇒ 该步工作量 **−25%**
- **[估算]** 第 3 步占单次升级总工时的 **~30%**。依据：README:105-115 对该步的
  要求最重（需引用 `.d.ts` 行号、覆盖每一项语义，且有一次实测证伪教训），
  而其余 4 步（版本字符串校验、重建 launcher、跑 marker 校验、本方前提复核）
  更程式化
- ⇒ 单次升级节省 **30% × 25% = 7.5%** 的升级工时

**节省项 2：(b) 类结构故障的消除**

- 实测基线：14 条 pitfall 中 **2 条**（#5、#12）根因直接与 (b) 相关，
  另 1 条（#6）间接相关
- 这些故障发生在 **43 天**内（仓库 locus 工作期 09-11 → 09-23，
  pitfall 文档 672 行覆盖同期）
- ⇒ (b) 类故障率 **[实测]** ~2–3 条 / 43 天
- **[估算]** 单条此类故障的排查+修复成本：**2–4 人日**。依据：#12 的修复
  在验收文档中占 L93-137 共 **45 行**记录，含"最小修复+新 locus 复验"两轮；
  #5 的修复需"照抄真实首轮的完整 claim 序列"重写测试
- ⇒ 节省 **4–12 人日 / 43 天** ≈ **0.09–0.28 人日/天**

### 6.2 一次性投入估算

| 项 | 人日 | 依据 |
|---|---|---|
| 实现（46 文件 / 298+41 处语义改写） | **[估算]** 15–25 | 类比 `pet-unified-locus-collaboration` 64 任务 |
| 测试重做（57 文件复核 / ~15 实质重写） | **[估算]** 8–12 | 23,283 行测试面 |
| 迁移脚本（首次语义转换，无基线） | **[估算]** 3–5 | `migrate-state-version.mjs` 215 行 + 无先例风险 |
| 三层级联新模块（330–350 行） | **[估算]** 4–6 | 类比 `switch-notice.ts` 199 行 |
| 文档/规范（~1400 行） | **[估算]** 4–6 | 基线 1408 行 |
| 真机验收（≥8 场景，含 1–2 首轮失败返工） | **[估算]** 6–10 | 基线 8 trail；失败率 16.7–28.6% |
| **合计** | **40–64 人日** | |

取中位 **~50 人日**。

### 6.3 回本周期

按 §6.1 两项节省合计：

| 节省项 | 日均节省（人日/天） |
|---|---|
| 升级 seam 举证（7.5% × 单次升级成本） | **[估算]** ~0.01 |
| (b) 类故障消除 | **[估算]** 0.09–0.28 |
| 减：新增 340 行级联代码的维护 | **[估算]** −0.02 ~ −0.05 |
| **净日均节省** | **0.08–0.24** |

升级 seam 举证一项的推算：单次升级 **[估算]** 5–8 人日
（依据 `89e2d83a` 全仓 120 文件 / 3264+3077 行改动），
频率 1 次/43 天 ⇒ 0.12–0.19 人日/天；其中节省 7.5% ⇒ **~0.01 人日/天**。

**回本周期 = 50 ÷ (0.08 ~ 0.24) = 208 ~ 625 天**

| 情景 | 净日均节省 | 回本周期 |
|---|---|---|
| 乐观（故障率取高、投入取低：40 人日） | 0.24 | **~167 天（5.5 个月）** |
| 中位（50 人日） | 0.16 | **~313 天（10.3 个月）** |
| 保守（故障率取低、投入取高：64 人日） | 0.08 | **~800 天（26 个月）** |

### 6.4 回本估算的三个关键限定

1. **回本周期对"(b) 类故障率"极度敏感**。该项占净节省的
   **~90%**（0.09–0.28 中的绝大部分），而它的实测样本只有
   **2–3 条 / 43 天**。样本量小 ⇒ 区间宽。若未来 (b) 类故障不再出现
   （例如 #12 的修复"把 locus 主会话固定为 `dsh-pet-executor`"已部分
   消除了该前提），则该项节省趋近 0，**回本周期趋于无穷**。

2. **构建体系成本（占持续成本的最大头）节省为 0**。740 行工具链、
   21 个外部进程、26 个闸门、2.2 GB 体量由"是否存在 overlay"决定。
   只要 `withLiveContinuableChildSession` 不可退（§3.1 已证：
   方案 B 明确保留 subagent 父子边 ⇒ 结构性不可退），这部分**一分不省**。

3. **patch 修改的主要驱动因素不是 patch 大小**。§1.2 实测：
   8 次修改中"新增能力"3 次 + "修复缺陷"3 次 = **75%**，
   而"DSH 升版重新推导"仅 1 次 = **12.5%**。
   方案 B 缩小 patch 只作用于后者。若按此权重修正，
   patch 相关的持续成本节省应再乘以 ~0.125 ⇒ 几乎可忽略。

---

## 7. 无法测量的项目及原因

| 项 | 为何不可测 |
|---|---|
| 真实人日投入 | 仓库无工时记录。§6.2 全部是[估算]，依据是任务数/文件数/历史 change 规模的类比，不是实测工时。**这是本报告最大的不确定来源** |
| 单次 DSH 升级的真实工时 | `89e2d83a` 只能测出改动量（120 文件 / 6341 行），无法反推工时 |
| 验收"轮数"的精确值 | tasks.md 无结构化轮次字段。§2.4 用 `grep -c "真机\|实机"` 近似（区间 0–5），且 `pet-locus-delivery-safety-hardening` 需读正文才能确认"≥2 轮"。归档变更的 `checking/` 目录只有 1/9 个 change 有（`pet-unified-locus-collaboration`），其余无结构化验收记录 |
| 方案 B 退役后 patch 的精确行数 | 需真实实施 `settlementNotice` 退役才能测。§3.1 的 ~700 行是按 hunk 分布[估算] |
| `.upstream` 重建的真实耗时 | 未在本次测量中执行完整冷构建（会触发 21 个外部进程、1.7 GB clone+install）。README:75 只记录了固定的包管理器版本，无耗时记录 |
| 用户会话被征用造成的"体验成本" | 无遥测。只能间接观察到 `d984a998` 记录的"父会话收到 4 条结算通知"这一个实例 |
| 生产库 16 条 locus 中有多少 parent 是"用户正在工作的会话" | 只能证明 `session-85620d77`（5 条 locus 的 parent）同时是 worktree 名 ⇒ **至少 5/16 = 31.3%** 是用户工作会话。其余 7 个 parent session 无法从库内判定其是否为用户会话，需交叉查 DSH session 元数据（本次未访问） |
| `hierarchy.ts` 特判的"精确"行数 | 分支逻辑交织，无法机械切分。§2.1 的 114 行是按函数边界[估算] |

---

## 附录：全部测量命令

```bash
# 口径更正：upstream 是否干净
cd packages/dsh-pet/compat/subagent/.upstream && git status --short
git log --oneline -1
git show HEAD:packages/subagent/subagent/src/types.ts | grep -c settlementNotice   # → 0

# §1.1 patch 规模
wc -l packages/dsh-pet/compat/subagent/settlement-notice.patch                     # → 916
grep -c '^@@'    packages/dsh-pet/compat/subagent/settlement-notice.patch          # → 33
grep -c '^--- a/' packages/dsh-pet/compat/subagent/settlement-notice.patch         # → 9

# §1.2 patch 历史
git log --format="%h | %ad | %s" --date=short -- .../settlement-notice.patch       # → 9 条
for c in 0c2f21fc 24d1f55b 478f09cb 996a6568 89e2d83a 5256ee4d 7347413f d984a998; do
  git show $c:.../settlement-notice.patch | wc -l; done
git show --numstat --format= 89e2d83a -- .../settlement-notice.patch               # → 729/972

# §1.4 构建体系
wc -l build.mjs build-launcher.cjs compat-build-lock.cjs compat-run.cjs            # → 740
grep -cE '^\s*run\(' build.mjs                                                     # → 11
grep -cE 'run\(|runNpm\(' build-launcher.cjs                                       # → 10
grep -c 'fail(' build.mjs                                                          # → 17
grep -cE 'fail\(|throw new' build-launcher.cjs                                     # → 9
du -sh .upstream .launcher-builds lib .                                            # → 1.7G 561M 940K 2.2G

# §2.1 改动面
grep -rn parentSessionId packages/dsh-pet/src/host/locus/ | wc -l                  # → 298
grep -rn mainSessionId   packages/dsh-pet/src/host/locus/ | wc -l                  # → 41
grep -rl "parentSessionId\|mainSessionId" packages/dsh-pet/src/  | wc -l           # → 46
grep -rl "parentSessionId\|mainSessionId" packages/dsh-pet/src/  | xargs wc -l     # → 34311
grep -rl "parentSessionId\|mainSessionId" packages/dsh-pet/test/ | wc -l           # → 57

# §2.2 生产数据（Host 持 EXCLUSIVE 锁，必须先快照）
cp ~/.dsh/plugins/dsh-pet/state.sqlite /tmp/pet-snap.sqlite
sqlite3 /tmp/pet-snap.sqlite "select count(*) from u_dsh_pet_loci;"                # → 16
sqlite3 /tmp/pet-snap.sqlite "select json_extract(value,'\$.source'),count(*) \
  from u_dsh_pet_loci group by 1;"                                  # auto3 explicit3 inherited5 qa5
sqlite3 /tmp/pet-snap.sqlite "select * from units;"                               # → dsh_pet|15

# §2.3 测试面
ls packages/dsh-pet/test/ | grep -c locus                                          # → 47
wc -l packages/dsh-pet/test/*locus*                                                # → 18599

# §2.4 历史基线
for d in openspec/changes/archive/*locus*; do grep -c '^- \[.\]' $d/tasks.md; done  # Σ → 379
git show --stat 0c2f21fc | tail -1                        # → 134 files, +37286 -1004
git show --stat 478f09cb | tail -1                        # → 9 files, +883 -95

# §3.1 seam 消费点
for s in settlementNotice createIdleContinuable independent-v1 \
         withLiveContinuableChildSession toolFilter; do
  grep -rn "$s" packages/dsh-pet/src/ | wc -l; done                                # → 9 7 6 6 6

# §3.2 级联模块
wc -l host/locus/{switch-notice,retirement,reconcile,startup-recovery,expiry-scheduler}.ts  # → 886
grep -rn "archiv" packages/dsh-pet/src/host/locus/*.ts | wc -l                     # → 108

# §4.1 风险
grep -rn "单测全绿\|测试全绿\|全绿却" docs/notes/                                    # → 3
grep -n '^| [A-G] ' docs/notes/pet-locus-delivery-safety-hardening-live-acceptance.md  # → 7 用例
```
