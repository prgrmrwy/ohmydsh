# Test Plan — dsh-collab

本规划尚未实施；“未实现”不是已观察RED。新增行为须先写真实断言并观察因行为缺失失败，不以import/语法故障冒充。现有内核的绿色结果不等于宿主接入完成。

## 30场景一一映射

| Requirement | Scenario | Test File（规划） | Test ID | 状态 |
|---|---|---|---|---|
| 调用身份来自实际执行会话 | 跨 workspace 调用仍归属实际会话 | packages/dsh-collab/test/identity.test.ts | identity-01 | 未实现 |
| 调用身份来自实际执行会话 | 参数伪造身份被拒绝 | packages/dsh-collab/test/identity.test.ts | identity-02 | 未实现 |
| 调用身份来自实际执行会话 | 无调用会话不能访问 | packages/dsh-collab/test/identity.test.ts | identity-03 | 未实现 |
| 发现与绑定只使用精确普通会话身份 | 名单外会话不可访问 | packages/dsh-collab/test/sessions.test.ts | session-01 | 未实现 |
| 发现与绑定只使用精确普通会话身份 | 冷会话被发现但不激活 | packages/dsh-collab/test/sessions.test.ts | session-02 | 未实现 |
| 发现与绑定只使用精确普通会话身份 | 短前缀不能邀请 | packages/dsh-collab/test/sessions.test.ts | session-03 | 未实现 |
| 发现与绑定只使用精确普通会话身份 | 不认领人或受管子代理 | packages/dsh-collab/test/sessions.test.ts | session-04 | 未实现 |
| 具名工具忠实适配内核 | 创建邀请加入与协商闭环 | packages/dsh-collab/test/tools.test.ts | tools-01 | 未实现 |
| 具名工具忠实适配内核 | 相同命令结果未知后重试 | packages/dsh-collab/test/tools.test.ts | tools-02 | 未实现 |
| 具名工具忠实适配内核 | 内部与人类能力不出现在工具面 | packages/dsh-collab/test/tools.test.ts | tools-03 | 未实现 |
| 投递只传协作指针并使用下一回合语义 | 运行中目标下一回合收到 | packages/dsh-collab/test/host-runtime.test.ts | wake-01 | 未实现 |
| 投递只传协作指针并使用下一回合语义 | 空闲目标收到带来源指针 | packages/dsh-collab/test/host-runtime.test.ts | wake-02 | 未实现 |
| 投递只传协作指针并使用下一回合语义 | 邀请指针不能读取空间 | packages/dsh-collab/test/host-runtime.test.ts | wake-03 | 未实现 |
| 冷恢复与presence不伪造可达性 | 冷恢复保留真实工具装配 | packages/dsh-collab/test/host-runtime.test.ts | cold-01 | 未实现 |
| 冷恢复与presence不伪造可达性 | presence不触发恢复 | packages/dsh-collab/test/host-runtime.test.ts | cold-02 | 未实现 |
| 冷恢复与presence不伪造可达性 | 枚举缺失不能证明删除 | packages/dsh-collab/test/host-runtime.test.ts | cold-03 | 未实现 |
| 冷恢复与presence不伪造可达性 | 关闭时未结束恢复不晚发 | packages/dsh-collab/test/host-runtime.test.ts | cold-04 | 未实现 |
| profile共享台账与生命周期封禁 | 两workspace共享并重启重放 | packages/dsh-collab/test/lifecycle.test.ts | lifecycle-01 | 未实现 |
| profile共享台账与生命周期封禁 | 待认领创建也受dispose保护 | packages/dsh-collab/test/lifecycle.test.ts | lifecycle-02 | 未实现 |
| profile共享台账与生命周期封禁 | 存储失败不假成功 | packages/dsh-collab/test/lifecycle.test.ts | lifecycle-03 | 未实现 |
| 残留锁只在死亡证明后解除 | 强退锁被保留直到受信恢复 | packages/dsh-collab/test/lock-recovery.test.ts | lock-01 | 未实现 |
| 残留锁只在死亡证明后解除 | 活进程或未知身份不能解锁 | packages/dsh-collab/test/lock-recovery.test.ts | lock-02 | 未实现 |
| 残留锁只在死亡证明后解除 | 一个被锁空间不吞掉其他空间 | packages/dsh-collab/test/lock-recovery.test.ts | lock-03 | 未实现 |
| 无人类通道时明确能力缺口 | agent-only请求决定明确拒绝 | packages/dsh-collab/test/human-gap.test.ts | human-gap-01 | 未实现 |
| 无人类通道时明确能力缺口 | 历史无确认能力保留等待 | packages/dsh-collab/test/human-gap.test.ts | human-gap-02 | 未实现 |
| 产物内联当前源码并携带约定资源 | 源码变化进入独立部署产物 | packages/dsh-collab/test/build.test.ts | build-01 | 未实现 |
| 产物内联当前源码并携带约定资源 | 缺约定资源在验收中失败 | packages/dsh-collab/test/build.test.ts | build-02 | 未实现 |
| 验收不触碰日常会话与部署 | 真实隔离Host验证完整接缝 | packages/dsh-collab/test/acceptance.test.ts | acceptance-01 | 未实现 |
| 验收不触碰日常会话与部署 | 未执行真实Host实验不能宣称完成 | packages/dsh-collab/test/acceptance.test.ts | acceptance-02 | 未实现 |
| 验收不触碰日常会话与部署 | 移除保留持久日志 | packages/dsh-collab/test/acceptance.test.ts | acceptance-03 | 未实现 |

## 判据与夹具

- identity/tools：通过真实ToolRuntime+AgentLoop发出模型工具调用，exec.agent是唯一caller；保留字段输入与无exec直调都拒绝。集合恰20，不仅测试字符串常量；15写方法逐项证明传入的是对应具名内核方法的合法参数与真实principal，4读拒绝非成员，未知cmdId结果重试不再派发。error fixture放入秘密dataDir/lockPath/raw stack，模型结果必须零泄露且保留业务code/CAS详情/锁instanceId与pid。
- session：宿主配置名单A/B，C为真实同Host未许可会话。发现不泄露C；冷标题可缺省，I/O spy确认只走header/list/stat，禁止inspect/observe/readTitleSnapshots全文路径；短前缀、同标题/同cwd不扩大范围；subagent origin/depth拒绝、普通fork的parentSession不作为owner证据。名单本身不证明无Pet/团队归属，不读取其私有数据。
- host-runtime：真实Cordis/AgentLoop、preset registry/SessionController/持久层与ScriptedAdapter。B初始preset P1、随后选P2并持久化；冷恢复真实request/header须包含P2哨兵工具而不是仅meta；同时让B持有不同于A的持久sandbox/approval/worktree限制，恢复前后执行真实文件工具/Bash的允许-拒绝对照：read-only阻止写、approval never拒绝要求审批操作、不同cwd不串、受管worktree guard重装并阻止跨根写；看实际拒绝而不是仅投影元数据（环境不支持则接缝门未验证，不宣称权限保持）。busy回合使用barrier，指针只出现在后续turn；idle新turn，source为plugin:dsh-collab；正文白名单和原始业务秘密串负断言。
- cold：source与messageId不是人类证据。列举缺失、backend缺失/throw、损坏/不支持header应unknown且不markGone；unknown仍可能触发kernel deliver，必须另断言exact验证失败不followup。恢复后archive/ID mismatch/closing竞态都拒绝。
- lifecycle：真实FileStore+受控claim/resolve/commit，接纳create即跟踪，dispose不等provider；late restore后零followup，旧callback无completed；startup对locked/corrupt保留诊断而健康空间可用；仅.lock无.jsonl不被list返回需独立create冲突矩阵。
- lock-recovery：livePID/EPERM/ESRCH/未知/非正PID/坏JSON/changedID/当前PID重用矩阵；明确死亡与exactID才调用一次breakLock。真实SIGKILL只针对fixture child，并等待退出证明后恢复；PID存在检查不扫描或杀无关进程。packed-copy中执行维护CLI的--help、拒绝及明确死亡成功矩阵，不借源码入口或外部kernel包。
- human-gap：agent-only走真实kernel NO_DECIDER，日志不增加；合法fixture preload human confirm:false才验证awaitingChannel。不能用consumer虚拟human凑出等待态。
- build：先故意损坏旧kernel/lib并修改src/v1.md，产物须取src。npm pack复制到源树不可达目录，按真实bundle URL读取v1.md并核对sha；删资源应精确加载失败，不能以源码相邻文件填补。workspace peer可提供DSH依赖，但不得提供collab-kernel部署依赖或源码。
- acceptance：在独立进程与临时home运行真实Host组件，不开现有3080页面，不访问真实模型或用户日志。按官方发行Host实际启动/信号入口（非自写signal-handler）检查provider/preset实际装配、信号dispose是否调用close、实际预算到期/强退后锁保留、禁用后工具移除与台账保留；SessionController全部硬依赖安装真实能力而非空对象（缺发行体/依赖则此门未验证）；raw session不长期提交。

## 发行Host门的独立子判据

归入主场景acceptance-01，均在acceptance.test.ts，不能以组件层自写signal handler代替。运行体为`@deepseek-ai/dsh@0.2.0-rc.2`真实bin及其同版官方host-runner；记录bin/version/hash与信号链来源。当前执行根缺少发行入口，尚未执行，1.3是明确前置阻断而非已具备实验环境；不得静默安装或使用日常profile。组件层需真实Cordis4.0.4/DSH0.2.0-rc.2全部Controller硬依赖及preset/persistence/security/worktree装配。

| 子ID | 输入/触发 | 通过oracle | 当前状态 |
|---|---|---|---|
| acceptance-01-normal | 真实发行Host已打开空间，发送其官方停止信号/入口 | 真实dispose调用close，进程退出，锁消失，重启重放字节一致 | 未实现/未验证 |
| acceptance-01-budget | 受控存储commit barrier持续超过真实运行体的dispose预算，再触发官方停止 | 预算机制终止进程、close未完成时锁不被强删、下次打开LOCKED；预算来源/退出状态可复核 | 未实现/运行体前提缺失 |
| acceptance-01-kill | 对自己启动且已持锁的fixture进程发送SIGKILL | 等待该进程死亡，锁仍在，默认重开LOCKED，受信停机维护exactID后恢复 | 未实现/未验证 |

如果运行体无可验证的正常shutdown预算，则budget项保持未验证，停止1.3并回报，不把人为定时kill/app-boot fatal-release预算代替。组件层scope、coldrestore和AgentLoop回合测试仍可独立完成，但不能因此标绿发行Host门。

## 额外矩阵与流程门

1. dataDir：相对路径、部署node_modules、任何workspace内路径拒绝；符号链接canonical containment核验；既有数据目录group/other可访问时启动拒绝；新目录0700、lock0600，日志只承诺父目录保护；同profile跨cwd稳定，不依赖工具会话的环境变量。
2. 工具身份：名单默认空、重复/空配置拒绝、未知完整ID未可接入、保留身份字段、caller.id/session.id不一致、同进程trusted插件边界明确。
3. 快速completion的断言定位command返回seq，不把日志最后一行当命令；慢恢复不设超时且不持有服务关闭队列。
4. 消息成功只指入队接受：记录followup返回void/不等待whenIdle/不自动重发；不声称flush或处理完成。可以故障注入flush/crash证明风险说明，而非新增durability承诺。
5. realhost依赖缺失须未验证而非skip后全绿。测试应给expected/observed、版本、turn/seq与工具集合摘要；只用mock不满足此门。
6. 当前执行证据：basic runner的component-identity/component-idle/component-busy/component-persistence共4项通过；用户随后授权仅补具体组件，隔离精确依赖后`node packages/dsh-collab/test/run-components.mjs --controller`的controller-assembly/controller-cold/controller-worktree共3项通过。共7tests，0fail/skip/cancelled/todo，npm ls --all exit0；冷恢复实际P2工具/相对cwd/read-only文件及Bash拒绝和允许控制/never审批audit、worktree恢复guard组件hook已验证。独立只读复核90fd590b PASS，测试由Lead执行非独立复跑。task1.2组件门完成，但不等于30个consumer主场景实现（表仍未实现）或完整worktree插件编排；task1.3发行Host门仍未验证。配方与复跑说明位于package test目录非忽略文件，待后续授权版本收尾，不声称已commit。

## 计划验证命令

- `npm --workspace packages/dsh-collab test`、`npm --workspace packages/dsh-collab run typecheck`、`npm --workspace packages/dsh-collab run build`。
- `npm --workspace packages/collab-kernel test`；目录构建输入六suite复用其change验证命令。
- 根 `npm test`、`npm run check:artifacts`、`git diff --check`，精确报告既有两个MCP bridge探针是否仍skip。
- `openspec validate dsh-collab --type change --strict --json`。本change保持默认spec-driven，不修改上轮Anvil验证结论。
