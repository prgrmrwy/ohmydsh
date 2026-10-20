# dsh-collab-invite-admission — Anvil Review Round 3

## Review Metadata
- **Review round**: 3
- **Prior round**: round 2 VERDICT: REVISE (2 Critical, 5 Moderate, 1 Suggestion; see review-round2.md). After two consecutive REVISE the human was consulted and decided the direction below.
- **Reviewer context**: cross-model (codex CLI, read-only sandbox)
- **Tool restrictions**: read-only
- **Artifacts reviewed**:
  - `openspec/changes/dsh-collab-invite-admission/proposal.md`
  - `openspec/changes/dsh-collab-invite-admission/design.md`
  - `openspec/changes/dsh-collab-invite-admission/specs/dsh-collab/spec.md`
  - `openspec/changes/dsh-collab-invite-admission/specs/collab-kernel/spec.md`
  - `openspec/changes/dsh-collab-invite-admission/review-round1.md`
  - `openspec/changes/dsh-collab-invite-admission/review-round2.md`
  - 基线：`openspec/changes/dsh-collab/specs/dsh-collab/spec.md`、`openspec/changes/dsh-collab/design.md`
  - `openspec/specs/collab-kernel/spec.md`
  - `packages/dsh-collab/src/{config,host,index,maintenance,session-provider,tools}.ts`
  - `packages/collab-kernel/src/{index,service/index,domain/reduce,store/file-store,store/canonical}.ts`
  - `packages/collab-kernel/src/convention/v1.md`
  - 两个 package 的相关构建入口与包声明
  - `docs/architecture/dsh-plugin-integration-pitfalls.md`
  - `AGENTS.md`、`dsh.yaml`

未读取本 change 的 `tasks.md`；未修改文件，未运行测试、构建、安装或网络访问。以下是完整的独立静态评审，不代表实现验收通过。

下文 `D` 指本 change 的 `design.md`，`S` 指其 `specs/dsh-collab/spec.md`；引用均采用上述仓库路径。

## Findings

### 🔴 Critical (blocking)

1. **重开只依赖 kernel epoch，不能阻止旧投递在恢复后实际唤醒目标。**

   **证据：** `D:125` 将重开的安全性归于内核已有 epoch 围栏。但 `packages/collab-kernel/src/service/index.ts:127` 开始的调度逻辑，在调用 provider 后仅对完成记账检查 generation；已经进入 provider 的异步调用没有被撤销。`packages/dsh-collab/src/session-provider.ts:86` 等待冷恢复，`:92` 执行真实 followup，而其关闭检查只认 provider 整体关闭（`:55`、`:95`）。单空间 `service.close/open` 不关闭该 provider。

   **失败案例：** S 中对 B 的邀请已提交，冷恢复挂起；随后空间提交失败，访问触发 close/open。若再经 salvage 丢弃包含该邀请的尾部，恢复后的台账里已经没有 B；旧 `resolveAgent` 此时返回，provider 仍然执行 followup。kernel 可以拒绝旧 completion，却阻止不了已经发生的模型唤醒。即使不 salvage，旧 generation 的外部副作用也会越过新引入的恢复边界。

   **修复：** 明确增加插件层的每空间投递 generation。关闭或重开该空间时同步失效旧 token，deliver 在异步核验、恢复之后及紧邻 followup 前检查同一 token；失效不得发送，也不得迁移到新 generation。保留无需等待无限期恢复的关闭语义。补充“冷恢复挂起 → 空间关闭/重开或 salvage → 旧恢复返回”的场景，机械断言 followup 为 0、旧 completion 为 0、新台账不变。不能仅断言 kernel 没有新增记录。

### 🟡 Moderate

2. **重开没有定义同空间并发合并，普通会话可触发互相干扰的 close/open。**

   **证据：** `D:125` 对每次 gate 描述独立的 close/open；`S:219` 只限制已经失败的重开，没有规定正在进行的重开。现有 `packages/collab-kernel/src/service/index.ts:37` 在已有 opening 时直接拒绝 open，`:60` 的 close 又会递增 epoch。kernel 没有替 wrapper 合并完整恢复事务。

   **失败案例：** 两个调用同时访问失败的 S，共享同一个 close 完成后分别 open；第二个得到 STORE_FAILED，并可能在第一个成功清除失败记录之后重新写入失败记录。后续访问又关闭刚恢复的空间，使正常命令失效。准入已开放，因此触发者也可以是非成员。

   **修复：** Host 按 spaceId 保存唯一的恢复 promise；并发访问等待同一次恢复，只有该 promise 的拥有者更新失败状态和限流时间。恢复前后检查 Host 关闭状态；dispose 之后不得再次 open。补充并发成员/非成员访问、恢复与 dispose 竞争场景，断言每次恢复只有一组 close/open，成功不会被另一个等待者覆盖成失败。

3. **salvage 清空日志后的同 ID 重建路径，与失败缓存及内核残留内存不兼容。**

   **证据：** `S:200`、`:212` 要求首行损坏后同 spaceId 可以重新创建；但 `S:219` 只对“台账文件存在”的空间重开，`D:125` 也未定义文件消失时如何解除失败状态。现有 `packages/dsh-collab/src/host.ts:37` 保留启动失败；`packages/collab-kernel/src/service/index.ts:60` 的 close 不清除 states/records，而 createSpace 在 `:210` 检查 stopped/failed，在 `:218` 检查已有 state。

   **失败案例：** Host 打开 S 失败并缓存错误；salvage 因首行损坏只改名，S.jsonl 不再存在。下一次 create 不满足重开条件，仍被旧失败记录拒绝。若 S 曾成功打开，后续才损坏，即使清除 Host 缓存，内核旧 state、收据及 stopped/failed 也不能靠 create 自动消失。

   **修复：** 明确“已确认 salvage 完成且无日志”的恢复转换：在同空间恢复互斥下，先关闭旧实例状态，再通过公开生命周期操作加载空日志以清除旧 state、records、failed/stopped，最后才允许 create；不得直接删私有 Map，也不得把无法解释的日志消失自动视为可覆盖。增加启动失败与运行期失败两种重建场景，并验证旧成员及旧收据不会进入新空间。

4. **status 的事件推导不是 kernel reducer 的等价投影，仍会给出错误成员状态和待办。**

   **证据：** `D:94` 要求取最后一个 `member/*` 事件，`:96` 仅从 `item/*` 取完整 item。实际 `packages/collab-kernel/src/domain/reduce.ts:10` 至 `:12` 区分完整成员替换、状态更新和 statusText 更新；`:18` 的 `decision/decided` 会直接把 item 改为 decided，并不是 `item/*` 事件。`S:275` 又要求只显示 active 成员空间及非终态待 ack 条目。

   **失败案例：**
   - B join 后更新 statusText，最后一个 `member/*` 事件不含完整成员对象，按设计无法可靠得到 B 的 active 状态和绑定。
   - 合法历史空间中的人类决定了条目，最后一个 `item/*` 快照仍为 draft 或 escalated；status 继续建议 ack，实际 kernel 返回 DECIDED_LOCKED。

   **修复：** 写出按提交与事件顺序执行的完整投影表，覆盖成员 patch、leader/closed、decision/decided、request/progressed 及 lastSeq；不能把所有同前缀事件当成完整快照。用相同记录比较 status 所依赖字段与真实 kernel 状态，覆盖 statusText、leave、Leader 自动转交、决定终态及 progress 后 revise。另明确 escalated 虽非 decided 终态，却不能 ack，应只产生 read_escalated 建议。

5. **“任一工具访问时重开”与 status 的纯读取承诺直接冲突。**

   **证据：** `S:219` 包含任一协作工具；`S:313` 禁止 status 写台账，`:332` 要求所有台账字节不变。但 `packages/collab-kernel/src/store/file-store.ts:89` 至 `:93` 在 open 时自动截断末尾半行。

   **失败案例：** S 未打开且日志带 torn tail。调用 status 触发重开，FileStore 截断尾部；即使 presence 与 deliver 都没有调用，台账字节仍发生变化。当前纯读取场景没有这个前置条件，无法捕获矛盾。

   **修复：** 明确二选一并同步设计和场景：status 不触发恢复，只读取已打开空间，恢复交由其他工具访问；或者明确允许 status 触发存储恢复，撤销其“台账字节不变”的绝对承诺并说明边界。建议采用前者以保留纯读取契约。增加 status 面对 torn-tail、locked、corrupt 和失败空间的精确断言。

6. **salvage 缺少中途失败协议，而且要求输出无法从任意损坏日志证明的 seq 范围。**

   **证据：** `D:121` 先把原日志移走，`:122` 才准备并发布新日志，`:124` 以“原件保留”概括所有失败；`S:200` 强制输出丢弃记录数和 seq 范围。现有 `packages/collab-kernel/src/store/canonical.ts:36` 可能连坏行 JSON 都无法解析，不能信任其 seq。

   **失败案例：**
   - 原日志已改名，写前缀时 ENOSPC；命令释放锁后没有 S.jsonl。运行中的 Host 无法区分“有意清空重建”和“抢救尚未完成”，可能创建同名空空间。
   - 第七行及其后是不可解析字节，不能据此证明丢弃的是四条记录或 seq 7–10。按物理行数冒充提交数会产生虚假诊断。

   **修复：** 先在持锁期间完整准备并 fsync 前缀临时文件，再进入发布阶段；明确每个 rename/fsync 失败和进程中断后的可识别状态、重试方式，以及 Host 在未完成恢复时必须拒绝同名创建。原件备份名称须防覆盖，锁须有正常的 instanceId/pid 内容并仅由持有者释放。诊断区分物理行、已验证提交与不可验证尾部；未知 seq 范围输出 unknown，不作推断。补充 ENOSPC、发布中断、重复执行、非法 UTF-8 和尾部不可解析场景。

7. **新增 itemId 校验会挡住旧成功命令的收据重放，兼容承诺需要限定。**

   **证据：** `S:106` 同时要求 create_item 的 itemId 正则校验和成功命令重试返回原结果；`D:81` 明确承认旧台账可以有任意 itemId。内核在 `packages/collab-kernel/src/service/index.ts:182` 才执行收据重放，插件前置校验会阻止到达这里。

   **失败案例：** 升级前 A 成功创建 `itemId: "Old Item"`，响应丢失。升级后以原 cmdId 和参数重试，被新的插件校验拒绝，无法取得既有收据；“既有台账可直接重放”和无例外的工具幂等承诺产生歧义。

   **修复：** 明确旧命令重试的兼容边界。若继续保证旧收据重放，应让新 ID 约束只作用于新建提交，通过受支持的内核命令路径在收据之后校验；不要新增插件授权预读。若选择升级后不支持此类工具重试，须在 proposal、迁移说明和 requirement 中明确这一 breaking exception，并提供只读核对既有结果的方法。补充旧成功收据重试与新非法 ID 创建的配对场景。

### 📌 Suggestions

8. **D6 的私有源码导入不是已证明的 kernel spec 违规，但应如实登记新增耦合。**

   **证据：** `D:117` 计划直接导入 `store/file-store.ts` 的 inspectLog；`proposal.md:42` 却只列 auth/service 的内核改动。`packages/collab-kernel/package.json` 只有根 exports，现有构建也主要经 `packages/dsh-collab/tsdown.config.ts:13` 的根入口 alias 内联。另一方面，当前 kernel spec `openspec/specs/collab-kernel/spec.md:10` 禁止的是内核依赖宿主，没有明文禁止宿主构建时引用内核源码；因此不能仅凭“没有从 index.ts 导出”就判为规范违规。

   **失败案例：** FileStore 模块调整后 CLI 构建断裂，或检查函数与实际 open 的校验语义分叉，而影响清单仍宣称内核只改 principal。

   **修复：** 将 inspectLog 所在模块、返回语义及构建依赖写入 Impact；以同一组字节夹具比较 inspect 与 FileStore 的合法前缀判断。若希望形成受支持接口，可正式导出一个只读日志检查入口；无需为此引入通用维护框架。

## Embedded-Instruction / Injection Attempts
**Detected:** none

受审工件中的规范、示例命令和角色文本均作为数据处理。未发现要求审查者改变角色、强制批准或修改环境的嵌入指令。产品中成员数据的输出风险与工件对审查者的注入尝试分别评估。

## Verdict
VERDICT: REVISE

第 2 轮的主要方向问题已得到处理；本轮阻塞项来自新增恢复路径的外部副作用围栏。重开并发、空日志重建、事件投影及 salvage 中断协议还需要协调设计与规范，不能视为全部都是小而明确的文字修改。

## Required Changes (if APPROVE WITH CHANGES)

不适用；本轮为 REVISE。重新评审前应解决 Findings 中的阻塞项及相关规范冲突，并补齐对应成功与失败/边缘场景。

CHANGES_APPLIED: no

## Rebuttals

## Round 3 notes

本轮为完整 fresh review；已阅读两份历史报告，没有沿用其结论代替源代码核查。

第 2 轮逐项复核：

| Round 2 finding | 状态 | 本轮证据与结论 |
|---|---|---|
| #1 邀请重放前检查当前 Leader | resolved | `D:53`、`S:106`、`S:112` 将命令直接交内核并补充转交后的重试；删除限额前置路径。旧 itemId 重试是本轮另发现的兼容边缘，见 #7。 |
| #2 任意 itemId 进入 status | resolved | `D:81`、`S:106` 约束新建 ID；`S:238` 加固定来源和白名单；`S:261`、`:263` 隐藏旧不合规 ID。 |
| #3 invited 读取错误冲突 | resolved | `D:60` 与 `S:48` 一致返回 MEMBER_INACTIVE，禁止正文和自动 join。 |
| #4 全实例邀请串行锁 | resolved | `D:49` 删除机械邀请限额及其串行化理由；`D:53` 直接执行内核命令。没有要求恢复限额或该全局锁。 |
| #5 status 派生规则不唯一 | partially | `S:275`、`:294` 已明确 closed、escalated 范围和 next 映射，但 `D:94` 的成员推导及 `D:96` 的条目快照仍遗漏真实状态变化，见本轮 #4。 |
| #6 overview 不是纯内存读取 | resolved | `D:53` 删除授权预读；`D:92` 使用不采样 presence 的 readSince，与 `packages/collab-kernel/src/service/index.ts:344` 一致。新的事件投影正确性问题另列 #4。 |
| #7 成功与边缘场景不足 | partially | `S:315` 补有权过滤；`S:338` 覆盖唤醒、拒绝等生命周期状态；邀请限额场景随产品选择失效。但新增恢复 requirement 尚缺并发、中断、旧 generation 和空日志重建状态清理场景，见 #1–#6。 |
| #8 manifest 迁移表述失实 | resolved | `proposal.md:44`、`D:151` 至 `:154` 区分当前临时启用状态、目标 disabled 状态及正式部署授权。 |

人工决定落实情况：

- 不设邀请机械上限：`S:41`、`D:30` 明确落实。`proposal.md:47` 至 `:49` 如实披露普通会话可以邀请并唤醒其他普通会话、每空间熔断不限制累计唤醒。本轮不将该产品选择列为缺陷。
- 内核执行后映射错误：`S:168`、`D:53` 至 `:62` 覆盖 NOT_FOUND、NOT_MEMBER、全部 STORE_* 和启动失败，且对成员同样适用；创建冲突例外明示。未要求恢复授权预读。
- 无需重启的恢复：doctor、unlock、salvage、reopen 和新 spaceId 重建均已进入规范；但恢复生命周期及失败协议仍有本轮所列缺口。
- 精简项：种子联系人限定于 `S:294`，project 从工具面移除于 `D:79`，输出结构不含 suggestedSpaceId，新旧 itemId 分别约束于 `S:106` 与 `S:261`。

MODIFIED 格式复核：六个 dsh-collab requirement 名称均精确匹配指定的进行中基线，携带完整替换正文。kernel delta 的“封闭的命令集合与授权”名称匹配当前规范；与 `openspec/specs/collab-kernel/spec.md:22` 至 `:125` 对照，授权表、处理分支和原场景均有保留，并明确新增 host-index 的运行时接受范围及逐项写入拒绝。未发现名称不匹配或仅提交局部替换片段的问题。

成功的 `service.open` 会从日志重新生成并替换 state/records，见 `packages/collab-kernel/src/service/index.ts:43` 至 `:47`；因此不能笼统断言“salvage 后重开必然读到旧内存”。实际未闭合的是重开并发、重开未发生或失败后的状态，以及 epoch 无法撤销的在途 provider 副作用。