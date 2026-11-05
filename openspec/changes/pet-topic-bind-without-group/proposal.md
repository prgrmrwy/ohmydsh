## Why

所有者把 bot 拉进一个话题群（群里只有话题，没有群本体聊天），在其中一个话题里执行 `/bind W`，结果多出两个平级会话：default workspace 里一个自动建出的干活主会话，以及它的 locus 主会话。`/bind` 是所有者对"这个入口 ↔ 这个干活主会话"的点对点显式声明，不应顺带替群本体做自动建立；每个入口都应按自己的方式同构生长。

2026-11-05 现场：在话题 `omt_198f10e683c35baa` 中 `/bind session-4437f422` 后，额外产生了：
- `session-17bd88a3`：auto 干活主会话；
- `session-1a300190`：上面那个会话的 locus 主会话。它被协作空间唤醒，已经实际跑了一轮。

根因是 `LocusController.ensureTopic` 在建立新话题前，无条件先补齐群级结构（`packages/dsh-pet/src/host/locus/controller.ts:821`）。群从未建立时走 auto；群仍是旧模型时，则在 `explicitParent=undefined` 的前提下退休并重建旧群（`controller.ts:1138-1145`、`:1903-1915`）。旧模型话题本身的显式绑定也会先修复旧群（`:1884-1895`）。划词评论与话题共用 `ensureTopic`（`host/channel/doc-comment.ts:137-143`、`index.ts:2256-2265`），所以文档评论有同样的问题。

## What Changes

**新建无父话题**

- 显式绑定 MUST NOT 为任何其它入口执行 auto 建立、旧模型退休重建或修复。
- 群级结构未建立时（该群没有群级行，或最新群级行是未被所有者停止的旧模型行），在话题内显式 `/bind W` 只建立该话题入口：复用或新建 W 的 locus 主会话，发布不带 `parentLocusId` 的代际（无父话题）。
- 划词评论内的显式 `/bind` 按同一规则处理，产生无父评论。

**不变的部分**

- 群级结构已按三层模型建立：
  - 可服务时，话题照常挂在群下；
  - 停止、退役、失效或需要修复时，话题显式绑定被拒绝，也不修复群。
- 群本体、未绑定话题、全文评论的首个授权 at，仍走 auto 或旧模型退休路径。
- 管理面：无父话题作为其干活主会话下的根入口行。现有 `groupByWork` 已经这样处理，本次补上规范和测试。

**无父话题的后续代际**

- 无父话题的后继代际保持无父。可能产生后继的路径有四条：
  - 同主会话重建；
  - locus 主会话迁移；
  - 归档后换绑；
  - 停止后重建。
- 群级 `/bind` 携带遗留话题时，只携带挂在群下的话题，不接管无父话题。

**持久层校验**

- 单行校验不再要求话题必须有父。
- 能看到完整集合的写入口统一在提交前证明以下条件，否则 fail closed：
  - 无父首代：该群的群级结构未建立；
  - 无父后继：引用的是紧邻的最新前代，且前代无父，或群级结构仍未建立；
  - 无父前代的后继不得补上父。

**BREAKING（数据格式）**

- 写入第一条无父话题后，旧版 Host 无法读取该数据库。
- 回退只能停掉 Host，恢复部署前的数据库备份；部署后发生的事实会丢失。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`：
  - 修改"入口建立统一为一条路径"和"管理面按入口聚合且区分代际"；
  - 新增"无父话题的代际由持久层证明"和"群级绑定携带遗留话题只限挂在群下的话题"。
- `pet-locus-doc-comments`：修改"文档评论按全文/划词同构映射为文档级与评论级入口"中的建树规则，并补充划词显式绑定的场景。

## Impact

**代码**

- `packages/dsh-pet/src/host/locus/controller.ts`：
  - `ensureTopic` 的新建分支与已存在分支；
  - `establishFromPreviousModelLocked` 的话题显式分支；
  - `rebuildExplicit`、`replaceInheritedTopicParentLocked`、`provisionChildLocus`；
  - `EnsureTopicResult.group` 与 `RebuildLocusResult.group` 改为可选。
- `locus/persistence.ts`：`normalizeRecord`、`assertProvisioningCommitForm`、`assertNewTopicParent`，以及调用 `assertNewTopicParent` 的各个写入口。
- `locus/repository.ts`：`assertParentLocus`。
- `locus/aggregate.ts`、`host/spec.ts`：单行校验。
- `locus/carry-topics.ts` 与 `index.ts` 中的 carry 接线。

**数据**

- 持久层版本不变，已有行不需要迁移。
- 新数据对旧 reader 单向不兼容（见 design 的 Migration Plan）。

**不包含**

- 清理现场多出的两个会话：部署后由所有者确认再处理。
- 部署与重启。
- 改动未接入生产的 `locus/hierarchy.ts`：其测试保留为历史模块测试，不作为本次契约。
