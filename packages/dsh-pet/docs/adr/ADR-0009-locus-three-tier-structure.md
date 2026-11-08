# ADR-0009: Locus 三层结构、普通协作成员与四个兼容补丁退役

- **Status**: Accepted（架构决定；实现不等于发布或现场验收）
- **Date**: 2026-11-03
- **Supersedes**: [ADR-0007](ADR-0007-locus-three-layer-needs-its-own-justification.md) 的待决部分及旧结构的 seam 前提；不改写其历史事实或否证过程
- **Relates to**: [ADR-0006](ADR-0006-keep-locus-inside-dsh-pet.md)、[ADR-0005](ADR-0005-locus-write-grants-full-access.md)、[ADR-0008](ADR-0008-locus-shell-tier.md)、[B040/B042](https://github.com/prgrmrwy/ohmydsh/blob/main/BACKLOG.md)、[change proposal](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/locus-three-tier-structure/proposal.md)、[design](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/locus-three-tier-structure/design.md)、[Locus delta](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md)、[collab delta](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/locus-three-tier-structure/specs/dsh-collab/spec.md)

## Context

旧两层结构把子会话直接挂到用户工作会话（`/bind`、Q&A）或 Pet 自动创建的 standby 会话下。用户会话同时承担工作归属、子会话组合来源、结算受众与归档控制，Pet 还维护代理成员 `pet`、戳/投影、协作上下文与 inquiry 执行链。这不是单个通知开关能消除的职责混合。

本次立项理由是**不再征用用户工作会话**，以及**把协作收敛到 dsh-collab 普通成员模型，删除 Pet 平行的协作/询问协议**。不是重新用「退 patch」或「消除打断」论证三层。补丁退役是新结构和官方 rc.2 API 共同消除旧前提后的结果，遵守 [compat 最小化规范](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/pet-compat-minimization/spec.md)。Locus 仍在 dsh-pet 内，不提取为新插件。

当前目标运行体为 DSH `0.2.0-rc.2`。创建与冷恢复的官方探针见 [agent-created-probe](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/locus-three-tier-structure/probes/agent-created-probe.md)；该探针使用假模型，不是实际 Host/飞书验收。此 ADR 描述已落入源码的结构与限制，不宣称已合入、部署或验收。

## Decision

### 1. 三个角色，两条不同的关系

```text
干活主会话 W（普通 root，保留原 executor/preset 与权限）
          ← dsh-collab 两个普通成员 →
Pet 自建 locus 主会话 M（普通 root，固定 locus-base）
          └─ 官方 continuable child（每入口一代，首条消息才创建）
```

- `locus_mains` 记录 `{workSessionId, locusMainSessionId, generation, status, spaceId}`；同一干活主会话任一时刻至多一个 active locus 主会话。W 留在来源 workspace，M 与其官方子会话运行在专用 DSH Pet workspace，没有 W→M runtime 父子边（2026-11-04 所有者在真机验收中确认此工作区分离）。`locus_mains.workspaceId` 记录 M 的工作区，`loci.workspaceId` 记录来源项目；项目读取守卫以持久入口绑定解析项目根，继续禁止 DSH/Pet 私有目录。已有位于来源 workspace 的 M 在空闲入口的下一次授权消息时按现有换 M 流程替换，旧 header 与历史保留。
- `loci` 内仍是父子两层：父字段指 M，child 是入口服务者。auto、Q&A、`/bind` 只在 W 的来源上不同，随后统一建立或复用 M、空间与 `not-created` 入口。绑定本身不预建 child。
- W 保留自身的执行能力、preset 与委派能力。**W 创建的 worker delegates 不属于 Locus**：不因共用 workspace 或有祖先关系获得 Pet 入口身份、current Delivery、caller-bound 工具或协作空间成员资格；Pet 也不把它们认领为 locus main/child。Locus child 的组合不会从 W 或其 worker 派生。
- M 不可用时为同一 W 建新 M，并把未被所有者停止/退役的入口迁为 `not-created` 新代际；历史会话和旧空间待办保留。单个 child 永久不可用只替换该入口一代；容量不足保留原 child、代际与请求。W 归档则停止服务并提示恢复来源或 `/bind`，不自动复活或换 W。

### 2. 组合上限固定，当前档位另行收紧

`locus-base` 是名称中性、与 channel 无关的声明式白名单 preset。它结构性排除 subagent、fork、workflow、Ralph、通用 `send_message`、agent/job 控制等委派/代执行路线，不能靠可撤销 deny 层排除它们：官方 `toolFilter` 不覆盖 agent 自有层工具。缺失 preset 或父 preset 漂移均拒绝创建、恢复或派发，不退回 standard 或 W 的 preset。

- **M**：固定 `locus-base`，用 deny 式 `tools.restrict` 去掉 bash/write/edit/委派，保留全局 `collab_*`；Host 设置并核验沙箱 `read-only`、审批 `never`。M 的 Locus 专用工具为其作用域内的 `locus_note`、`locus_reply_child`。它可活跃协调，不是必须保持 idle 的空壳。
- **child**：持久 `toolFilter` 是不含委派的宽底座，Host 在每次 `agent/created`（含 resume）安装该档位的 scoped restrict/guard、设置沙箱并回读实际工具面与策略；核验后发布 `tier3` marker。M 的 agent-scoped restrict 不会传给 child，不能误把 M 禁 shell 当成 child 不能切 shell 的理由。
- 默认 `safe` 没有通用 shell/Skill 执行与子委派，业务回复经受管 finish。所有者显式授予的 `shell` 可使用本机命令、凭据与网络，防误发 guard 不是安全边界，不能承诺防有意脚本/HTTP 绕行。文件 `read|write` 与工具 `safe|shell` 正交；write 的整机完全访问语义及当前全局关闭开关继续遵守 ADR-0005，shell 风险继续遵守 ADR-0008。新代际不继承旧提权。

### 3. 官方创建、消息与恢复协议

首条业务 Delivery 直接作为官方 `startContinuable` 的 prompt；provider 必须可证明 `inheritsParentContext=false`，不复制父历史。创建返回晚于首轮认领，因此关联必须在 `agent/created` 回调内发布：认领预留 child 身份、装配并回读、持久发布 marker/current/执行身份与一次性 first-prompt 桥。首条 inbox UUID 在认领或 API 返回时才可知；首轮 user claim 同步关联后，首个 caller-bound 工具体等待 UUID 的持久绑定成功，失败即拒绝执行，不能仅凭内存关联授权外发。

回调后创建仍可能失败，故发布有 WAL 与补偿；不能把撤掉内存 reservation 当作持久回滚。补偿失败留下恢复债务，不发布可服务的 active/current，也不猜测成功。名额不足则保留原 Delivery 与预留身份，按原 deadline 重试，不结算或换代。

后续用户 Delivery 使用官方 Host `queuePrompt` 的 `user`/`queue` 路径，保持独立后续轮次；父回复使用官方 `subagents.sendMessage`，只补充当前工作。两条路径不互相替代：rc.2 的 sendMessage 是 steer，不能承担下一条飞书 Delivery。原 current 终态之前 backlog 不入 child inbox；父消息本身不创建新 Delivery 或新回复目标。

**首图降级是有限例外，而非一般重试。** 必须同时有 typed image、结构化 `MODEL_DOES_NOT_SUPPORT_IMAGES` 和官方投递前拒绝证明，确认 prompt 未接受且未认领。先补偿旧 child，再原子交接同一 Delivery/deadline/FIFO、新 reserved child、未注入 backlog 与旧 first-child WAL，退出旧 first-prompt 桥。失败 child ID 不复用，新尝试重取 current/locus/child/pending 快照并用新执行身份；文本尝试标记持久化，只允许一次。补偿/提交不确定、有 accepted/claim/inbox 证据或文本结果不明时均不重放、不产生第三次提交。

子代结算使用**官方默认通知 M**，不再 silent；M 正是受众。结算不直达 W，也不意味着 W 已采纳结论。启动恢复用官方 `sessionQuery.observeSession` 冷读，不为只读查询物化 child：仅对 prepared 观察剔除可重算的 synthetic interrupted tail；与 synthetic 完全不可区分的真实尾部也按证据不足等待，不误结算、不重放。live 事件不剔除；可区分且精确匹配 current 的真实中断可结算失败并推进。

### 4. 非驻留变更用 desired/effective 待应用协议

常驻且空闲的 child 当场应用并回读；非驻留时不借出 Session、不为改权限强行唤醒，只记录 desired，effective 不变。发放和撤回均到下次 `agent/created` 才核验：成功后提交新 effective；失败则清掉 desired，恢复并核验原 effective 后服务。原值也不能核验或提交失败则拒绝发布；不能把 pending revocation 当作权限已撤回。

待应用结果用应用前的 `expectedRevision` CAS 提交，旧回调不能覆盖后到的新变更。管理面、投递 prompt 与回执陈述 effective 和 pending，而不是以 desired 冒充已生效；通知失败不反转已提交事实。

### 5. 两个普通协作成员，child 只读受控投影

M 是空间 Leader，W 是受邀普通成员，无代理成员 `pet`；child 没有 `collab_*`。Pet 的接入方通过 `actAs(M, ...)` 代写封闭操作集合，必须同时证明普通 root 准入、当前接入句柄与 adapter `owns(M)`，在提交及收据边界重验。Pet 只声明自己创建的 M（含历史 M）为 owned；已归档历史 M 不能再 actAs 写，但 manager 可处置其历史待办。

- child 的 `locus_context` 只返回 agreed charter 与本入口待办进度；无 `ext.pet.entry` 的 charter 是空间级，带标记的只供该入口（话题可见所在群）。不返回消息、其它入口条目、成员 status 或兄弟历史。
- `locus_note` 由 Host 打入口标记。M 用普通 collab 工具写的内容一律空间级；误把入口事实写成公共条目仍可能误泄，当前威胁模型防误泄、不防串通，不能宣称强隔离。
- child 以 caller-bound `locus_ask_parent` 问现行 M；M 用 `locus_reply_child` 回复自己的现行代 child。M 不知道干活现场事实时经 collab 问 W。返回“已投递”不等于已答复，答案不是持久授权。
- 待办由 Host 以 M 身份代写，`ext.pet.entry` 固定稳定入口身份，承接方是 W；登记不唤醒成员，不表示开工。child 不能请求执行或自行推进状态；所有者受理的真实跟进投递与 W 自行承接仍可用。待办生命周期与 Delivery 解耦，状态变化不生成飞书回复。更换 M 后旧空间待办仍可管理。

## 对 ADR-0007 四个待决事项的答复

| 待决事项 | 本次决定与边界 |
| --- | --- |
| 1. 干活现场需要协作工具吗 | 需要。W 是普通协作成员，使用全局 `collab_*`，不依赖旧 Pet `eligible()` 或父节点身份；建空间邀请在 memberTrust 下会唤醒 W 一次，只是协作指针。 |
| 2. 协作主职能与 preset 边界 | 取向 B：M 可活跃协调、是结算受众，但 preset 固定、只读、审批 never、无 shell/写入/委派；不能为扩展职能默默放宽。 |
| 3. 双向能力替代 | child → M 用 caller-bound ask，M → child 用受限 reply，M ↔ W 用 collab；child 不直接问 W、不恢复旧 inquiry 执行。缺事实不能猜答案或借机提权。 |
| 4. 普通会话常驻代价 | M 按**被绑定的干活主会话数** 1:1 配对，不按群数；普通会话无闲置驱逐，child 保留 subagent 闲置释放。常驻数量与内存需实测，尚未执行，不能用模型或单测结果代替。 |

## 两个前置的处理

### B040：运行期补偿而非超时后忽略资源

失败 provisioning 满 10 分钟后，下一次同 endpoint 建立先调用与 startup 相同的补偿器，按 durable resourceRefs 处理本次创建的 chat/child/locus main/自动工作会话。只有补偿成功才释放阻塞；补偿失败继续阻塞、记录原因，保留原失败时间以便下次立即重试，不再等一个新窗口。全部 provisioning kind 适用，不删除原来已存在的群或会话。实现见 persistence（已删除：`../../src/host/locus/persistence.ts`）；隔离/真实网络故障验收尚未执行。

### 持久层：v18 只加表，读取即退休旧模型

v18 只新增 `locus_mains`，保留旧表与旧行字节，不在离线迁移脚本创建会话或作语义性行转换。`loci` 的旧主/子关系、索引和历史仍可解释；不配对的旧行、缺失 marker 或 safe-v1/v2 行退出服务路由，不 adopt、不冷恢复旧 child，不重播旧排队工作。新一代通过新索引和后继关联退出旧路由，不靠删除 invalid 历史实现。

所有者明确 stopped/retired 的入口仍不自动复活。其余旧模型入口的下一条授权 at 可按 auto 建三层并说明退休，`/bind` 则由所有者显式选择来源。非授权 at 不建立。停机迁移、备份恢复与版本回退仍须按 [离线迁移说明](../../README.md#offline-state-version-migration) 单独操作；本次文档收口未执行迁移。

inquiry 五张表与必要解析/管理读路径仅为历史保留，**没有 runtime writer、dispatcher 或恢复续进**。`pet_inquire`、`pet_inquiry_answer`、`pet_collaboration_context*`、`pet_collaborators`、`pet_locus_parent_lookup`、`pet_locus_request_execution` 与 child `collab_*` 已退出工具面；保留历史表不表示还存在半条可接受新询问的通道。

## 四个补丁的退役与保留面

| 退役 patch | 前提如何消除／接受的边界 |
| --- | --- |
| `settlement-notice.patch` | silent → 默认 notify M；idle-create → 首 Delivery 的 startContinuable；持久独立 preset/contextMode → 固定 locus-base 父 + spawn 独立上下文；借活 Session → live agent 当场设置或待应用、官方冷读、持久组合核验；inquiry 物化随子系统退役。 |
| `inquiry-isolation.patch` | 不再接受、派发或续进 inquiry，独立 inquiry 轮认领需求消失；父子补问不冒充该协议。 |
| `native-managed-effects.patch` | inquiry 的原生 effect-owner 标记消费者与 Pet managedEffects 接缝退役，不再给四个原生工具 owner 打标。 |
| `newinquiry-tools-guard.patch` | readiness 标记消费者随 inquiry 退役，但其 Host 级最终 guard 重判不是“官方已有”等价能力；移除该行为是所有者明确接受 TOCTOU 风险后的决定。 |

launcher 不再替换 dsh-subagent、dsh-agent-loop、dsh-tools 与四个原生工具 owner，当时剩余扩展仅 **team-membership 一包**（与 Locus 无关；model-display 已在主干另行退役）。**后续更新（2026-11-04）**：team-membership 也已退役，`packages/dsh-pet/compat/` 与 `hostRuntimeCompatibility` 机制整体移除，Host 始终使用官方精确运行体；所有者接受 agent-team roster 判定窗口风险（OpenSpec change `retire-pet-host-runtime-compat`）。上文“不能称为完全无 compat 的 Host”的限定随之失效。

### 已接受的 TOCTOU 风险，未恢复最终 guard

所有者于 2026-11-03 接受：去掉 tools patch 后，scoped guard 只在官方入口判定，工具体前不再做最终重判。项目读取在 realpath 检查与实际打开之间可能被软链接交换；`tools/execute` 异步包装和 agent-loop 的 prepare → dispatch 并行名额等待可能拉长窗口。Worktree Session 的绑定清理/本地工具守卫同样受此 Host 级变化影响。原 patch 也只缩短窗口，并未消除竞态；常规 scoped guard、restrict 与受管 finish 仍各自生效，但不是最终重判的等价替代。

[调用顺序探针](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/locus-three-tier-structure/probes/dsh-tools-call-order.md) 与 design 的静态核对不是完整预览图验收。tasks 1.5 对实际隔离 launcher 中等待包装层的复核尚未执行；若发现新等待层，应交所有者重新评估，而不是在文档中声称最终 guard 已回来。以后增加包装插件或升级运行体也须重核。

## Consequences 与验收边界

- W 不再承担 Locus 父子边或子代结算；M 专职协调，child 独立历史与逐入口队列保留。新增普通 M 常驻成本与建立空间的邀请唤醒是明确代价，不承诺自动知识同步或防串通。
- 旧两层和 inquiry 历史保留，但不自动迁移其执行；pending 权限、未知发送、首图交接和补偿债务都以持久事实 fail closed，不以“最终应该成功”重播。
- [B042](https://github.com/prgrmrwy/ohmydsh/blob/main/BACKLOG.md) 已有来源归档拒绝与 `/bind` 指引；当前回执为每入口每 Host 运行最多 3 次，计数为内存状态，不能宣称跨重启持续限额。
- **本次状态：实现完成，隔离/真实网络验收未执行。** 完整测试/构建/strict 校验结果由主控记录在 change；本 ADR 不拿任务勾选或规划评审当作新测试证据。实际 launcher 包装层复核、auto/绑定/Q&A/首条惰性创建/容量恢复/分层归档迁移/非驻留授予与撤回，以及常驻数量/内存测量，仍须按 [收尾任务](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/locus-three-tier-structure/tasks.md#27-收尾) 验证；旧 change 的 bot 读权限、话题读取与真实重启恢复补验同样未完成。
- 本 ADR 不表示已合入、部署，或通过 GUI、Host、Feishu 现场验收；不更改 current specs 或归档历史的发布状态。
