## Context

本仓库是 DSH 的部署真相源:`dsh.yaml` pin 运行体版本与全部定制,`scripts/sync.mjs` 幂等物化到 `~/.dsh`。当前 pin 为 `dshVersion: 0.1.1-rc.2`,部署 cordis `4.0.1`,共 20 个插件被加载(2 个出厂 bundle + 18 个定制)。

预检(2026-09-04)确定的事实基线,全部经实机核对:

| 插件 | 当前 | 最新 | 阻塞原因 |
|---|---|---|---|
| cockpit-bridge | 0.2.0 | 0.2.1 | 无 |
| llm-subscriptions | fork@0.5.2 | npm 0.6.0 | 无(上游已合并 PR #40) |
| cost-meter | 1.5.42 | 1.7.10 | 无 |
| width-tiers | 1.0.3 | 1.0.4 | 新版自带 bundle patch,与手写接线冲突 |
| better-sidebar | 0.16.0 | 0.18.0 | 0.18.0 需 cordis `^4.0.2` + dsh-* `^0.1.2-rc.1` |
| sidebar-qa | 0.4.0 | 0.5.0 | 0.5.0 需 `ctx.remote.session`(现役不提供) |

**关键约束**:DSH `0.1.2` 线不是版本推进而是客户端架构重构。`@deepseek-ai/dsh-client-runtime` 在 `0.1.2` 不存在(npm 版本止于 `0.1.1-rc.2`;`latest` tag 回落至 `0.0.1-rc.1`,典型的弃用形态),`dsh-web-app@0.1.2-rc.1` 已不依赖它,新增 `dsh-api-session-controller`(描述:"Session Remote commands, cold reads, and live control transport")与 `dsh-client-ui-session`(描述:"Session Controller adapter for React and session-scoped slots")。本仓库 8 个自研包中 7 个 inject 了 `dsh-client-runtime`。

## Goals / Non-Goals

**Goals:**
- 在不阻塞低风险收益的前提下推进升级:不依赖运行体的插件先落地
- 每个阶段可独立验收与回滚,失败可二分定位
- 运行体升级前后可用同一基线证明能力稳定
- 把接线迁移类升级的原子性固化为不变量,避免重复 loader 行

**Non-Goals:**
- 不改变任何插件或自研包的功能语义(纯升级编排)
- 不在本变更内重新设计自研包的客户端架构;阶段四只做**等价接线迁移**
- 不追求"升到各插件的绝对最新版":`0.18.0` / `0.5.0` 的准入由运行体决定
- 不为 cordis 单独排期:cordis 无法独立升级(由 `@deepseek-ai/dsh` 整包带入),且 `4.0.2` 与 `4.0.1` 代码逐字节相同

## Decisions

### D1: 按依赖方向而非风险高低切分阶段

阶段顺序由**真实依赖方向**决定,不是主观风险排序。存在一个单向依赖:

```
  阶段一/二/三 ─────────────▶ 不需要运行体升级
      │
      │  (better-sidebar 0.18.0 / sidebar-qa 0.5.0 需要)
      ▼
  阶段四 ──────────────────▶ 运行体 0.1.2 + 7 包重接线
```

后置项的收益依赖前置项,而前置项不依赖后置项。因此分阶段不是保守选择,而是唯一合理的拓扑。

**备选**:一次性全升。**否决理由**:7 包重写 + 20 插件回归 + rc 级运行体 + 一个已知会静默失效的插件耦合在一起,任一失败都无法二分定位。

### D2: 阶段二必须原子完成,原因是 loader 语义而非洁癖

`dsh-width-tiers@1.0.4` 新增了自带 `cordis.patch.yml`,内容与 `patches/width-tiers-wiring.yml` 等价。按 `@deepseek-ai/dsh-app-boot` 的 `applyEntryPatches`:无 `id` 的 `insert` 一律 `data.push(...insert)`,**不去重**。已按该语义模拟验证,两份 patch 会产出两条同 id 行。

因此升 pin 与删手写 patch 必须同批。验收利用已修复的启动清单:该行应从 `[patch]` 标注变为普通 bundle 行,且恰好出现一次。

**备选**:先升 pin、后清理 patch。**否决理由**:中间态即为重复加载。

### D3: better-sidebar 停在 0.17.1 而非跳过

`0.17.1` 是最后一个 peer 接受 cordis `^4.0.1` 与 dsh-* `^0.1.0-rc.8` 的版本(已用 `npm view` 逐版本核对)。`0.18.0-alpha.0` 虽然 cordis 仍为 `^4.0.1`,但 dsh-* 已跳到 `^0.1.2-alpha.2`,不构成安全中间版。

取 `0.17.1` 而非停在 `0.16.0`:它包含对 `0.1.2` 线的**双向兼容层**,是通往阶段四的过渡砖,而非单纯的功能升级。

### D4: sidebar-qa 必须 hold,依据是运行时服务而非声明

`0.5.0` 的 `client-registry.js` 调用 `ctx.remote.session.follow/rename/selectModel/fork/prompt/create/modelCatalog`。实测现役运行体的 remote 命名空间只有 `commands / goals / dynamicCordisRunner / pluginInventory / fileReferences / sessionReferenceResolver`——**无 `session`**。

其 `engines.dsh: >=0.1.2-alpha.1` 是声明而非闸门(npm/pnpm 只校验 `node`)。故升级会**装得上、无报错、功能静默消失**。这是本次升级中最隐蔽的失败形态,已固化为 spec 中"静默不激活必须被识别为失败"。

### D5: 阶段四先 spike 再执行,且基线必须前置

`dsh-client-runtime` 的接口在 `0.1.2` 的落点尚未查清——只知道**去向**(`dsh-api-session-controller` / `dsh-client-ui-session`),不知道**接入形态**。在此之前给阶段四排期都是猜测,因此以 spike 作为该阶段的第一个门槛,产出 7 包逐包改动量。

基线必须在**升级前**先跑通一次并记录:否则升级后失败时无法区分"升级导致"与"升级前即存在"。基线含两部分:
- 自动化:仓库 `npm test`、各包自有测试(worktree-session 现 29 文件 201 例)
- 人工:已知无自动化覆盖的行为,首先是 `packages/worktree-session/src/index.ts` 的 `agent/session-start` 编排时序(同步跳过 guard + 异步落盘),来自 `2026-09-04-release-binding-when-worktree-is-gone` 归档记录

### D6: `dshVersion` 与 peer 声明同批变更

`tests/local-package-peers.test.mjs` 要求 local package 的运行体 peer 与 `dshVersion` 同版本族(现 3 例通过)。阶段四改 `dshVersion` 会让 8 个包全部失败——**这是设计好的前置门槛**,不是缺陷。spec 已固化"不得通过放宽检查或豁免个别 package 来消除"。

特别地,对 `dsh-client-runtime` 这类**上游已移除**的包,不得机械改写为 `^0.1.2-rc.1`(该版本不存在),必须改声明为实际承接包或移除。

### D7: 阶段四在隔离 Worktree Session 中进行

复用仓库已有能力(独立 `DSH_HOME` + lean deps),验收通过后再回主 checkout。先例:`dsh-pet` 即"隔离 DSH home 验收通过后启用"。这能把阶段四的 HIGH 风险显著压低——升级过程不影响日常 GUI。

## Risks / Trade-offs

- **[静默不激活]** 插件装上但不生效,无任何错误信号 → 验收以"实际加载且可用"为准,"无报错"不作为通过依据(D4,已入 spec)
- **[重复 loader 行]** 阶段二拆成两步会产生中间态重复加载 → 原子完成 + 启动清单验收该行恰好一次(D2)
- **[cost-meter 启动即崩]** `1.7.0`/`1.7.8`/`1.7.9` 有前科 → 取 `1.7.10`(该功能线首个稳定版),升级后先做宿主冒烟再继续
- **[阶段四工作量未知]** 7 包 24 接口面,接入形态未明 → spike 前置,不预先承诺排期(D5)
- **[rc 级运行体]** `0.1.2-rc.1` 非 stable,且 `scripts/lib/dsh-cli.mjs` 已挂着 `0.1.1-rc.2` 的 Arborist hang 绕过策略,说明该线有踩坑史 → 隔离 worktree 验收(D7);阶段一至三不依赖它,收益不受牵连
- **[基线覆盖不全]** 人工验收项依赖执行者纪律 → spec 要求显式列出无自动化覆盖项,不得因无覆盖而省略
- **[trade-off]** 分阶段总耗时长于一次性升级,换取的是可定位性与可回滚性;鉴于阶段四涉及架构迁移,该取舍成立

## Migration Plan

```
阶段一  cockpit-bridge 0.2.1 · subscriptions→npm 0.6.0(删 fork)· cost-meter 1.7.10
        验收:sync 幂等 + 启动清单 20 项 + cost-meter 宿主冒烟
        回滚:改回 pin,dsh build
   │
阶段二  width-tiers 1.0.4 + 删 width-tiers-wiring(原子)
        验收:该行由 [patch] 变 bundle 且恰好一次
        回滚:同时还原 pin 与 patch 条目
   │
阶段三  better-sidebar 0.17.1
        验收:侧栏各面板可用;sidebar-qa 0.4.0 仍正常
        回滚:改回 0.16.0
   │
阶段四  [spike] client-runtime 去向 + 7 包改动量  ← 门槛,不通过则停
        [基线] 升级前跑通并记录(自动化 + 人工清单)
        dshVersion→0.1.2-rc.1 + 7 包重接线 + peer 同批更新
        随后 better-sidebar 0.18.0 + sidebar-qa 0.5.0
        全程在隔离 Worktree Session 内;验收通过再回主 checkout
        回滚:还原 dshVersion 与 8 包 peer(同批)
```

每阶段完成后必须复跑 `node scripts/sync.mjs` 两次确认幂等,并提交为独立 commit,使回滚粒度与阶段粒度一致。

## Open Questions

以下三条已由 2026-09-04 的阶段四 spike(tasks 4.1–4.5)解答,结论见下节。

- ~~`dsh-client-runtime` 的各接口面在 `0.1.2` 线的**具体承接方式**为何?~~ → 已查清,见 S1/S2
- ~~阶段四完成后,`sidebar-qa` 应升到 `0.5.0` 还是当时的更新版本?~~ → 已复核,见 S4
- ~~是否需要在阶段四同时评估 `dsh` 的 `latest`?~~ → 已确认 `latest` 仍为 `0.1.2-rc.1`,见 S3

## Spike 结论(2026-09-04,tasks 4.1–4.5)

全部结论均以 npm 实际发布物的 `.d.ts` 与 `lib/*.js` 为证据,不依赖 release notes。

### S1: 接口承接方式 —— 服务名不变,提供者换包(task 4.1)

`@deepseek-ai/dsh-client-runtime@0.1.1-rc.2` 通过 cordis `Context` 增强提供 5 个服务面。`0.1.2-rc.1` 把它们拆到 4 个包,**服务名与取用形态(`ctx.<name>`)保持不变**:

| 旧 `ctx.*`(client-runtime 提供) | `0.1.2` 的提供者 |
|---|---|
| `ctx.sessions`(`ISessions`) | `@deepseek-ai/dsh-api-session-controller` |
| `ctx.slots`(`SlotRegistry`) | `@deepseek-ai/dsh-client-ui-renderer` |
| `ctx.workspaces`(`IWorkspaces`) | `@deepseek-ai/dsh-api-workspace-controller` |
| `ctx.conversation`(`IConversation`) | `@deepseek-ai/dsh-client-ui-conversation` |
| `conversationEvents` / `conversationViews` | 同上(`uiConversation`) |

`ISessions` 契约 diff(逐成员比对):**保留 14 个**(`list` `open` `openSubagent` `subagentAddress` `setSubagentCatalogOpen` `refreshSubagents` `clear` `search` `fork` `scope` `scopeOf` `sessionOf` `binding` `searchResultLimit`);新增 `create` / `refresh`;**移除 `currentProvideInfo` / `noteAgentPreset` / `provide`**。

**关键结论:本仓库 7 个包无一使用这三个被移除的成员**(已全仓 grep 确认)。因此迁移形态是「**改 inject 声明,不改调用形态**」。

### S2: 逐包改动量(task 4.2)

按「client 半区实际取用的服务」分类,全部 7 个包落在**仅改 inject 声明**一类,无一需要改写调用形态:

| 包 | client 半区实际用到 | 需替换的 inject |
|---|---|---|
| `session-title-copy` | `sessions` | runtime → session-controller |
| `sidebar-session-provider-icon` | `sessions` | 同上 |
| `session-links` | `sessions` | 同上 |
| `system-clock` | `slots` `locale` `connection` | runtime → ui-renderer |
| `home-network-model-guard` | `sessions` `slots` `locale` `connection` `conversation` | runtime → session-controller + ui-renderer |
| `dsh-pet` | `sessions` `slots` `workspaces` | runtime → session-controller + ui-renderer + workspace-controller |
| `worktree-session` | `sessions` `slots` `conversation` | runtime → session-controller + ui-renderer |

注:`ctx.agents` 仅出现在 `dsh-pet` 与 `worktree-session` 的 **host 半区**(`src/index.ts`、`src/host/policy.ts`),不属于 client-runtime 的接口面,不受本次拆包影响。

规模判断:改动集中在 7 个 `package.json` 的 `dsh.client.inject` 与 `peerDependencies`,加第 8 个包(`subscriptions-sandbox-shim`)的 peer 版本族同批更新(D6)。**属可接受范围,spike 通过,阶段四可继续**。

### S3: registry 实况(task 4.3)

`@deepseek-ai/dsh` dist-tags:`latest` = `next` = **`0.1.2-rc.1`**,`alpha` = `0.1.2-alpha.5`。与 proposal 预期一致,阶段四目标版本确定为 `0.1.2-rc.1`。

`@deepseek-ai/dsh-client-runtime` 版本止于 `0.1.1-rc.2`,`latest` 回落至 `0.0.1-rc.1` —— 弃用形态确认,且 `dsh-web-app@0.1.2-rc.1` 的依赖清单中确实**不含**该包。

### S4: 后置插件准入(task 4.4)

- **`better-sidebar@0.18.0`**:peer 要求 cordis `^4.0.2` + dsh-* `^0.1.2-rc.1`。目标运行体满足两者(cordis 本机实测已是 `4.0.2`)。**可放行**。
- **`sidebar-qa@0.5.0`**:其 `client-registry.js` 调用 `ctx.remote.session` 的 7 个方法。实测 `0.1.2-rc.1` **确实提供 `remote` 的 `session` 命名空间**(`namespace: 'session'`),其中 `follow` `rename` `fork` `prompt` `create` 由 `dsh-api-session-controller` 提供(该命名空间共 12 个方法);`selectModel` 与 `modelCatalog` **不在 session-controller 内**,而由 `@deepseek-ai/dsh-client-ui-model-selection@0.1.2-rc.1` 扩展到同一 `session` 命名空间上。**7 个方法全部可得,可放行**——但正因为它们分属两个包,阶段四验收必须确认 `dsh-client-ui-model-selection` 确实随 profile 加载,否则 `selectModel`/`modelCatalog` 会成为典型的「静默不激活」。

### S5: 风险修正

design 原假设「cordis `4.0.1` → `4.0.2` 是 host 升级的连带结果」与实况不符:本机 cordis **现已是 `4.0.2`**(`dsh@0.1.1-rc.2` 依赖 `^4.0.1`,范围自然上浮)。故 `0.18.0` 的两项阻塞中 cordis 一项在阶段三时点即已满足,真正的阻塞只有 dsh-* 版本族。该修正不改变阶段划分。
