## Context

动机见 proposal.md。相关现状：

- `memex_search` 对每个目标库各调用一次内核 `search --limit N`，按 `(scope, 库内原序)` 归并后截断到 N，返回结构化 `hits`。`memex_recall` 只查当前库，`search --limit 10`，把内核 stdout **原样**放进 `content`，只为遥测才解析。
- 写入工具（`memex_write`、`memex_retro`）成功后调用 `onToolSuccess`，该回调目前只用于写卡提醒的状态。
- 工具执行上下文 `exec.agent.session` 可用。宿主 0.2.0-rc.2 的 `Session.surface.nodes` 是模型可见消息的事件序号列表（未标 deprecated）；`eventAt`/`snapshotEvents` 已标 deprecated，新代码禁止调用。
- 2026-10-10 用真实 `AgentLoop`/`SessionStore` 探针确认：工具执行时，`surface.nodes` 的最后一个节点就是发出这次调用的 assistant 消息；压缩以 `replace` 替换一段范围后，该节点从 `surface.nodes` 中消失。

## Goals / Non-Goals

**Goals:**
- 在场自写卡的判定只依赖本进程的写入登记和 `surface.nodes`，不读事件内容，不调用 deprecated 接口。
- 无在场自写卡时，两个工具的返回逐字节不变（包括 `recall` 的 `content`）。

**Non-Goals:**
- 不做跨会话、跨进程的持久登记。会话重启后登记为空，按“判定不可得”处理。
- 不处理“卡片内容通过 `memex_read` 读进了上下文”的情形。评估显示主要来源是本会话写入，读取另算，留待数据说明需要时再做。
- 不改内核排序，也不对内核做分数级的重排。

## Decisions

### D1 登记：写入成功时记下 `(scope, slug, 写入调用所在的 surface 节点)`

写入工具执行时，读 `exec.agent.session.surface.nodes.at(-1)` 作为“携带本次写入调用的 assistant 消息”的序号，写入成功后把 `{ scope, slug, anchorSeq }` 记在以 session 对象为键的 `WeakMap` 中。会话结束、对象回收时登记自动释放。同一 `(scope, slug)` 再写一次时，以最新的锚点为准。

附加目标库（`scope` 参数指定的另一份）也一并登记，因为模型同样在上下文中看到了这次写入的内容。

- 备选：从事件日志中找 `tool/call` 事件来定位。需要 `snapshotEvents`/`eventAt`，已 deprecated，且每次检索都要扫描。放弃。
- 备选：记录 `session.seq` 的数值，与压缩事件位置比较。需要观察压缩事件，插件拿不到稳定的订阅入口。放弃。

锚定 assistant 消息而不是工具结果，是因为卡片正文就在写入调用的参数里，参数随 assistant 消息一起留在上下文中。`compaction/prune` 只裁剪旧的工具结果，不会让正文离开上下文；只有压缩把 assistant 消息替换掉，正文才真正不在了。历史数据中，40 对“自写→检索”里有 6 对之间发生过 prune，但没有一次裁掉了写入所在的 assistant 消息。

`surface.nodes.at(-1)` 的取法依赖“工具执行时最新的 surface 节点就是发出调用的 assistant 消息”。这是宿主 0.2.0-rc.2 实测的行为，但不是接口文档承诺的。因此用测试锁定：真实 `AgentLoop` 下写入后锚点的事件类型是 `assistant/message`。宿主升级若改变这一点，测试会失败。取不到节点（数组为空、无 agent）时不登记，按非在场处理。

### D2 判定：锚点仍在 `surface.nodes` 中即为在场

检索时取一次 `new Set(surface.nodes)`，登记里锚点在集合中的卡为在场自写卡。压缩替换后锚点消失，自动恢复普通排序（spec「压缩后恢复普通排序」）。对 `surface.nodes` 的一次遍历是 O(上下文消息数)，每次检索只做一次，代价可忽略。

### D3 多取与重排

在场集合非空时，向内核请求 `min(N + k, MAX)`，k 为与本次目标库相关的在场自写卡数量。归并后稳定分区：非在场在前、在场在后，两部分内部保持归并顺序；按名取回（查询去除首尾空白后等于某张在场卡的 slug）的那张卡视为非在场，留在原位但仍标注。最后截断到 N。

在场集合为空时，请求参数与处理路径和现在完全一致，因此返回逐字节不变。

- 备选：从结果中删除在场自写卡。删除会让模型以为库里没有这张卡，与按名取回冲突。放弃。
- 备选：只标注、不移动。用户在评估后选择了“标注＋沉底补位”。

### D4 标注形式

- `memex_search`：命中对象增加 `"inContext": "written-this-session"` 字段。未沉底的命中不加该字段，以保持无在场卡时 JSON 逐字节一致。
- `memex_recall`：内核原文按 `## slug` 分块。重排时整块移动，在被标注卡块的标题行下方插入一行 `> In context: written earlier in this session`。不改动卡片的标题、摘要与 `Links` 行。若 stdout 无法按块解析，就不重排、不标注，原样返回（遵守“解析失败不返回可能错误的结果”的原则：这里退回原样，不报错，因为原样就是改动前的正确行为）。

### D5 遥测

`HitRecord` 增加可选字段 `demoted?: true`，只在被沉底时写入。旧记录与报告读取方不受影响；报告暂不新增统计，评估脚本直接读字段。

### D6 代码组织

新增 `src/tools/in-context.ts`，导出登记、判定和重排三个纯函数。`tools/index.ts` 只做接线。纯函数可以脱离宿主单测；真实宿主行为由运行时测试覆盖。

## Risks / Trade-offs

- [宿主改变“工具执行时最新 surface 节点”的语义] → 运行时测试锁定；失效时退化为不登记，也就是改动前的行为，而不是错误沉底。
- [多取导致内核多返回几条] → 只在有在场卡时发生，上限仍为 `MAX_SEARCH_RESULTS`；`recall` 固定 10 条，最多多取到 `10 + k`。
- [被沉底的卡在截断后不出现] → 模型上下文里已经有它；按名取回不受影响。spec 已写明这一取舍。
- [模型通过 `memex_read` 读进上下文的卡不受影响] → 列为 Non-Goal，用改动后的测量来判断是否需要扩展。
- [会话重启后登记丢失，恢复会话里的自写卡重新排在前面] → 与改动前一致；重启通常伴随上下文重建，影响有限。

## Migration Plan

1. 实现与测试通过后，dsh-memex 0.3.0 → 0.3.1，更新 `dsh.yaml` 中的 version 与 note。
2. `dsh build`，在 DSH 空闲时重启（setsid 脱离调用方进程）。
3. 回滚：把 `dsh.yaml` 中的 version 改回 0.3.0，或 `git revert` 本 change 的提交，然后重新 build 并重启。无数据迁移；遥测新字段为可选，旧代码读取时忽略。
4. 效果测量：部署后积累一段新会话，用冻结的 rubric-v3 工具（`/tmp/memex-acceptance-20261009/adoption-workspace/frozen-v3/`）对改动前后做同口径对比。主要看“明确用上”率、在场自写卡在前 3 名的占比，以及“没拿到”率是否上升。
