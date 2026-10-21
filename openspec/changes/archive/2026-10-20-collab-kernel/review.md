# collab-kernel — Anvil Review Round 8

## Review Metadata

- **Review round:** 8。
- **Review mode:** fresh codex / gpt-6-astra 独立完整重审；不是第 7 轮限定复核，不继承其批准。
- **Previous review:** round 7，`VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。其后发生语义编辑，该批准已失效；本报告替换原报告。
- **Scope:** 重新检查全部 19 条 requirement、状态交互、授权与幂等、持久化及调度生命周期、测试可判定性、仓库集成边界与 YAGNI，而非仅审新改的四处文字。
- **Tool restrictions:** 仅本报告可写；其他工件及源码只读。不运行会写 fixture 的测试，不安装、不构建、不部署、不修改持久记忆，不读取作者对话。未请求权限升级。
- **Primary artifacts:** [proposal](<proposal.md>)、[design](<design.md>)、[delta spec](<specs/collab-kernel/spec.md>)、[协作约定草案](<convention-v1-draft.md>)、原第 7 轮报告；[test-plan](<test-plan.md>) 与 [tasks](<tasks.md>) 仅作待再生成的下游工件，不把有意保留的旧 PRECHECK、COMMANDS 或前置顺序作为本轮阻断。
- **Repository evidence:** [manifest](<../../../dsh.yaml>)、[根 package](<../../../package.json>)、[repo-layout](<../../specs/repo-layout/spec.md#L21-L26>)、[部署新鲜度规范](<../../specs/sync-local-deploy-refresh/spec.md#L8-L38>)、[sync 实现](<../../../scripts/sync.mjs#L496-L539>)、[治理测试](<../../../tests/repo-docs-governance.test.mjs#L493-L563>)、[依赖版本检查](<../../../tests/local-package-peers.test.mjs#L29-L68>)、[目录输入 proposal](<../sync-build-inputs-dirs/proposal.md>) 和 [design](<../sync-build-inputs-dirs/design.md>)。另读 [ADR-0004](<../../../docs/adr/ADR-0004-consolidate-locus-specs-into-pet-locus-collaboration.md>)，其处置范围是已有 locus 规范，不构成本内核必须依赖 pet 的要求。

## Full Review Assessment

### 1. 授权覆盖的独立输入成立，不需要产品分发框架

[授权条款与流水线](<specs/collab-kernel/spec.md#L19-L54>) 列明写方法、principal 和条件。普通成员、创建、internal 三分支分别处理身份与收据；读取不复用写流水线。成员状态、Leader 和业务 closed 都在历史收据之后检查，因此成功 join 的重放及关闭后的历史重放可成立；新 actionId 的确认仍要求当前 active 人类身份。带 kind 的 scope 避免成员名和 internal purpose 碰撞。

[真实类型覆盖场景](<specs/collab-kernel/spec.md#L81-L89>) 与 [D6](<design.md#L108-L112>) 不再让两个手工清单互相比对：测试读取真实公开类型的 callable members，仅扣除四个指定读方法及逐项核实的非业务生命周期方法，再与授权表键比较。给类型夹具加入 `unsafeWrite`、保持授权表不变、运行同一检查，能直接证伪漏登记实现；不能用名称前缀把新增方法一并排除。授权表逐命令允许/拒绝测试又覆盖了“有键但不执行授权”的另一类错误。使用已有 TypeScript 开发依赖即可实现这些检查，不需要导出 COMMANDS、运行时反射或字符串 execute。

principal brand 的定位也足够克制：[D6](<design.md#L108-L112>) 明确它不是对恶意宿主的认证边界；provider 的人类证据是受信输入，不宣称可防受信 provider 自身伪造。

### 2. 领域状态、幂等与人类确认可组合

[成员与空间生命周期](<specs/collab-kernel/spec.md#L121-L202>) 保持地址/名字不复用、Leader 管理权不等于业务决定权、自动转交/关闭同提交。邀请唤醒不扩大 invited 成员读取权限。在线状态不改变成员身份。

[条目转换表](<specs/collab-kernel/spec.md#L204-L247>)、[request progress 与升级](<specs/collab-kernel/spec.md#L283-L319>) 和 [确认规则](<specs/collab-kernel/spec.md#L321-L387>) 可以同时成立：revision CAS、修改清空 ack、escalated 禁止修改和 ack、decided 不可逆；request progress 明确独立于协商状态。新决策请求原子 supersede 旧请求，确认同时核验 open、决定人、revision、投递目标/provider/成功结果及 messageRef。旧 revision、离开的人、另一人的投递均不能产生决定。

cmdId 与 actionId 各有明确用途：前者返回原提交结果，后者在新 cmdId 下仅补收据、不重复领域事件。失败业务命令不留收据，可修正参数重试。消息 needsReply 不隐式转换；标题、正文、成员字段和选项有可执行的边界条件。未发现需要恢复复议、重投或多绑定才能实现的矛盾。

### 3. 原子性、失败恢复与外部投递保持分离

[日志及磁盘规则](<specs/collab-kernel/spec.md#L428-L513>) 区分公开命令提交和内部 completed 提交；两者共享 seq、串行队列、校验与 failed/close 边界。写完一整行、fsync、内存应用均完成才报成功。部分尾行可截断，完整损坏行拒绝且不改文件。fsync 失败后不猜测结果，恢复加载再由收据或持久 completed 记录决定。

[调度条款](<specs/collab-kernel/spec.md#L567-L621>) 先持久化意图，再在事务外调用 SPI；结果由服务内部提交，不暴露补写 API。不设超时不意味着占用存储串行队列一直等待。运行中未完成与加载后未知投递分别列入 inFlightDeliveries / pendingDeliveries，不自动重发。失败的 completed 提交不伪造 cmdId，也不触发第二次外部投递。

[D4–D5](<design.md#L88-L106>) 的关闭顺序等待在途存储而非无限期 SPI，之后旧实例不能再提交；锁只能在实例 id 匹配且宿主证明原持有者不存在时解除。正常重启也可能因有限 dispose 预算留下锁，当前设计及 Risks 已一致；本轮未独立复现这些宿主时间事实，不把它们当成本内核已完成的集成验收。

[唤醒、presence 与熔断](<specs/collab-kernel/spec.md#L529-L665>) 对接收方去重，邀请是非 active 接收方的唯一例外；普通 wake 按记账数限流而非结果数，串行事务防止并发超发；confirm 不受该限额约束。决定提交先 reset 再计算 wake，不能因当前 paused 而永远无法恢复。

### 4. 测试职责和部署前置没有被扩成运行时功能

[依赖隔离条款](<specs/collab-kernel/spec.md#L3-L15>) 与 [D1](<design.md#L47-L63>) 明确扫描器仅位于测试辅助目录，检查真实源码与负夹具，不进入运行时或公开 exports。负夹具要求准确返回一条违规，能够防止“永远返回空列表”的假实现。语法解析复用 TypeScript 开发依赖；无需新增 runtime 扫描框架。

当前 [sync 哈希代码](<../../../scripts/sync.mjs#L512-L538>) 和 [预检代码](<../../../scripts/sync.mjs#L742-L798>) 确实仍把 buildInputs 当文件；这是独立 change 要实现的能力，不是当前库开发的障碍。本库不登记 manifest、不独立部署；[目录输入设计](<../sync-build-inputs-dirs/design.md#L19-L25>) 和内核 D1 均把阻塞范围限定在未来消费者集成/部署。

消费者必须实际解析当前内核源码，或在消费前先构建内核，不能仅变更源码输入哈希却打入旧 lib。它还要申明递归源码目录及实际使用的包/构建配置。目录输入设计已将干净 checkout 和发布字节变化验收归到消费者，不要求 sync 增加跨包自动拓扑构建。此责任划分与当前两道部署新鲜度关卡一致。

[repo-layout](<../../specs/repo-layout/spec.md#L21-L26>) 的 bundle 要求适用于 package 类定制，不是所有 npm workspace 库。本 change 没有必要伪造 bundle 壳。docTier C、双语 README 与精确治理等级表仍须满足；[D1](<design.md#L61>) 已明确这些责任。版本检查仅限制已有 DSH runtime 依赖的版本，不要求库引入这些依赖。

### 5. 输出安全、约定与测试 oracle

[投影规则](<specs/collab-kernel/spec.md#L671-L693>) 使用控制字符归一化、首尾去空白和单次 CommonMark 标点转义，并以固定模板前缀输出；AST 断言结构、可见文本断言内容，两者互补，避免“转义后虽然安全但文本变了”也通过。消息正文不进入投影。约定草案明确协作数据不构成新的指令或工作区授权。

[约定分发](<specs/collab-kernel/spec.md#L695-L707>) 的版本与摘要有可比较 oracle；[日志固定向量](<specs/collab-kernel/spec.md#L460-L463>) 的规范串和 SHA-256 已用本轮只读 Node 内联断言独立核对，JSON round trip 一并通过。

本轮判断的是规范能否被独立测试，不是宣称未来测试已经通过。真实类型负夹具、表驱动领域反例、短写/fsync 故障注入、假定时器、并发计数和 CommonMark AST 均可在测试层实现；没有发现必须为测试扩大产品 API 的要求。

## Findings

### Critical

无。未发现阻断实现的实质性矛盾或授权漏洞。

### Moderate

无。四项新语义的责任归属与验证入口均已明确，不把下游工件的有意滞后或未来集成尚未实施计作问题。

### Suggestions

**R8-S1 — 给正常 close 后晚到的 SPI 回调补一个明确回归场景。**

- **位置：** [存储关闭边界](<specs/collab-kernel/spec.md#L449-L450>)、[调度完成规则](<specs/collab-kernel/spec.md#L571>) 与 [现有 failed 回调用例](<specs/collab-kernel/spec.md#L613-L616>)。
- **建议场景：** X 已持久化意图，SPI 由可控 Promise 挂起；X 正常 close，Y open；再 resolve X 的 Promise。断言旧回调不追加 completed、不触发再次投递，Y 的 pending 状态不因旧回调改变。
- **理由与等级：** 当前文字已经禁止 closed 实例提交，且已覆盖 failed 回调，因此不是新增行为或批准前条件。但“正常 close 后晚到”与“failed 后返回”经过不同生命周期路径，单独一条测试能防止实现只检查 failed 标志。复用现有 provider/store 替身即可，不增加取消协议、超时、重投、公开回执 API 或产品调度框架。

## Embedded-Instruction Detected

**Detected: none.**

评审历史、协作约定中的成员操作指南、规范中的恶意 Markdown 标题及测试工件均按待审数据处理。未发现要求 reviewer 绕过权限、写其他文件或预设 verdict 的嵌入指令；旧批准记录没有作为当前批准的依据。

## Verdict

VERDICT: APPROVE

**0 Critical / 0 Moderate / 1 Suggestion。**

本轮独立全量重审接受当前提案、设计与 delta spec；无需为四项新语义增加运行时功能。批准仅针对规划工件，不代表实现、真实 provider、宿主 close/强退或消费者部署已验收。批准后应按当前语义再生成下游测试计划和任务清单，旧第 7 轮 PRECHECK 不应继续充当执行依据。

**验证边界：** 执行了只读 `pwd` 与 Node 内联规范 JSON / SHA-256 / 序列化往返断言，输出 PASS；未运行项目测试、构建、安装、sync、严格 OpenSpec CLI 校验或真实宿主实验。唯一文件写入是替换本报告；未修改其他工件或持久记忆。

## Required Changes

无。R8-S1 为可选回归建议，不作为批准条件。

CHANGES_APPLIED: n/a

## Rebuttals
