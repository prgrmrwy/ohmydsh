# ADR-0004: locus 规范统一收敛到 pet-locus-collaboration，不再等待旧 change 收尾

- **Status**: Accepted
- **Date**: 2026-09-15
- **Relates to**: OpenSpec change `pet-unified-locus-collaboration`（本 ADR 使其转为“实现已生效、流程不再收尾”）；`pet-locus-independent-child`（承接并覆盖其中三条需求）；`pet-locus-multi-binding`（更早的草案，已被前者声明不继承）

## Context

`pet-locus-collaboration` 这个 capability 至今**没有主 spec**：`openspec/specs/` 下不存在该目录。它的 13 条需求全部停留在 `pet-unified-locus-collaboration` 的 delta spec 里，从未合入。

该 change 的实施并非未完成：9.1–9.5 的构建、四组产品场景验收与故障注入全部标记完成，对应实现（`packages/dsh-pet/src/host/locus/` 整个目录）早已落地并在生产 Host 中运行。真正卡住的只有最后一项 9.6——“严格校验完整 change 并核对新 capability 与旧要求的替代边界；只有所有宿主适配与产品场景验收完成才标记实施完成”。

这一项迟迟不动，原因不在它自身，而在它之后发生的事：`pet-locus-independent-child` 在真实飞书验收中推翻了原模型的一个核心假设——`turn/end` 不能等同于 Delivery 完成。由此产生的每 locus 单 current Delivery 串行队列、统一 `pet_locus_finish`/`pet_locus_wait`、跨 turn current capability 等，**直接改写了原 change 中三条需求的语义**：

- 全部飞书工作统一为子会话常规交互
- 上下文按实际子会话绑定并允许按需问主会话
- 投递与结算关联独立于会话运行状态

于是形成一个僵局：旧 change 的 9.6 要求“核对新 capability 与旧要求的替代边界”，而这条边界已经被它的后继 change 改动过；若按原样收尾并合入主 spec，写进去的是**已被真实验收否定的旧语义**。

归档 `pet-locus-independent-child` 时这个僵局变成了硬阻塞：它的 delta 声明 `MODIFIED` 三条需求，但主 spec 不存在，直接同步会把 `MODIFIED` 静默当作新增写入，产出一份跳过基线、来源错误、且只有 3 条需求的主 spec——另外 10 条只存在于旧 change 的需求会一并丢失。

## Decision

**不再推动 `pet-unified-locus-collaboration` 走完 9.6，改为把 locus 规范一次性收敛为单一 `pet-locus-collaboration` 主 spec。**

合并规则：

1. 以旧 change 的 13 条需求为底稿——它们描述的是**已经在跑的实现**，不是提案。
2. 用 `pet-locus-independent-child` 的 3 条 `MODIFIED` 覆盖同名需求，采用经真实飞书验收的新语义。
3. 其余 10 条原样保留。丢弃旧 change 不等于丢弃这些需求：它们没有被任何后继 change 否定，且有对应实现。

明确**不**做的事：

- 不删除 `pet-unified-locus-collaboration` 目录本身。它记录了核心模型的推导过程与 9.1–9.5 的验收证据，归档后仍是可查的历史；丢弃的是“继续按它的流程收尾”这条路径，不是它的内容。
- 不因为“旧 change 未归档”而阻塞 `pet-locus-independent-child` 的归档。

## Consequences

**正面**

- `pet-locus-collaboration` 终于有主 spec，locus 行为从“散落在两个未归档 change 的 delta 里”变成单一真相源。
- 主 spec 直接反映经真实验收的当前行为，而不是一份需要读者自行叠加两个 change 才能还原的状态。
- 解除归档阻塞，且不制造“只有 3 条需求”的残缺主 spec。

**负面与风险**

- 旧 change 的 9.6 永久停留在未勾选状态。这是刻意的：把它标记为完成会声称一项从未执行的校验。ADR 本身即是该任务的处置记录。
- 旧 change 还带有 `dsh-runtime-provisioning`、`pet-qa-group`、`dsh-pet`、`pet-lark-channel` 四个 capability 的 delta（含 `pet-qa-group` 的 10 条 `REMOVED`）。本 ADR **只处置 `pet-locus-collaboration`**；其余四个的合入或废弃需要各自判断，不在本次收敛范围内，归档旧 change 前必须单独处理，否则同样会丢失。
- 合并后的主 spec 需要人工复核：13 条中被覆盖的 3 条是否确实取代而非并存。

## Alternatives considered

**先补完 9.6 再按正常顺序归档两个 change。** 否决：9.6 要核对的“替代边界”已被后继 change 改动，按原样收尾会把已被验收否定的语义写进主 spec；且它要求“所有宿主适配与产品场景验收完成”，而 B035 完整协作平台（`pet-locus-independent-agent-inquiries`，2/57）仍在暂停，该前提短期内不成立。

**直接 sync `pet-locus-independent-child` 的 delta 后归档。** 否决：会产出只含 3 条需求的主 spec，静默丢弃另外 10 条已实现的需求，且把 `MODIFIED` 当作新增写入，来源错误。

**两个 change 都不归档，维持现状。** 否决：`pet-locus-collaboration` 将长期没有主 spec，后续任何 locus 改动都必须先读两个未归档 change 才能知道当前规范，这正是本次归档要消除的状态。
