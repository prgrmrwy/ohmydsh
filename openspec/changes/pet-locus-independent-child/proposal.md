## Why

答疑群提问后子会话「只 done 没回复」：child 由 `provider: 'fork'` 创建，继承父会话全部历史，于是继续扮演 GUI 里的主 agent，把结论写成普通 assistant 文本，从未调用 `pet_locus_reply`。Delivery 因 turn 正常结束被 settled，飞书侧一个字都没收到。

根因仍在：`packages/dsh-pet/src/host/locus/child.ts` 的 `DEFAULT_CHILD_PROVIDER = 'fork'` 被三条创建路径共用。B035 从该故障出发扩展为完整协作平台（公共事实、协作者发现、异步询问、跨轮续进、G1–G5），57 项任务反而挡住了「先把 Pet Locus 用起来」。

所有者决定收敛：本 change 只做独立 child 与可靠回复出口，让 Pet Locus 可验收、可使用。上下文切换记录见 `docs/notes/pet-locus-independent-child-handoff.md`。

## What Changes

- 新建与显式重建的 locus child 改用零父上下文的 provider，不再复制父 transcript，也不注入默认父摘要。
- 创建前显式核验 provider 确实不继承父上下文；不满足时 fail closed，不静默退回 fork。
- Locus 记录持久化上下文模式：`fork-prefix-v1`、`independent-v1`、`unknown`。已有行在无证据时保持 `unknown`，旧 fork child 不被静默改造，历史不丢失。
- 投递前言保持既有边界不变：业务正文唯一出口是 `pet_locus_reply`；缺锚点时通过 DSH 原生 `send_message` 询问 caller-bound 主会话；不自动把结论回传主会话。
- 本期用「问父，父再按需问子」替代公共事实持久层；不新增共享记录、不新建文件夹、不迁移局部锚点。

## Capabilities

### Modified Capabilities

- `pet-locus-collaboration`：新 child 使用独立上下文而非父前缀继承；持久化并展示上下文模式；旧 fork child 保留原模式与历史。

## Impact

- Pet Host：`src/host/locus/child.ts` 的 provider 选择与能力核验；`src/host/spec.ts` 增加 locus 上下文模式字段（additive）；`src/index.ts` 创建路径传递模式。
- 数据：仅新增可选字段，不转换、不清除既有行；未知模式不猜测。
- 冷恢复：本期不改变现有恢复语义。已复核固定 runtime：主会话产生过任何一轮 turn 后其自身 preset 选择即被锁死（`agent-preset/locked`），child 创建与冷恢复统一通过 `composeFrom(parent)` 绑定父的 standing composition，因此不存在「父会话切换 preset 导致 child 冷恢复漂移」的场景；此前设计文档中的相关描述已更正，见 `design.md` D3。
- 不在本期：公共事实持久层、协作者名单工具、异步询问、结果续进、owner projection、G3/G4/G5 runtime 门槛。相关代码保留在仓库中且保持 fail-closed。
- 前置：`pet-unified-locus-collaboration` 仍未归档；本 change 不依赖其归档即可实施，但归档顺序仍需在收尾时对齐。
