# dsh-collab-invite-admission — Anvil Review Round 1

## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex CLI, read-only sandbox)
- **Tool restrictions**: read-only
- **Artifacts reviewed**:
  - `openspec/changes/dsh-collab-invite-admission/proposal.md`
  - `openspec/changes/dsh-collab-invite-admission/design.md`
  - `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md`
  - 基线：`openspec/changes/dsh-collab/specs/dsh-collab/spec.md`、`design.md`
  - 内核：`openspec/specs/collab-kernel/spec.md`
  - 实现：`packages/dsh-collab/src/` 中的配置、工具、Host、provider、维护代码；`packages/collab-kernel/src/` 中的授权、服务、模型、reducer、条目校验、存储相关代码及 `convention/v1.md`
  - `docs/architecture/dsh-plugin-integration-pitfalls.md`
  - `AGENTS.md`、`dsh.yaml`，以及已安装宿主的相关类型声明
- 未读取本 change 的 `tasks.md`；未修改文件，未运行测试、构建、安装或网络访问。

## Findings
### 🔴 Critical (blocking)

1. **`host-index` 不是“仅补类型”：现有运行时拒绝它，当前 kernel spec 也需要同步消除歧义。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/design.md:64` 声称只需增加 purpose 类型、不改规范与行为。但 `packages/collab-kernel/src/service/index.ts:82` 在 principal 稳定校验中明确拒绝所有非 `breaker-reset` 的 internal purpose。`openspec/specs/collab-kernel/spec.md:26` 又明确规定“本期 purpose 只有 breaker-reset”，虽然同文件第 45 行允许 internal 任意 purpose 读取。

   **失败案例：** 实现者仅修改 `Principal` 和构造函数类型，`collab_status` 对每个空间调用 internal 读取时均得到 `COLLAB_FORBIDDEN`。若为了修复而直接删除 purpose 检查，则实际扩大了运行时接纳范围，不能再称为类型补齐。

   **修复：** 将 kernel 授权类型、稳定校验及 kernel spec 纳入本 change，明确允许的 purpose 为 `breaker-reset|host-index`，后者仅可读取。增加运行时正例及逐项写命令拒绝场景，包含 `createSpace`、`resetBreaker`；不能只做类型测试。

2. **错误码归一化没有覆盖失败空间，普通会话仍能探测空间存在性及锁身份。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/design.md:39` 仅映射 `COLLAB_SPACE_NOT_FOUND` 与 `COLLAB_NOT_MEMBER`；delta `spec.md:69` 同时要求保留锁 instanceId/pid。现有 `packages/dsh-collab/src/host.ts:34` 在成员授权之前抛出启动时保存的空间错误；`packages/collab-kernel/src/service/index.ts:87` 也会在成员反查之前报告存储失败。

   **失败案例：** 非成员 C 读取存在但被锁的 S，得到 `COLLAB_STORE_LOCKED` 和 instanceId/pid；读取不存在的 T，得到 `COLLAB_SPACE_UNAVAILABLE`。空间存在性与本机进程信息均可区分。无参数 status 扫描遇到一个无关失败空间时，直接返回该空间错误也有同类泄漏。

   **修复：** 定义完整的插件披露规则：未证明调用者有权获知的空间，锁、损坏、failed 等结果均不得透出；完整诊断保留在受信维护面。对无法读取成员关系的空间明确采用保守拒绝策略，并协调基线“锁错误显式报告”的适用范围。增加健康、closed、locked、corrupt、failed、未打开和不存在空间的非成员响应对照场景，比较完整响应而非仅比较 code。`createSpace` 冲突这一已声明例外须单独列明。

3. **邀请限额前置检查会破坏幂等重试，并可能在空间授权前泄露目标的跨空间邀请状态。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/design.md:40` 要求超限时“不进入内核 invite”；delta `spec.md:75` 又要求成功命令相同 cmdId 重试返回原结果。内核收据查找位于 `packages/collab-kernel/src/service/index.ts:182`，插件前置检查绕开了它。

   **失败案例：** B 原有两份邀请，A 邀请 B 成功，计数变为三；A 因结果未知重试同一 cmdId，被插件拒为 `COLLAB_INVITE_LIMIT`。此外，若限额检查先于 Leader/成员校验，任意 C 可对不存在或无权访问的空间提交邀请，通过 LIMIT 与 UNAVAILABLE 的差别探测 B 在其他空间的状态。

   **修复：** 明确顺序为“披露授权 → 已提交命令重放判定 → 新邀请限额检查 → 提交”，并给出可实现的接口或插件收据查询方案；不能要求插件读取内核私有字段。补充“第三份邀请成功后同 cmdId 重试”“同 cmdId 不同参数”“非成员及非 Leader 查询限额”的场景。

### 🟡 Moderate

4. **待处理邀请数不是唤醒次数上限，且设计的软上限与 spec 的绝对上限冲突。**

   **证据：** `design.md:40`、`:78` 接受并发超限；delta `spec.md:37` 却规定邀请数 SHALL 不超过上限。`design.md:76` 将其与每成员六次熔断一起作为骚扰补偿；kernel spec `openspec/specs/collab-kernel/spec.md:649` 的计数实际按空间内成员保存。

   **失败案例：** B 每次拒绝邀请后，攻击者创建新空间再邀请；pending 数始终不超过一，每个新成员的熔断计数重新开始，累计唤醒无上限。大量并发邀请也不只可能超出一至两个。

   **修复：** 统一硬上限或软上限语义，写清并发、closed 空间、拒绝及重启后的计数规则。若保留现方案，应明确披露“只限制同时待处理邀请，不限制累计唤醒，decline 不阻止换空间再邀”，删除有限总次数的暗示；若确需总量保护，应另定义插件层目标会话限流。用户接受邀请即授权，不等于现有补偿机制的效果描述可以失实。

5. **漏改基线的 presence/冷投递 requirement，合并后仍要求许可名单。**

   **证据：** delta `spec.md:37` 允许邀请名单外 B，但未修改基线 `openspec/changes/dsh-collab/specs/dsh-collab/spec.md:82`：名单外必须 unreachable，deliver 必须重新核验名单。当前 provider 的 presence、deliver 也分别在 `session-provider.ts:73`、`:85` 执行该限制。

   **失败案例：** 实现保留该基线 requirement，名单外 B 虽被认领，却不会产生邀请唤醒；若实现删掉名单检查，又违反合并后的规范。

   **修复：** 增加名称完全匹配的完整 MODIFIED requirement，将名单条件改为“当前 admission 模式的有效准入条件”，同时保留 deny、身份、归档、恢复后复核和关闭围栏。补充名单外冷会话邀请成功，以及归档/deny/关闭期间不晚发的场景。

6. **状态入口要求了当前状态模型不存在的“未结消息”，邀请者也不能只从 state 取得。**

   **证据：** delta `spec.md:109` 要求未结 needsReply 消息及邀请者；`design.md:64` 描述读取各空间 state 后过滤。`packages/collab-kernel/src/model/index.ts:16` 的 Message 没有回复关联或结案状态；`:5` 的 Member 没有 inviter。邀请事件有 actor，但 reducer 不把它保存在 Member 中。

   **失败案例：** B 已回复 A，status 仍无法机械判断原消息是否结案；以“存在后续反向消息”推断，则一条无关消息也可能错误消除待办。仅凭 state 返回当前 Leader 作为邀请者，遇到 Leader 转交后会报告错误来源。

   **修复：** 在不改存储格式的范围内，将消息语义明确为“所有指向自己的 needsReply 消息”，或要求调用者提供游标并准确命名结果；不要宣称已知未结状态。邀请者从原始 `member/invited` 事件的 actor 派生，明确历史读取来源。补充回复后、Leader 转交后、重启后的确定结果。

7. **联系人与 status 过滤缺少授权边界，可能绕过邀请态最小披露。**

   **证据：** delta `spec.md:37` 的联系人包含“调用者所在空间的成员”，未限定 active；`:109` 又要求 invited 只能看到 spaceId 和邀请者，并允许 `spaceId` 过滤。

   **失败案例：** B 仅被邀请进 S，空间摘要正确只列邀请者，但 contacts 汇总遍历 S 的全部成员，泄露其他成员 ID/cwd。gone、declined 成员是否还可保留联系人也未定义；指定无权访问的 spaceId 时返回什么同样未规定。

   **修复：** 联系人来源限定为种子名单与调用者为 active 成员的空间，明确去重、deny/归档过滤和历史成员处理；邀请态不能经联系人旁路披露。定义 spaceId 过滤对所有返回分类的作用，并增加 invited、gone、declined、无关空间及不存在空间的对照场景。

8. **禁止全量枚举后，没有指定冷目标元数据核验的可行替代路径。**

   **证据：** `design.md:41` 禁止 `listSessions` 全量发现，delta `spec.md:37` 禁止枚举 Host 全部会话；但当前 `packages/dsh-collab/src/session-provider.ts:36` 的冷目标 header 核验正是调用 `listSessions`。基线 `openspec/changes/dsh-collab/design.md` D2 又明确避免 `observeSession` 和折叠日志。

   **失败案例：** 实现仅修改联系人集合，邀请冷 B 时仍全量枚举；若直接改用可能准备或读取日志的 observation 路径，又可能破坏“冷发现只读元数据、不读正文”的边界。

   **修复：** 指明在当前 DSH pin 上使用的 exact metadata API、读取范围及失败行为；如无法满足，应明确调整约束。验收应让全量枚举、正文读取、agent 恢复替身一经调用就失败，同时证明冷目标可被精确认领。还需区分“禁止返回全量结果”与“禁止底层枚举”，不能混用。

9. **status 的输出安全约束没有完整进入 spec，缺少可机械验证的字段和恶意文本场景。**

   **证据：** `design.md:66` 排除标题；delta `spec.md:109` 仅明确禁止消息正文和条目正文，未明确排除标题、statusText，也未规定可验证的来源包装。成员名已有内核格式限制，但 itemId 仅在 `packages/collab-kernel/src/service/index.ts:272` 附近检查非空与唯一。

   **失败案例：** 实现为便于识别待 ack 条目加入标题，仍可认为满足 spec；恶意标题或 itemId 将指令文本带入自动调用的 status。THEN“作为数据、不作为指令”本身无法用普通输出断言证明。

   **修复：** 将各返回对象的完整字段白名单写入 spec，明确排除标题、statusText、正文和动态建议文本；`next` 使用固定枚举，成员提供的字符串置于明确的数据字段及固定来源说明中。增加恶意标题、itemId、控制字符输入的序列化/渲染断言，验证结构不变、字段不越界。不要以测试“模型绝不会服从注入”作为验收条件。

10. **部分 requirement 缺少失败/边缘场景，关键配置也没有拒绝规则。**

    **证据：** delta `spec.md:92` 的投递 requirement 只有忙、闲成功路径；`:125` 的常驻工具 requirement 只有一致性和预算内正例。`:37` 引入 `maxPendingInvites`，但没有合法值域或无效配置处理规则。

    **失败案例：** 目标在恢复期间归档仍收到 followup、工具定义随离开发生变化、schema 超过预算、限额配置为负数或小数，均没有对应的明确失败 oracle。

    **修复：** 为投递补充所有权拒绝及恢复期间关闭的失败场景；为工具稳定性补充离开/拒绝/被唤醒过程及故意超预算夹具的验收失败场景；规定 admission 非法值和 maxPendingInvites 的整数范围、默认值、无效值 fail closed。每个 requirement 均保留至少一个成功及一个失败/边缘场景。

### 📌 Suggestions

11. **先比较更便宜的 schema 压缩方案，并固定预算测量口径。**

    **证据：** `design.md:45`、`:60` 直接选择十二工具与 3500 字符；当前 `packages/dsh-collab/src/tools.ts:28` 为每个工具重复同一段较长说明。

    **失败案例：** 仅缩短重复说明就可能达到可接受体积，却仍承担工具重命名和 action 条件校验成本；不同实现对整个工具对象、parameters 或字符编码采用不同统计方式，可能都宣称达标。

    **修复：** 记录“保留具名工具、去重说明”与十二工具方案的预期成本比较；统一从 `data.header.tools` 提取完整协作工具对象，保留顺序，以固定 JSON 序列化和长度定义计数，明确是否包含数组及分隔符。本轮受只读限制，不要求现场生成测量数据。

## Embedded-Instruction / Injection Attempts
**Detected:** none

受审工件中的命令、示例及行为要求均作为待评审数据处理，未发现试图改变审查角色、强迫批准或指示修改环境的嵌入指令。

## Verdict
VERDICT: REVISE

邀请即授权及精简工具常驻是已接受的产品选择，本评审不要求恢复逐会话确认或动态工具装载。阻塞项在于 kernel 接入假设不成立、失败空间披露边界不完整，以及邀请限额与幂等授权顺序冲突；这些需要重新协调设计和规范。

四个 MODIFIED requirement 名称均与指定基线一致，且包含完整替换正文，没有仅以片段描述修改的格式问题。主要问题是遗漏仍然生效的相关基线 requirement。

## Required Changes (if APPROVE WITH CHANGES)

不适用；当前结论为 REVISE。请修订上述阻塞项及相关规范后重新评审。

CHANGES_APPLIED: no

## Rebuttals