<!-- 当前状态以本文件勾选与test-plan证据分层为准；历史RED/流程偏差保留在implementation-log，不因实现补齐追认。2026-10-18同步：16/22完成；余下3.1/3.3/4.1/4.3/5.1/6.1保留完整测试先行历史未证明的流程门，不因当前行为green追认。详见verification。 -->

## 1. 独立评审与接缝先验

- [x] 1.1 独立评审proposal/spec/design/test-plan；关键发现修订后复核，批准前不实施；保持上一轮两个change验收状态不变
- [x] 1.2 建立最小真实Cordis/AgentLoop/SessionController/persistence/preset + ScriptedAdapter隔离harness，验证exec.agent身份链、冷恢复P2哨兵工具以及不同cwd/read-only sandbox/approval never/worktree guard的真实允许-拒绝边界和busy/idle next-turn；只使用临时home与合成会话，不访问日常profile或外网
- [x] 1.3 先解析官方发行Host的启动/信号入口及真实dispose预算，再用同入口隔离子进程验证正常dispose触发close与强退残锁；自写signal-handler harness只算组件测试，不能完成此任务；分别执行acceptance-01-normal（真实停止→close→锁消失）、acceptance-01-budget（受控commit跨真实预算→预算终止→残锁）、acceptance-01-kill（SIGKILL→残锁）；未有同版发行入口/真实预算则停止此任务并报未验证，禁止安装或自设定时kill伪造。所有进程受控收集、只杀自己的fixture。接缝未验证/失败就保留阻断，不拿mock或skip冒充通过

## 2. 独立Host bundle与当前源码打包

- [x] 2.1 先写产物断言：陈旧kernel/lib不被引用、Markdown在最终URL可达、无源码目录/本地kernel依赖仍可import；观察行为RED再写构建
- [x] 2.2 创建packages/dsh-collab的最小Host ESM bundle，alias内核src/noExternal内联、DSH peers external、单bundle复制原字节v1.md；维护命令独立入口不引第二份内核资源布局
- [x] 2.3 新增双语说明/许可证/包治理等级及默认disabled manifest项；buildInputs声明内核src/package与实际配置。先ws promote再任何必要install，禁止默认sync部署

## 3. 配置、身份与session provider

- [ ] 3.1 先写dataDir绝对/非workspace/非部署路径、空或重复名单、名单外caller/recipient、保留参数注入、subagent/header不确定的失败用例，确认真实RED
- [x] 3.2 实现显式配置与exec.agent身份适配、精确名单内元数据发现/claim、archive/unknown分类，既有普通fork不被parentSession误拒；拒绝human和派生受管地址
- [ ] 3.3 先写未恢复/晚恢复/ID不一致/归档竞态、内容泄露、下一回合和不等待whenIdle断言，再实现provider.resolveAgent+generation重验+固定来源pointer followup；重复投递/flush处理不新增隐含保证
- [x] 3.4 执行session-01..04、identity-01..03、wake-01..03、cold-01..04；补充缺记录/损坏枚举返回unknown与deliver再次拒绝的矩阵，记录来源/请求头/turn的真实oracle

## 4. 具名工具与共享生命周期

- [ ] 4.1 先写20工具schema集合与15写/4读真实映射、无caller身份字段、创建固定agent、邀请不自动join、cmdId重试/CAS与授权错误保持的失败测试
- [x] 4.2 实现无状态工具模板，每次body检查身份/许可，再显式调用内核具名方法；无confirm/reset/breakLock/任意事件/字符串execute
- [ ] 4.3 先写跨workspace/重启serviceId与收据稳定、启动失败空间诊断与健康空间隔离、待claim创建关闭、在途commit排空与晚followup禁止回归
- [x] 4.4 实现wrapper readiness/per-space失败诊断、接纳即track、dispose同步封禁工具和provider并close全部空间；不等待外部SPI，不强删锁
- [x] 4.5 验证agent-only NO_DECIDER及合法历史human无确认通道的awaitingChannel，不伪造人类成员、providerprincipal或decided

## 5. 停机维护恢复与包移除

- [ ] 5.1 先写残锁默认不接管、活PID/EPERM/unknown/坏锁/ID变化不改字节、明确ESRCH且exactID才恢复的失败矩阵；并发维护违反前提明确拒绝/不承诺CAS
- [x] 5.2 实现受信维护命令与文档：人工停掉全部数据目录Host后执行，显式dataDir/spaceId/expectedInstanceId，正安全PID检查，单次探测/精确break，不open/不循环抢锁、不向agent暴露
- [x] 5.3 验证禁用/移除撤销工具、close句柄而保留台账，重启重放不重发pending；维护命令和打包清理不删除会话/workspace数据

## 6. 全量验证与交付

- [ ] 6.1 逐行核验test-plan全部30场景与额外矩阵，用真实测试标识更新账本；只在真实行为RED/GREEN后完成任务，不追认import故障为RED
- [x] 6.2 执行plugin全套test/typecheck/build、kernel回归、目录输入相关suite、根npm test/check:artifacts/diffcheck；报告每个skip/环境失败，不降低旧Anvil门禁
- [x] 6.3 执行隔离真实Host全部门槛、源码变化→部署copy字节/Markdown变化→第二次幂等；日常profile文件树不变；独立完整代码评审并修复阻断
- [x] 6.4 官方openspec严格校验、按最终事实写验证总结。规范同步和任何日常部署、提交、合入、归档/清理仍待用户明确授权；不以本规划自动启动apply
