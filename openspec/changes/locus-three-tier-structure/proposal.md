## Why

Locus 目前是两层：子会话直接挂在一个"主会话"下。auto 时主会话是 Pet 自建的 standby，`/bind` 与 Q&A 时则征用用户正在工作的会话。由此带来三类真实问题：

1. **征用用户工作会话**：ADR-0007 的生产快照显示被征用的工作会话是最高频的父会话（≥31%）。用户的工作会话因此承担结算通知、子会话组合源与归档劫持（B042，`resolution.ts` 及 locus 目录内大量 archived 特判）。
2. **协作靠 Pet 自建的平行机制**：代理成员 `pet`、`locusId` 戳与投影、`collaboration_contexts` 表、`pet_inquire`/`pet_inquiry_answer` 询问链，与已上线的 dsh-collab 重复。
3. **依赖兼容补丁**：`settlement-notice.patch` 提供静默结算、空闲创建子会话、借出活子会话 Session 等官方没有的能力，升级 DSH 时需持续维护。

ADR-0007 规定三层只能以自身理由立项，并须先回答四个待决事项与两个前置（B040、持久层语义迁移）。本 change 以上面第 1、2 条为立项理由（不以"退 patch"立项），并在 design 中逐条回应；结论记入新 ADR-0009，取代 ADR-0007 的"待决"部分。

## What Changes

- **三层结构**：干活主会话（用户的普通一级会话）←dsh-collab→ Pet 创建的一级 **locus 主会话**（与干活主会话 1:1）→ 只读 **locus 子会话**（父为 locus 主会话）。`loci` 表仍只有两层父子关系，父为 locus 主会话；干活主会话与 locus 主会话的 1:1 关系记在新表中。
- **子会话惰性创建**：第一条入站消息到达时，用官方 `startContinuable` 携带首条 prompt 创建；此前入口处于"未创建"状态。**BREAKING**（Pet 内部）：不再使用 `createIdleContinuable`。
- **auto / Q&A / 显式绑定合并为同一路径**：auto 时 Pet 新建干活主会话与 locus 主会话；Q&A 与 `/bind` 绑定到已有干活主会话并为其建立（或复用）locus 主会话。干活主会话归档时入口停止服务并提示 `/bind`。
- **换绑规则**：入口不可用 → 在同一 locus 主会话下新开一代（标为未创建）；locus 主会话不可用 → 为该干活主会话新建 locus 主会话并迁移全部入口。
- **协作改走 dsh-collab 普通成员**：干活主会话与 locus 主会话都是普通成员；删除代理成员 `pet`、`locusId` 戳、投影与 recipients 用法；子会话没有 collab 工具。待办由 Host 以 locus 主会话身份代写（`ext` 带稳定入口身份）。dsh-collab 接入方句柄新增 **`actAs`**：以接入方声明"拥有"的普通一级会话身份执行封闭操作集合（建空间、邀请、写条目、发消息、读取），供 Host 以 locus 主会话身份建空间、邀请干活主会话并代写待办。（原定"只加 invite 操作"不够：现有句柄只能以实际调用会话身份写，子会话调用时无法代写。）
- **新工具**：子会话 `locus_ask_parent`（只能向现行父 locus 主会话提问）与只读 `locus_context`（工作空间级 + 本入口级，含所在群；只返回 agreed charter 与本入口待办进度，不返回消息）；locus 主会话 `locus_note`（写入口级条目）与 `locus_reply_child`（Host 内部用官方 `subagents.sendMessage` 回复子会话）。
- **退役**：`pet_locus_request_execution`（只有人能承接执行）；`pet_collaboration_context*`、`pet_collaborators` 与 `collaboration_contexts` 表；整个 `pet-inquiry-runtime-channel` 能力（`pet_inquire`/`pet_inquiry_answer`、`host/inquiry/*`、5 张 inquiry 表保留只读、不再写入）；兼容补丁退役 4 个：`settlement-notice.patch`、`inquiry-isolation.patch`、`newinquiry-tools-guard.patch`、`native-managed-effects.patch`（`inquiry-isolation`、`native-managed-effects` 只服务 inquiry；`newinquiry-tools-guard` 的工具体前守卫重判是 Host 级行为，也覆盖 Pet 项目读取与 Worktree Session 守卫，其退役是所有者接受时间窗风险后的决定，见 design Risks），连同其构建校验与测试；保留 `team-membership.patch`，`model-display.patch` 不在本次范围。退役补丁是本 change 的核心目标之一。
- **组合**：白名单 preset 定上限（与 channel 无关、命名中性、永不含委派工具）；locus 主会话用官方 `tools.restrict` 的 deny 式挡 bash/write/edit/委派、保留 collab，并由 Host 设审批 `never`、沙箱 `read-only`；子会话用 `toolFilter` allow，沙箱在 `agent/created` 中 `setSandboxMode` 并回读。默认档只读；write/shell 档保留为所有者显式授予的上限，档位沿用现有的同一子会话就地切换（不新开一代）。
- **前置一并解决**：B040（失败的 provisioning 超时后不再阻塞，并在运行期调用补偿器）；持久层迁移采用"新增表 + 旧模型行在读取时按退休规则解释"，不改写旧行。
- **ADR**：新增 ADR-0009；ADR-0006、ADR-0007 加注记。

## Capabilities

### New Capabilities
（无；全部落在现有 capability 中）

### Modified Capabilities
- `pet-locus-collaboration`：三层实体、惰性创建、绑定/换绑/归档规则、组合与档位、启动恢复证据来源、代理成员相关条款删除。
- `pet-locus-intent-triage`：待办改由 Host 以 locus 主会话身份代写；删除请求执行与代理路由；父会话查阅改为 `locus_context`。
- `dsh-pet`：子会话创建契约、结算通知、preset 声明、子代名额。
- `pet-inquiry-runtime-channel`：整体 REMOVED。
- `pet-compat-minimization`：requirement 不变；`settlement-notice.patch` 的逐项退役依据记录在 design 决策 4–6，其余三个补丁的依据在决策 11。
- `dsh-collab`：接入方句柄新增 `actAs` 与 adapter `owns`；`disposeRequest` 传入拥有判定。
- `collab-kernel`：`disposeManagedRequest` 允许处置接入方拥有的普通会话登记的 request。

## Impact

- 代码：`packages/dsh-pet/src/host/{locus,collab,collaboration,inquiry,channel}/`、`src/index.ts`、`host/spec.ts`（domain version 18）、`scripts/migrate-state-version.mjs`、`presets/`（新白名单 preset）、`compat/subagent/*.patch`、`packages/dsh-collab/src/integration.ts`。
- 部署：`dsh.yaml` 中 Pet 与 compat overlay 说明同步；迁移需停 Host 运行 migrate 脚本。
- 兼容：旧模型 locus 行不改写，读取时按退休规则处理，所有者需对旧入口 `/bind` 或重新 @ 建立新结构。
- 依赖：本 change 以三个在途 Pet change（shell-tier、feishu-read-and-delivery-fixes、interrupted-delivery-recovery）归档后的 spec 为基础。
- 不在范围：跨机 collab（`collab-cross-machine-spi`）、托管成员机制的裁剪（Pet 不再用代理成员，但 dsh-collab 的托管 SPI 保留）。
