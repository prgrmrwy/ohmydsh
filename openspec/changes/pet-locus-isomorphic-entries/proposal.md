## Why

2026-11-05 线上事故：在一个从未建立群级入口的话题群里，所有者在话题内执行 `/bind session-4437f422`，结果除了 4437f422 的 locus 主会话和话题入口，还额外建出了 auto 干活主会话 `session-17bd88a3`、它的 locus 主会话 `session-1a300190`，以及一个协作空间。其中 `session-1a300190` 已经被唤醒并实际运行了一轮。

所有者认为，locus 模型应该**同构生长**：干活主会话 W 与 locus 主会话 M 一一对应；W 的所有入口都在 M 下，并且一个入口只属于一个 locus；无论从哪个入口从零创建，结果都是 W → M → {群 locus, 话题 locus}（文档同理）。现在的实现不满足这一点。根因是话题行把"所属群"做成了强制外键 `parentLocusId`，补建群时又丢掉了显式指定的 W。另外，同一个群的群行和话题行可以挂在不同的 M 下，持久层不做校验。

排查过程中还确认了 locus 行字段存在系统性的多义和冗余：
- `parentSessionId` 有时指 M，有时指 W；
- `generation`/`replacesLocusId` 和 `locusId` 都在区分实例；
- child/reserved 两个 session 字段其实是同一个值；
- 权限被拆成 `permission`×`toolTier` 两个字段，再叠加一套待应用协议，非驻留时撤回 shell 失败会继续按 shell 服务；
- `busy`、`contextAnchor`、`childComposition`、`source` 已经没有独立的行为读取方。

v19 已经把旧两层模型的数据清掉（change `pet-locus-purge-previous-model`），现在可以以 break-change 的方式一次性重整。

## What Changes

- **同构不变量**：一个群（或一篇文档）的群行和全部话题行都在同一个 M 下。M、项目工作区这类归属字段只存在群行上，话题行按 `chatId` 去群行读取。
- **从零创建**：无论是话题 `/bind`、话题首次 @、群首次 @ 还是群 `/bind`，都在一次提交中建出 W → M → {群, 话题}。划词评论与文档根按相同规则处理。
- **拒绝跨 M 的 `/bind`**：群已经由别的 W 跟进时，在话题或群本体里 `/bind` 另一个 W 一律拒绝，回执提示所有者，原会话归档后可以在管理面改绑。
- **改绑到其他会话**（仅在管理面操作，且仅当原 W 已归档时可用）：整群在一个事务内改挂到新 W 的 M。各入口在新 M 下按首条消息重新创建子会话，**不保留上下文**。首次投递的提示会说明本群的来历，并提示先读飞书历史。不迁移协作条目，不归档旧子会话，不向群里发通知。
- **不可用状态**：
  - `invalid`：在下一条授权 @ 时原地重建。
  - `stopped`：在该入口重新 `/bind` 同一个 W 即可重新启用。
  - W 被归档：入口停止服务，并提示所有者去改绑。
  - M 不可用：Host 为同一个 W 新建 M，在一个事务内把该 W 的所有群整体迁过去；任一群有 current 投递时等待。
  - 被替换下来的旧子会话不能再运行（打开或冷恢复时拒绝发布），历史仍可查看。
- **访问模式**：`permission` 与 `toolTier` 合并为单值 `accessMode`（`read-only` / `danger-full-access`），工具面和准入都由它推导。取消待应用协议：变更时先释放常驻子会话再改行，下一次组装时应用并核验，核验不符时拒绝发布，不回退到旧值；变更期间用仓储写队列内的进程内锁挡住新投递，不写持久记录。全局写开关关闭时，拒绝授予完全访问，已经是完全访问的入口也拒绝服务。
- **locus 行重整**（**BREAKING**，持久层 v20）：
  - 每个入口一行，主键为入口身份；
  - 合并为 `sessionId`；
  - `state` 收敛为 not-created / active / invalid / stopped；
  - `revision` 改为必填，作为唯一的并发围栏；
  - 删除 `parentLocusId`、`generation`、`replacesLocusId`、`source`、`childComposition`、`busy`、`contextAnchor`、`retiredAt`；
  - 删除切换通知债、权限审计写入（旧行冻结），以及 `chat_bindings` 的旧退休路径（这些旧标记的群，授权 @ 会按 auto 从零建立）；
  - 默认 Q&A 由持久索引改为群行上的 `defaultQa` 标记，所有索引都可从行推导。
- **管理面**：按干活会话 W 分组，每个入口一行，话题按 `chatId` 嵌套在群下；动作只保留停止、访问模式、改绑到其他会话。同时修复现网快照校验不认 `not-created`、导致面板可能无法加载的问题。
- **v20 离线迁移**：复用 v19 的框架。每个入口保留最新一行并改写；全部投递保留；默认 Q&A 指针显式改写。话题与群的 M 不一致时（线上只有 `oc_bb0e`），话题并到群行的 M 下并原地重建。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`：入口建立、三层实体、子会话创建、换绑与归档、投递与结算关联、业务出站、首投前言、上下文与默认权限、管理面七条相关 requirement、持久层与离线迁移；删除工具档位、待应用协议两条 requirement，新增访问模式、改绑到其他会话两条 requirement。
- `pet-locus-doc-comments`：文档根与划词评论的建树规则，以及评论中控制命令的改绑语义。

## Impact

- 代码：`packages/dsh-pet/src/host/{spec,domain}.ts`、`src/host/locus/*`（controller、persistence、repository、adapter、aggregate、delivery、admission、composition、resolution、serviceability、management 等；删除 carry-topics、retirement、pending-application、permission/tool-tier-mutation、switch-notice，新增 access-mutation）、`src/host/channel/locus-controller.ts`、`src/host/collab/locus-tools.ts`、`src/host/{tools,context-tool,routes}.ts`、`src/index.ts`、`src/wire.ts`、`src/client/*`、`scripts/migrate-state-version.mjs`。
- 测试：大量改写；carry-topics、legacy、pending、tool-tier、switch-notice 相关的测试文件删除或重写，逐条记录在 `deleted-tests.md`。
- 数据：v19 → v20 不可逆迁移，回退只能恢复备份。`ledger_item` 的 `generation` 改为可缺省。
- 部署：必须先停机迁移。线上 `oc_bb0e` 由迁移归并后，所有者确认归档 auto W0，再在管理面改绑，作为真机验收。
- 取代：`openspec/changes/pet-topic-bind-without-group`（两轮 REVISE，无父话题方向被放弃）。本 change 评审通过后删除该目录。
- 不包含：push、部署、对线上库执行迁移、协作条目迁移、跨会话历史读取。
