## Why

2026-10-12 的 locus 会话 `session-82bccfbf` 暴露了一组同源缺陷：作为飞书入口的 locus child 在本群被要求"整理群聊上下文"时，既没有任何飞书读取能力，也不知道自己处于哪个工具档；它只能登记待办把活转给主会话，主会话再用**用户身份**读群才把事做完。

事后逐项查实：

1. 投递 prompt 的**首投前言从未发送**——位置判据把"当前这条 Delivery"算作历史（`src/index.ts` 的 `priorDeliveries.length > 0`，而调用顺序是 accept 先持久化、之后才渲染），`first` 分支不可达，child 因此拿不到档位能力、权限、上下文锚点与按需读取说明。该回归自 `05aacdd4`（2026-09-15）起存在。
2. `safe` 档 child 的工具面里**没有任何群读取工具**（飞书读取被设计在 `shell` 档），而当时应用的 bot 身份还缺群历史读取权限（`im:message.group_msg`），`--as bot` 读群一律 `230027`。
3. 该权限已于 2026-10-12 开通并实测通过（CLI 与 raw API 的 bot 身份均可读）；但即使权限到位，`safe` 档 child 仍缺 Pet 侧的结构化只读手段。
4. 另有三个次级缺陷：守卫拒绝只回裸 code、无可执行指引；未装配的协作上下文工具以"可见但必然失败"暴露；待办工具失败不给下一步，且 child 在待办尚未开始时就在群里承诺进度。

本 change 收敛为**只读能力的 bot-only 版 + 投递与反馈修复**。两项契约更重的改动经评审后拆分到后续独立 change（见 Deferred）。

## What Changes

- **投递 prompt**：首投前言的判据改为"该 child 是否已有**被证明进入 inbox** 的投递"（渲染但未入队不消耗首投；不再依赖渲染顺序）；后续每次投递声明当前持久档位能力，档位取自持久记录而非默认值。
- **child 的当前入口群只读能力（新增）**：caller-bound 工具，**bot 身份**读当前入口群；**无 chat/群/用户/thread 参数**（入口为话题时范围由 Host 从入口事实推导）；续读**游标由 Host 签发**并绑定 child 代际、入口、方向与窗口，篡改/跨域/过期 fail closed；单次结果有可度量预算与截断标记；失败与空结果可区分；`safe` 与 `shell` 档都装配并同步 attestation 白名单。
- **能力声明如实**：向 Agent/用户声明"可读群历史"之前必须在本入口上有界实测；超时或不可判定按未确认声明；不复用过期缓存；探针内容不落持久层。
- **守卫**：拒绝返回稳定原因码 + 被允许根 + 申请方式；**不放宽任何工作区外读取**；Host 自动发送的正文不含诊断，受管出站不在模型正文之外附加内容。
- **反馈类**：未装配的 caller-bound 能力不再"可见但必失败"；待办工具失败给出可执行下一步且不枚举其它标识；登记后的回复与待办持久状态一致。
- **规范卫生**：清除 `pet-lark-channel` 当前 spec 中两处重复块。

### Deferred（拆分到后续独立 change，本 change 不做）

- **user 身份只读回落**：需要"可回落主体"校验、正向错误分类白名单与操作集约束，并更新 `pet-lark-channel` 身份要求与 ADR。评审 round 1 的 C4 指出当前方案无法证明这种回落的授权边界。
- **本 child 溢出文件可读**：需要 Host 可信的 spill root 与伪造/软链/硬链/替换竞态用例。评审 round 1 的 C1 指出按目录形状放行只能证明"看起来像"，不能证明"内容是本 child 产生的"。不可得时应 fail closed。

两项已登记 `BACKLOG.md`，并保留评审给出的契约要求作为后续 change 的输入。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-lark-channel`: 新增"对外声明的群读取能力按实测判定且不虚报"（含探测生命周期）。
- `pet-locus-collaboration`: 新增当前入口群 caller-bound 只读能力（游标与预算契约）、首投前言与逐次档位声明、守卫拒绝可诊断且不额外放行、未装配能力不得"可见但必失败"。
- `pet-locus-intent-triage`: 新增"登记后回复与待办状态一致、待办工具失败给出可执行下一步"。

## Impact

- **代码**：`packages/dsh-pet`（`src/index.ts` 的投递渲染与能力事实、`src/host/locus/{context,composition,tools}.ts`、`src/host/channel/{lark,qa/prompt}.ts`、`src/host/locus/project-read-guard.ts` 的拒绝文案）与其测试。
- **规范/文档**：`openspec/specs/pet-lark-channel/spec.md`（清理重复块）；本 change 的 delta 合并；`BACKLOG.md` 新增两条后续工作。
- **不做**：不改只读身份策略（仍 bot-only）、不改 ADR、不放宽读取守卫、不改 DSH core、不新增第三方依赖。
- **部署**：改动需 `dsh build` + 重启 Host 生效（重启会打断当前会话）。
- **在途协调**：`pet-locus-shell-tier`（7.4 归档待办）定义工具档位，本 change 的档位声明与其措辞一致；`pet-locus-independent-agent-inquiries` 负责协作上下文装配，本 change 只要求"未装配不得以必然失败的形式暴露"。
