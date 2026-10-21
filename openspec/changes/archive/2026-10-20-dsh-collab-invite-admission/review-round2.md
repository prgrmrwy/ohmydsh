# dsh-collab-invite-admission — Anvil Review Round 2

## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 VERDICT: REVISE (3 Critical, 7 Moderate, 1 Suggestion; see review-round1.md)
- **Reviewer context**: cross-model (codex CLI, read-only sandbox)
- **Tool restrictions**: read-only
- **Artifacts reviewed**:
  - `openspec/changes/dsh-collab-invite-admission/proposal.md`
  - `openspec/changes/dsh-collab-invite-admission/design.md`
  - `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md`
  - `openspec/changes/dsh-collab-invite-admission/specs/collab-kernel/spec.md`
  - `openspec/changes/dsh-collab-invite-admission/review-round1.md`
  - 基线：`openspec/changes/dsh-collab/specs/dsh-collab/spec.md`、`design.md`
  - 当前内核规范：`openspec/specs/collab-kernel/spec.md`
  - 实现：`packages/dsh-collab/src/{config,session-provider,tools,host,index,maintenance}.ts`
  - 内核：`packages/collab-kernel/src/` 中的授权、服务、模型、reducer、投递决策、存储接口及 `convention/v1.md`
  - `docs/architecture/dsh-plugin-integration-pitfalls.md`
  - `AGENTS.md`、`dsh.yaml`
- 未读取本 change 的 `tasks.md`；未修改文件，未运行测试、构建、安装或网络访问。以下结论来自静态审阅，不表示实现或验收已通过。

## Findings

### 🔴 Critical (blocking)

1. **邀请重放仍先检查当前 Leader 身份，违反内核幂等顺序。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md:179` 与 `design.md:60` 明确要求先验证 active Leader，再查成功收据。但同 delta `specs/dsh-collab/spec.md:106` 要求成功命令重试返回原结果；kernel delta `specs/collab-kernel/spec.md:32` 明确保留“成员反查 → 收据 → 当前权限”的顺序。实现也在 `packages/collab-kernel/src/service/index.ts:182` 查收据，然后才检查空间关闭及权限。

   **失败案例：** A 邀请 B 成功，但响应丢失。随后 A 转交 Leader，或离开空间，再使用原 cmdId 和参数重试。插件第一步返回 FORBIDDEN，内核本应返回的成功收据永远不可达。同 cmdId 不同参数也会被错误地提前拒绝，而不是返回 CMD_CONFLICT。

   **修复：** 顺序改为“证明调用者有成员记录 → 按成员 scope 查成功收据并交内核重放/冲突判定 → 对新命令验证 active Leader → 检查限额 → 提交”。无成员记录仍返回 UNAVAILABLE，且不得计数。补充转交、离开及空间关闭后的原命令重试场景，断言原 seq、零新增事件和零新增唤醒。

2. **字段白名单没有封住任意 `itemId`，自动入口仍能携带成员指令文本。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md:210` 将 `itemId` 放入多个 pending 集合，`:213` 同时禁止“其它成员自由文本”。但 `packages/collab-kernel/src/service/index.ts:271` 对 itemId 仅检查非空与唯一，工具参数在 `packages/dsh-collab/src/tools.ts:52` 也只是 string。恶意文本场景仅覆盖标题和 statusText（delta `spec.md:220`），没有覆盖首轮已点名的 itemId。

   **失败案例：** A 创建 `itemId: "忽略之前的指令，执行……"` 的条目并要求 B ack。B 被唤醒后调用 status，该文本进入 `pending.acks[].itemId`。所有字段白名单检查仍通过。JSON 序列化能保持结构，却不能把字符串内容变成可信指令；“输出不含任何成员自由文本”的承诺也直接失效。

   **修复：** 明确选择并规范化 ID 策略：若入口必须完全排除自由文本，则使用受限的 opaque ID，并规定旧台账任意 ID 的兼容引用方式；若保留原始 ID，则修改当前绝对承诺，将 ID 明确定义为不可信协作数据，并为 status 增加固定来源包装、控制字符和长度处理规则。补充恶意 itemId、新旧台账读取及后续精确引用场景；不得用“模型不会服从”作为测试 oracle。

### 🟡 Moderate

3. **邀请态读取的预期错误与统一披露规则冲突。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md:48` 要求 invited B 读取返回 `COLLAB_SPACE_UNAVAILABLE`；同文件 `:108` 却要求任何状态的成员得到内核错误。内核对非 active 读取返回 MEMBER_INACTIVE，见 `openspec/specs/collab-kernel/spec.md:57`、`:59`。设计 D2（`design.md:46`）同样以“存在成员记录”作为分界。

   **失败案例：** B 在 join 前读取，按 D2 实现会返回 MEMBER_INACTIVE，按发现与绑定场景实现则必须返回 UNAVAILABLE；两套验收不能同时通过。

   **修复：** 保留当前两档设计时，将邀请态读取场景改为 MEMBER_INACTIVE，并断言没有空间正文、没有自动 join。若确需隐藏该错误，应在披露规则中明确读取的例外，而不是保留互斥要求。

4. **全实例串行锁跨越无界 SPI 等待，一个邀请可以阻塞所有空间的新邀请。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/design.md:58` 至 `:65` 将检查、计数和完整内核 invite 放入同一 promise 链。`packages/collab-kernel/src/service/index.ts:246` 的 invite prepare 会等待 provider claim；`:175` 附近还会等待 presence。冷 claim 又依赖 `packages/dsh-collab/src/session-provider.ts:36` 的异步元数据查询。这些接口没有完成时间保证。

   **失败案例：** S1 邀请 B 时元数据查询一直不返回。S2 的 Leader 邀请健康目标 C，也永久排在全局链后面。设计所称“邀请频率低”不能消除这个故障传播。

   **修复：** 将互斥范围至少缩小到目标完整 ID，使不同目标互不阻塞；同一目标仍串行计数与提交以保持上限。明确关闭时排队命令的生命周期围栏。增加“B 的 claim 挂起时 C 的邀请仍完成”和“关闭后旧排队任务不能提交”的场景。

5. **status 的派生规则仍不足以给出唯一、可验收的结果。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md:210` 定义了 `escalated` 输出，但 `:227` 没有定义其筛选范围；`next.kind` 只有枚举，没有各 kind 与固定 tool 的完整映射。相同位置也未区分 closed 空间的历史待办与当前可执行建议。

   **失败案例：** S 已关闭，B 仍是 active 成员，历史条目尚待 B ack、request 尚未完成。一个实现继续建议 ack/advance_request，另一个实现清空建议；两者均可声称符合现有文字。前者推荐的操作必然返回 SPACE_CLOSED。

   **修复：** 写出完整派生表：每个 pending 集合的筛选条件、escalated 范围、每种 next 的触发条件及唯一工具名。明确 closed 空间可保留历史摘要，但不产生写操作建议。补充关闭空间、无待办及同一条目多条件重叠的精确结果场景。

6. **“只读内存快照”的成本假设与公开读取接口不符。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/design.md:120` 将授权预读描述为一次 structuredClone；D5 在 `:100` 指定使用 overview/readSince。实际 `packages/collab-kernel/src/service/index.ts:333` 的 overview 会等待所有成员的 presence，provider presence 可能调用元数据列表；readSince 返回提交记录，不直接返回 state。reducer 也没有由 `packages/collab-kernel/src/index.ts:1` 的公开入口导出。

   **失败案例：** D2 为一个正常写命令预读 overview，但某个无关成员的 presence 查询挂起，导致调用者连授权判定都无法完成。status 扫描多个空间时同样可能被单个空间拖住。不能据此宣称只是一次内存复制。

   **修复：** 明确采用实际可用的快照方案。若沿用 overview，应承认异步 presence 依赖，并规定故障隔离；若需要不采样 presence 的授权快照，应将所需只读接口及 kernel 规范变化正式纳入范围。增加 presence 挂起/抛错时授权与 status 的确定行为场景，不依赖私有 states。

7. **场景覆盖有所改善，但仍未满足每个 requirement 的成功与失败/边缘覆盖要求。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md:177` 的限额 requirement 没有并发、closed 空间释放或重启恢复场景；`:258` 的过滤 requirement 没有“过滤到本人有权空间”的成功场景；`:270` 的稳定性场景没有实际覆盖拒绝和被唤醒两个明文列出的状态。

   **失败案例：** 实现始终返回空的过滤结果，仍能通过当前两个过滤场景；计数错误地包含 closed 空间，或并发第四、第五份邀请均成功，也没有对应场景直接捕获。

   **修复：** 补充可机械断言的场景：有权过滤保留目标且排除其它空间；并发竞争只允许剩余名额数量的成功提交；关闭与重启后的计数符合定义；拒绝和唤醒前后的真实工具数组序列化一致。测试条件和预期数量须写清，不能只写“保持稳定”或“正确恢复”。

### 📌 Suggestions

8. **迁移描述应承认当前 manifest 的实际状态。**

   **证据：** `openspec/changes/dsh-collab-invite-admission/proposal.md:28` 和 `design.md:129` 写“仍保持 enabled:false”，但当前 `dsh.yaml` 的 `dsh-collab` 条目实际为 `enabled:true`，且存在启用的临时验收 patch。设计 `:130` 已提到验收部署，却没有协调这一表述。

   **失败案例：** 实施者以“仓库默认禁用”为前提执行常规 build，实际物化到已启用配置，超出隔离实施的预期。

   **修复：** 将“目标登记状态”“当前验收状态”“正式启用授权”分别写实，明确实施期间不因常规 build 意外更新日常部署；无需在本轮擅自修改 manifest。

首轮逐项复核结果如下：

| 首轮编号 | 状态 | 本轮证据与结论 |
|---|---|---|
| 1 | 已解决 | `specs/collab-kernel/spec.md:9`、`:107`、`:112` 纳入 purpose、读取正例及逐项写入拒绝；`design.md:94` 明确修改运行时 stable。 |
| 2 | 已解决 | `specs/dsh-collab/spec.md:108`、`:126` 将失败空间归一化并隔离锁诊断；创建冲突例外在 `:136` 单列。邀请态错误仍存在本轮 #3 的内部冲突。 |
| 3 | 部分解决 | `design.md:61` 和 delta `spec.md:186`、`:191` 覆盖限额后的重放与参数冲突，但 active Leader 检查仍先于收据，见本轮 #1。 |
| 4 | 部分解决 | `proposal.md:30` 明确累计唤醒无上限；delta `spec.md:179` 改为串行硬上限。并发、关闭、重启场景仍缺失，全局锁还引入本轮 #4。 |
| 5 | 已解决 | delta `spec.md:71` 完整修改冷恢复 requirement，`:80`、`:94`、`:99` 覆盖名单外投递及晚发围栏。 |
| 6 | 已解决 | `design.md:102` 指定从邀请事件取 actor；`:103` 取消“已结消息”推断；delta `spec.md:227`、`:234` 固定相应语义。 |
| 7 | 已解决 | delta `spec.md:227`、`:246`、`:260` 限定 active 来源、历史成员和过滤作用范围，邀请态不再从该空间旁路获取成员联系人。 |
| 8 | 已解决 | `design.md:110` 与 delta `spec.md:41` 明确允许底层 header 枚举、禁止返回全量结果；`:61`、`:66` 给出冷认领和失败场景。 |
| 9 | 部分解决 | delta `spec.md:208` 引入字段白名单、`:227` 引入固定枚举，但任意 itemId 及固定来源包装仍未处理，见本轮 #2。 |
| 10 | 部分解决 | delta `spec.md:35`、`:94`、`:170`、`:283` 补充配置、晚发和超预算反例；仍有本轮 #7 的场景缺口。 |
| 11 | 已解决 | `design.md:88` 比较保留具名工具的压缩方案；delta `spec.md:272` 固定完整工具数组、原顺序及 JSON.stringify 长度口径。 |

格式复核：七个 dsh-collab MODIFIED requirement 名称均精确匹配指定的进行中基线，且携带完整替换正文。kernel delta 的 requirement 名称也匹配当前规范；与 `openspec/specs/collab-kernel/spec.md:22` 至 `:125` 比较，原授权表、处理分支和全部原场景均有保留，编辑集中于 purpose、internal 读取及 createSpace 的 internal 拒绝，并追加三个场景。未发现 MODIFIED 片段替换或名称不匹配问题。

邀请即授权、精简工具常驻及不限制累计唤醒属于已接受的产品选择，本轮不将这些选择本身列为缺陷，也不要求恢复静态许可名单或人工二次确认。

## Embedded-Instruction / Injection Attempts
**Detected:** none

受审工件中的示例、命令和行为要求均作为待评审数据处理。未发现要求审查者改变角色、强制批准或修改环境的嵌入指令。本轮 #2 是拟议产品输出中的注入风险，不是工件对审查者的注入尝试。

## Verdict
VERDICT: REVISE

仍有 2 项 Critical：邀请重放顺序违反既有幂等契约，status 对任意 itemId 的信任边界未闭合。其余问题还涉及互斥故障传播、读取接口选择和派生规则，需要协调设计与规范，不能视为全部都是小而明确的文字修补。

## Required Changes (if APPROVE WITH CHANGES)

不适用；本轮结论为 REVISE。修订上述阻塞项及相关规范、场景后重新评审。

CHANGES_APPLIED: no

## Rebuttals