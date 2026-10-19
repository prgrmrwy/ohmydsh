## Why

当前机器的 Locus child 两次 `pet_inquire` 都返回 accepted，但父会话没有收到 inbox 消息或启动询问轮；生产只接通询问接受，未接通调度、持久答案和结果续进。需要恢复可核验的父子问答闭环，而不是以隐藏工具、重启、待办交接或父直接代答飞书冒充修复。

## What Changes

- 接通 `pet_inquire → inquiries → 目标独立询问轮 → pet_inquiry_answer → 持久答案/result outbox → 请求方关联续进`，复用现有 caller、ledger、scheduler、outbox、continuation 模块；先交付真实父子双向闭环，不扩大成员范围。
- 核验 manifest 精确 pin `0.2.0-rc.2` 的官方隔离执行/claim 契约，优先官方或插件级路径；确有缺口才新增最窄受管 compat seam，以实际加载模块的行为探针放行，不能只补 marker。
- 使 accepted 代表“持久接受且具备可运行的后续处理链”：必要能力缺失时明确拒绝，不新建永远无法派发的询问、不承诺稍后答案；busy 可排队，不能伪装成永久不可用。
- 保存 Host 派生的统一关联上下文：locus 为协作范围，Delivery/local work 为原请求，inquiry 为问答分支，message/turn/segment 为实际执行证明；全链路继承且每次重验，不用 locusId 单独寻址或授权。重启只恢复可证明未执行的工作，未知保持待核查。
- 按用户已确认的 A 边界，保留目标正常 shell/Git/查询能力；硬性限制经 Host 管理的飞书回复、普通 agent 通信、委派、待办请求执行与权限/绑定变更入口。明确不提供任意 shell/脚本/HTTP 内部效果的 OS、凭据或网络隔离，相关行为仍受模型指令和既有策略约束；不得把有限入口守卫宣称为全外发沙箱。
- 明确本地 workId 生命周期、嵌套询问 trace 继承、结果永久拒绝后的原子终结，以及运行槽与生命周期忙状态的独立判据，避免答案串任务、循环预算重置和等待死锁。
- 将真实询问状态接到现有 Locus owner 诊断投影，区分询问记录与共享待办台账，提供不含问题/答案正文的状态、等待时长及原因。
- 对当前两条历史 inquiry 做本机只读对账并制定显式处置；不自动重放用户工作、不恢复已失效 Delivery 的回复权。
- 部署范围仅当前机器的正式 Host。共享源码与测试可修改，但不 SSH 部署、不重启、不写入 lumevm/devbox；保留待办登记、子请求执行与所有者受理的现行语义。

## Capabilities

### New Capabilities

- `pet-inquiry-runtime-channel`：生产询问发布门槛、持久队列到真实父子执行的接线、答案与原工作续进、恢复对账及 owner 可核对状态。

### Modified Capabilities

无。本 capability 补充运行体落地保证，不改 `pet-locus-intent-triage` 的待办执行规则、`pet-locus-collaboration` 的原生 agent-message/Delivery deadline 语义或 `pet-compat-minimization` 的举证要求。

## Impact

- Pet：`packages/dsh-pet/src/index.ts`、`host/collaboration/assembly.ts`、`host/inquiry/`、必要的 `host/locus/` 执行证明/管理投影及现有 client owner 展示；相应集成、持久恢复和真实 runtime 测试。
- 存储：复用 Pet 单 writer domain；若持久答案或派发关联需 schema 演进，必须版本化、离线备份/迁移，保留旧记录与未知结果，不直接编辑运行中 SQLite。
- Runtime：`packages/dsh-pet/compat/subagent/` 的受管构建/launcher 仅在正面证明官方不能满足时调整；不扩大原生 `send_message` 或全局工具语义。
- 与进行中的 `pet-locus-independent-agent-inquiries` 重叠的是 runtime 问答落地子集；用户 A 明确了高权限 parent 的有限入口保证，不视作旧 change 完整 G4 达标，发布/归档前必须对齐重叠条文。本 change 不接管其公共事实、独立 child 创建或完整兄弟协作产品任务；实施前建立责任对照，归档时不重复新增该 change 尚未发布的 `pet-agent-inquiries`。与 `upgrade-dsh-0-2-0-runtime`、Delivery recovery change 共用文件时单一串行修改并回归原能力。
- 本次请求只创建规划；实现、停 Host、迁移、正式重启及真实飞书出站须在后续 apply/部署步骤确认，不因提案生成取得授权。
