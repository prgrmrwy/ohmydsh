# Design: 本地 manifest overlay

## Context

公开仓库需要承载不可公开的定制。现状 workaround(`enabled: false` + `enabledEnv` +
gitignored `.env.local`)不满足需求:它能做到「默认不启用」,但做不到「不公开」——
`dsh.yaml` 的 `dsh-traex-bridge` 条目仍暴露内网包名、内部 registry、maintainer 与
内部服务描述。

已有两个实例(traex-bridge、Bits 采集插件),故按结构性需求处理。

## Goals / Non-Goals

**Goals**

- 公开 manifest 零痕迹地承载不可公开定制。
- overlay 与公开 manifest 同构,审查记录随条目走。
- 校验与安全围栏对 overlay 条目不放宽。
- 无 overlay 时行为与现状逐字节一致。
- 为多机共享留出无需后续开发的通道。

**Non-Goals**

- 不做跨机器分发/同步(见 Decision 5)。
- 不支持 overlay 覆盖公开条目(见 Decision 2)。
- 不新增 manifest `type`,不改 `cordis.patch.yml` 生成逻辑,不改 `bin/dsh`。

## Decisions

### Decision 1: 合并发生在 `loadManifest` 内的最早期,且在 host runtime 围栏之前

`scripts/sync.mjs` 的 `loadManifest()` 现在的顺序是:

```js
const doc = yaml.load(readFileSync(file, 'utf8'))
// ...dshVersion / customizations 基础校验...
declaredHostRuntimeFromManifest(doc, { repo: REPO, env: process.env })   // 安全围栏
const items = doc.customizations.map(...)                                 // 逐条校验
```

`declaredHostRuntimeFromManifest(doc, ...)` 接收**整份 doc**,并在其中筛选
`hostRuntimeCompatibility` 拥有者、断言「至多一个」。因此 overlay 必须在**调用它之前**
合并进 `doc.customizations`,否则:

- overlay 若携带 `hostRuntimeCompatibility`,围栏看不见 → 绕过版本围栏(**安全缺陷**);
- 「至多一个拥有者」这条不变量会被静默破坏(公开一个 + overlay 一个 = 实际两个)。

源码注释明确要求该围栏先于任何 profile/state 操作。故合并点定为:读取公开 `dsh.yaml`
→ 读取并校验 overlay → 合并 customizations → 其余流程完全不变。

选择合并 `doc` 而非合并 `items`(校验后的产物),使下游所有逻辑(含围栏与逐条校验)
天然对 overlay 生效,不需要在每个消费点重复判断来源。

### Decision 2: overlay 只追加,不覆盖;id 冲突 fail closed

允许覆盖会引出一连串问题:能否覆盖 `spec`(改内网源)?能否把公开条目改成
`enabled: false`(本地静默禁用审查过的定制)?能否覆盖 `hostRuntimeCompatibility`?
每一个都扩大信任面,且让「读公开 manifest 能知道部署了什么」这一性质失效。

故语义收敛为**纯追加**:id 冲突直接报错。这也让「overlay 里有什么」与
「公开 manifest 里有什么」保持正交,排查时两边可独立阅读。

overlay 内部 id 重复同样报错(与公开 manifest 的既有约定一致)。

### Decision 3: overlay 禁止顶层字段

`dshVersion` 是版本单一来源,`autoUpdate` 控制自动升级,`agentInstructions` 决定
注入到 `$DSH_HOME/AGENTS.md` 的内容,`web` 影响启动形态,`dependencies` 是支撑包锁。
这些都是**公开可审查**的部署事实,不应被一个不进版本控制的文件改写。

`dependencies` 的排除还有个具体理由:`deps` 引用完整性校验依赖顶层 `dependencies`
的全集;允许 overlay 追加依赖会让「引用不存在的包名时报错」这条规则的判定面
随本地文件变化,削弱公开 manifest 的自洽性。overlay 条目若需支撑包,应改为
不依赖顶层 `dependencies` 的形态,或将该支撑包本身作为公开条目(它通常可公开)。

出现越权字段时报错而非忽略:静默忽略会让用户以为设置生效了。

### Decision 4: `DSH_LOCAL_MANIFEST` 取代而非叠加默认路径

多机共享的既定路线是把 overlay 放进一个私有 git repo(与 memex 库同形态),
再由环境变量指向它。若语义是「叠加」,则一台机器上可能同时生效两个 overlay,
排查「这条定制从哪来」会变难,且两份文件的 id 冲突规则要额外定义。

取「取代」语义:有环境变量就只读它,无则只读仓库根 `dsh.yaml.local`。规则单一。

该变量在本 change 中只是一个**口子**,分发本身不实现——目的是让 git 同步方案
落地时无需再改代码。

### Decision 5: 不由 cockpit / 联邦做跨机器分发

`docs/notes/federated-dsh-operations.md` 明确声明联邦控制面**不同步文件**,且其
设计前提是「远端始终是独立的 DSH 安装,保留自己的模型、订阅、凭据」。让中央
分发 manifest overlay 会反转这条不变量:中央开始决定远端装什么插件,信任面从
「只读视图」变成「配置管理系统」(中央被攻破 → 所有节点被推任意插件)。

且 `dsh-federation` 包当前并不存在(change 在 archive、manifest 零引用、M3 三节点
验收未完成),在未落地能力上叠需求风险过高。

同构问题已有答案:memex 库就是一个私有 git repo,靠 `sync push/pull` 跨机器一致。
overlay 可复用同一模式,零开发成本。

**记录此决策以免重复讨论**:若将来 git 路线实测不足,再单独提 change,并先解决
「中央分发」与联邦已声明边界的冲突。

### Decision 6: 四个消费方共用一份合并结果

`customizations` 有四处解析:

| 文件 | 作用 | 漏掉的后果 |
|-|-|-|
| `scripts/sync.mjs` | 物化 | 核心 |
| `scripts/plugin-list.mjs` | 启动清单 brief | 装了但清单不可见 |
| `scripts/lib/plugin-updates.mjs` | 升级检查 | 内网包永不检查更新 |
| `scripts/lib/dsh-host-runtime.mjs` | 运行体版本围栏 | **绕过安全围栏** |

其中 `dsh-host-runtime.mjs` 接收 doc 而非自行读文件,故 Decision 1 的合并点已经
覆盖它(由 sync 传入合并后的 doc)。另两处各自 `yaml.load` 读盘,需要改为共用
同一个读取+合并入口,避免出现分裂状态。

`plugin-list.mjs` 现在的容错是「manifest 不可读 → 只用包自身 description」。overlay
不可读时应沿用同一容错级别(清单降级但不阻断启动),**而 sync 必须 fail closed**——
两者对同一异常采取不同严格度是有意的:清单是展示面,sync 是部署面。

## Risks / Trade-offs

**风险 1:审查记录离开版本控制。** overlay 条目的 `note`(来源、审查日期、信任面
分析)不再有 git 历史。缓解:overlay 本身放进私有 git repo(既定多机路线的副产品)。
接受这个 trade-off,因为替代方案(公开 manifest 留存内网信息)违背本 change 的目的。

**风险 2:「公开仓库看起来什么都没装」。** 读者看不到本机实际启用的两个内网定制。
这是**有意的**——「这台机器装了什么内网东西」本身就是不该公开的信息。不加存在性
声明(初版设计曾考虑,已否决)。

**风险 3:overlay 条目错误的可诊断性。** 报错必须指明「来自 overlay 的条目 X」而非
只说「customizations[N]」,否则用户会去公开 manifest 找不存在的第 N 项。错误信息
需携带来源标签。

**风险 4:worktree 隔离。** `.worktrees/*` 是独立 checkout,仓库根 `dsh.yaml.local`
不会自动出现在其中(gitignored 文件不随 worktree 创建复制)。使用
`DSH_LOCAL_MANIFEST` 指向仓库外的稳定路径可规避;本 change 只需保证行为可预测
(worktree 内无 overlay → 按公开 manifest 运行,不报错)。

## Migration Plan

1. 实现 overlay 加载与校验,合入前不改 `dsh.yaml`(此时 overlay 不存在,行为不变)。
2. 本机创建 `dsh.yaml.local`,写入 `dsh-traex-bridge` 条目(`enabled: true`,原 note 全文)。
3. 跑 sync 确认物化结果与迁移前一致(该包仍安装、清单可见、升级检查覆盖)。
4. 从 `dsh.yaml` 删除 `dsh-traex-bridge` 条目;从 `.env.local` 删除 `DSH_TRAEX_BRIDGE`。
5. 再跑 sync 确认幂等且无变化。

回滚:删除 `dsh.yaml.local`、恢复 `dsh.yaml` 条目与 `.env.local` 变量 → sync。
overlay 加载代码保留(无 overlay 时为空操作)。

## Open Questions

- 无。`enabledEnv` 是否对 overlay 条目仍有意义:保留支持(同构原则),但本机迁移
  后不再使用它承载 traex-bridge——文件本身已是本地的。
