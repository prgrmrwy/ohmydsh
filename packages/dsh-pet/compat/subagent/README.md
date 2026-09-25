# Pet Locus 固定源码兼容运行时

## 这是什么

当前 `dsh.yaml` 固定 DSH `0.1.5-rc.2`。Pet unified locus 需要该正式包尚未发布的
宿主能力，因此本目录维护一份针对固定 tag 的最小 patch。

**当前 overlay 只替换一个上游包：`@deepseek-ai/dsh-subagent`。**

承载的 seam（对应 4 个能力 marker）：

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
- `withLiveContinuableChildSession` —— 在 continuation owner 内访问准确的 child
  Session。官方泛化 Session 路由**有意**不解析 continuation-owned child。

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

## 声明式选择与作用域

`dsh.yaml` 的本地 `dsh-pet` customization 声明：

```yaml
hostRuntimeCompatibility:
  kind: pet-unified-locus-v1
  supportedDshVersion: 0.1.5-rc.2
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
- patch 及其固定 SHA；
- Subagent/launcher/lock/timeout builders；
- package template。

重建时使用一把跨进程、可恢复 stale owner 的共享锁，覆盖 Subagent 源码与 launcher
整条链，并固定 `npm@11.19.0`（launcher）及上游声明的 `pnpm@11.7.0`（源码构建），以消除机器全局包管理器漂移。源码 checkout 仅在 install 子进程设置 `CI=true` 跳过无关的开发仓库 Lefthook 安装，依赖自身 install scripts 仍执行；tsc/tsdown 构建不继承该环境。reviewed DSH 源码要求 Node `^22.19.0 || >=24.0.0`，旧 Node 会在 clone/install 前明确失败。所有外部 git/corepack/npm 子进程通过有界 supervisor
运行，超时会终止进程组。launcher 在同文件系统 sibling staging 中完成：

1. 固定 tag 构建并验证 patch capability marker；
2. 安装官方 `@deepseek-ai/dsh@0.1.5-rc.2`、一个 reviewed override（subagent）
   与显式声明的框架版本（cordis / cordis-plugin-include，值从 reviewed 上游树读取）；
3. 显式审批固定 install scripts；
4. 验证依赖树唯一性、package identity/version/provenance、实际能力与 DSH
   `--version`；
5. 把 file links 转为自包含 package copies，再原子发布。

锁回收只针对同一目录 inode、同一 token/PID 且已确认死亡的 owner。`mkdir` 后尚未写出 owner 的目录即便很旧，也不是进程死亡证明；缺失/损坏 owner 或遗留 `.reclaim-*` 会有界等待后报错，不自动删除。遇到这些情况须由操作人员先确认所有构建进程已停止，再清理明确的锁残留；禁止在不确定时绕过锁启动第二个构建。锁测试复制源文件到临时目录运行，不清理实际 builder 的锁。升级此锁实现后，应确认没有仍加载旧实现的 builder/waiter 进程，再开始新的并发构建；磁盘改动不会更新已运行进程。

任一步失败都不会删除已有 `.launcher`；本次 Host 启动 fail closed，不静默回退
官方 runtime。启动控制台和 `dsh-startup.log` 会记录 runtime kind、owner、compat
kind 与版本。

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
| `contextMode: 'independent-v1'` | 依赖 locus 主 preset 不可变 | 它解决「父后来换了 preset，冷恢复重建不出原组合」。Pet 自有 main 的 preset 固定为 `dsh-pet-executor`；但若该会话在侧边栏可见、用户可进去切换 preset/模型，该条件即失效。 |
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
