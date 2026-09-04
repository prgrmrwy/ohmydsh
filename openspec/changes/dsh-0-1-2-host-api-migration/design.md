## Context

本仓库 pin `dshVersion: 0.1.1-rc.2`,registry `latest` 为 `0.1.2-rc.1`(2026-09-04 复核)。前一个 change `staged-dsh-and-plugin-upgrade` 完成了阶段一至三(6 个插件升级),其阶段四(运行体迁移)在 4.5 阀门停止并**完整回退**,因此当前部署与仓库状态干净、无中间态。

停止的直接原因已由该 change 的 design「阶段四执行结论」逐项记录:其 spike 只审计 client 半区,实际执行后 8 个自研包中 5 个无法构建。**本变更的起点不是"重做一次升级",而是"解决那 5 个包的 host 半区破坏"** —— client 半区方案、能力基线、后置插件准入都已查清且仍然有效,直接复用。

已知破坏面(前次实测,非推测):

| 破坏点 | 影响包 | 性质 |
|---|---|---|
| `Session.events` 移除 | `dsh-pet`、`worktree-session` | 读取面替代未知 |
| `connection.rpc.handle` 删除第三参数 | `system-clock`、`home-network-model-guard`、`session-links` | **安全边界** |
| `SubagentRuntime.registerContinuableSetup` 移除 | `worktree-session` | 核心路径 |
| `SessionLogOffset` 类型收紧 | `session-links` | 类型面 |
| 3 例测试 `no agent factory registered` | `worktree-session` | 成因未知 |

**关键约束**:`authority: 'loopback'` 不只是代码里的一个参数,它被写进了 `settings-system-clock` 的两条 spec requirement。删掉它编译立刻通过,但那是在无声明的情况下放弃一道已承诺的安全边界。

## Goals / Non-Goals

**Goals:**
- 5 个包适配 `0.1.2` 的 host API,**保持既有功能语义不变**
- 运行体升到 `0.1.2-rc.1`,8 包 peer 同批更新,peer 检查重新通过且不放宽
- 放行 `better-sidebar@0.18.0` 与 `sidebar-qa@0.5.0`
- 把「审计面必须覆盖两个半区」「安全语义类 API 不得静默降级」固化为规范,使同类失误不再重演

**Non-Goals:**
- 不重新设计任何自研包的架构;适配以等价为准,不借机重构
- 不改变任何用户可见行为
- 不放宽 `authority: loopback` 的安全语义 —— 若无等价机制则停下讨论,不默认降级
- 不追求"顺带把其它插件也升到最新"

## Decisions

### D1: spike 必须先跑通构建,才算结论成立

前次失误的根因不是调研不够细,而是**调研的验证标准太弱** —— 只读类型声明就宣布"改动量可接受"。本次 spike 的完成判据改为:**在隔离环境里让 5 个包真的构建通过**,而不是"我认为可以改通"。

**备选**:仍以类型分析为准、执行阶段再验证。**否决理由**:前次正是这么做的,代价是走到 6.5 才发现,已经改了 8 个包的声明和 lockfile。

### D2: 三件事必须同批次,不可拆分

`dshVersion` 升级、host 适配、peer 更新构成一个不可分割的批次:
- 适配代码在旧运行体上**无法编译**(新 API 不存在)
- peer 检查要求 `dshVersion` 与 peer 声明同批变更(`repo-layout` 已固化)

因此不存在"先合适配、再升版本"的中间态。

**备选**:先合入适配代码。**否决理由**:会留下一个既不能编译也不能验证的分支。

### D3: `authority: loopback` 按"意图不变、表达可变"处理

spec 的意图是「该 channel 只对本机回环可用」,`authority: 'loopback'` 只是 `0.1.1-rc.2` 上的表达方式。因此适配的正确形态是**在新运行体上找到等价机制并实际验证边界仍然成立**,而不是删参了事。

三种可能结局,处理方式不同:
1. 新运行体默认即限回环 → 确认并在 spec 中改写表达
2. 有等价机制(如路由层配置)→ 改用该机制
3. **确无等价机制** → **停止**,作为显式决策交由用户处理

**备选**:先删参让编译通过,后续再补。**否决理由**:那会在"已承诺的安全约束"上留一个无声明的缺口,违反仓库 fail-closed 原则,且极易被后来者当作既成事实。

### D4: 复用既有基线而非重建

`baseline.md`(自动化 951 例 + 人工清单)已在前次固定并**实际发挥过归因作用** —— 正是它让 5 包失败得以干净归因。本次直接复用,只需确认覆盖面仍适用。

需要新增的只有针对本次破坏面的专项验收:`authority` 边界、`Session.events` 替代读取、`registerContinuableSetup` 承接后的行为。

### D5: 沿用隔离 Worktree Session

前次已实测有效:升级与回退全程未影响日常 GUI(`~/.dsh` 21 插件、主 checkout `dshVersion` 均未受触碰)。

**一个必须保留的操作约束**:`scripts/sync.mjs` 在 `DSH_HOME` 缺省时回落 `~/.dsh`,而本分支的 `dshVersion` 已改 —— 漏传一次 env 就会把日常运行体升级掉。前次用 fail-closed 包装脚本解决,本次沿用。

### D6: 后置插件放行放在最后且逐项验证激活

`sidebar-qa@0.5.0` 的 `selectModel`/`modelCatalog` 由 `dsh-client-ui-model-selection` 提供(**不在** `dsh-api-session-controller` 内)。若该包未随 profile 加载,功能会**静默消失而无任何报错**。因此放行后必须逐项确认实际激活,"无报错"不作为通过依据。

## Risks / Trade-offs

- **[无等价的 loopback 机制]** 新运行体可能确实没有对应约束方式 → D3 第 3 种结局:停止并上报,不默认降级(已入 spec)
- **[破坏面仍未穷尽]** 前次已证明"看起来查清了"可能仍有遗漏 → D1 以实际构建通过为判据,而非分析结论
- **[rc 级运行体]** `0.1.2-rc.1` 非 stable → 隔离环境验收 + 基线比对 + 可回退(前次已验证回退干净)
- **[适配引入行为漂移]** 等价适配可能悄悄改变语义 → 每个包的自有测试必须通过,且不得为适配而修改测试期望
- **[trade-off]** 本变更把"升级"与"适配"绑在一起,批次较大;但 D2 已论证二者不可拆,拆分反而制造不可验证的中间态

## Migration Plan

```
spike   逐项查清 5 个破坏点 + 在隔离环境让 5 包构建通过   ← 门槛,不通过则停
   │    (authority 无等价机制 → 在此停止并上报)
   ▼
适配    5 包 host 半区 + 7 包 client inject + 8 包 peer + dshVersion  (同一批次)
   │    各包 build/typecheck/test 通过,不修改测试期望以迁就适配
   ▼
验收    复跑 baseline.md 并逐项比对;专项验收 authority 边界等三项
   ▼
放行    better-sidebar 0.18.0 + sidebar-qa 0.5.0,逐项确认实际激活
   ▼
回主    隔离环境通过后回主 checkout 物化,确认日常 GUI 全部插件正常
```

回滚:还原 `dshVersion` 与 8 包 peer(同批),前次已验证该回退干净且不波及其它成果。

## Open Questions

- `Session.events` 在 `0.1.2` 的替代读取方式为何?两包的用法不同(取标题与水位 vs 判定 blank session),是否需要不同的替代路径?
- `authority: 'loopback'` 的等价机制是什么?是运行体默认行为、路由层配置,还是确实不存在?**这是本变更唯一可能导致中止的问题**
- `SubagentRuntime.registerContinuableSetup` 的承接 API 为何?`worktree-session` 的 continuable subagent 建立策略是否需要改写形态而非仅换 API?
- `worktree-session` 3 例 `no agent factory registered` 是测试装置问题还是运行体行为变化?
- 后置插件是否应取 spike 时点的更新版本(`better-sidebar` 与 `sidebar-qa` 当前分别为 `0.18.0` / `0.5.0`,届时可能更新)?建议以实际 registry 状态决定,不预先锁定
