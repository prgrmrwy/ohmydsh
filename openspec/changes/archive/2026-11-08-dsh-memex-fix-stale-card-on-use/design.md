## Context

- 召回引导由 `packages/dsh-memex/src/lifecycle/index.ts` 的 `RECALL_TEXT` 在会话开始与压缩后注入，英文；`instructions/dsh-home.md` 中的写卡说明是同一要求的中文版，经 sync 物化到 `$DSH_HOME/AGENTS.md`。两处须语义一致（见 `dsh-memex-reuse-evidence-and-card-lead` 任务 3.1 的约定）。
- 写入路径：`memex_retro` 由集成层生成 frontmatter，固定写 `created: <今天>`（`tools/index.ts` 的 `frontmatterForRetro`）；`memex_write` 接收完整 frontmatter，内核写入时保留 `created`，并把 `modified` 设为当天（`@touchskyer/memex@0.4.1` 的 `writeCommand`）。覆盖写入时，写卡事件遥测记为 `overwritten`。
- 写卡提醒：任一写入工具成功后，会话状态记为“已写卡”，此后不再提醒写卡（`lifecycle` 的 `mark`）。
- 规范依赖：现行 `openspec/specs/dsh-memex-integration/spec.md` 尚未合入 `dsh-memex-reuse-evidence-and-card-lead` 对同一要求的修改（该 change 仍有观察类任务未完成，未归档）。

## Goals / Non-Goals

**Goals:**
- 让 Agent 在“召回 → 核验 → 发现不符”这一已经在发生的流程末尾，顺手把卡改对，修订可追溯。
- 不引入新的写入路径或自动行为，只改提示文本。

**Non-Goals:**
- 不自动检测过期，不给卡片加新鲜度字段，不改检索排序。
- 不处理“卡片被召回但未核验”的情况：未核验就无法判断是否过期，不要求修改。
- 不批量修订存量过期卡；它们在被使用时自然修订，或另行审查。

## Decisions

### 1. 修订用 `memex_write`，不用 `memex_retro`

`memex_retro` 会把 `created` 写成当天，覆盖已有卡会丢失原创建日期；还会重写 frontmatter 中的 title/category。`memex_write` 由调用方提供完整 frontmatter，内核保留 `created`、更新 `modified`，正好符合“修订”的语义。备选是给 `memex_retro` 增加“覆盖时保留 created”的逻辑，但那会改变写入工具行为，超出本 change 的“只改提示”范围，而且现有 `memex_retro` 的覆盖语义另有使用者。

提示文本中明确写出“先读卡、再用 memex_write 改写、保留原标题与 created”，避免模型默认选择更方便的 `memex_retro`。

### 2. 放在会话开始的召回引导里，不放进回合结束的写卡提醒

写卡提醒只在“已召回且尚未写卡”时出现，并且是下一回合才送达；修卡恰好发生在核验之后、同一回合内。放在开头的引导里，模型在核验当下就知道应该修卡。另一个原因：一旦修卡，会话即记为“已写卡”，写卡提醒本来就不会再出现。

### 3. 只修订本回合实际核对过的事实

改错一张卡比不改更糟：错误的“修订”会带着新日期和看似可信的依据。提示要求修订说明写明依据（如文件与行号），事后可复查；对“似乎过期但没核对”的情况不做要求。

### 4. 结论失效时在卡内说明，不删除

删除需要处理反向链接，且一旦误判无法恢复。卡内说明“该结论自何时起不再适用、原因是什么”，既保留历史，也让下次召回立刻看到。归档仍由人或定期审查决定。

### 5. 规范 delta 以未归档的上游 change 为基础

本 change 修改的要求，在 `dsh-memex-reuse-evidence-and-card-lead` 中也有一份 MODIFIED delta（新增第一段写法与 intent 提示），该实现已于 0.4.0 部署，但 change 尚未归档。为避免后归档者覆盖先归档者，本 delta 的要求全文包含了那份修改的内容，再加上本次新增。两者以任意顺序归档，最终 spec 都同时包含两项修改；若本 change 先归档，后归档的那份会把这次新增覆盖掉，因此**本 change 应在 `dsh-memex-reuse-evidence-and-card-lead` 之后归档**，归档前核对主 spec。

## Risks / Trade-offs

- [模型依据推测修卡，引入错误] → 提示限定“只修订实际核对过的事实”，并要求在修订说明里写明依据；按月随机抽样审查时把“近期修订过的卡”作为一个分层单独检查。
- [修卡使会话记为已写卡，写卡提醒不再出现，可能少记一次真正的新经验] → 可接受：修订本身就是一次写卡；新的经验仍可在同一回合用 `memex_retro` 另写。上线后观察新卡数量是否明显下降。
- [多设备同时修同一张卡，产生同步冲突] → personal 库已在本机放开 `merge.ff`；真冲突时内核自动保存冲突文件，内容不丢失。
- [注入文本变长] → 新增约 60 个英文词，在有界体积要求之内。
- [模型改用 `memex_retro` 覆盖，丢失 created] → 提示明确点名 `memex_write`；上线后从写卡遥测和抽样卡片检查 `created` 是否被改成修订当天。

## Migration Plan

1. 实现与测试在本仓库完成；dsh-memex 0.4.0 → 0.4.1，`dsh.yaml` 同步版本，CHANGELOG 记录本条。
2. 用户确认 DSH 空闲后执行 `node scripts/sync.mjs` 两次确认幂等，并重启 DSH；新会话的注入文本含新的一行。
3. 回滚：`dsh.yaml` 回退到 0.4.0 → sync → 重启。卡片修订是普通的覆盖写入，不需要清理。
