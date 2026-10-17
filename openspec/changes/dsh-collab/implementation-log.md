# Implementation Log — dsh-collab

## Apply entry / prerequisite check — 2026-10-17

- 显式用户apply请求选择dsh-collab。官方openspec list返回本托管执行根；status为spec-driven，instructions apply为ready，初始0/22。
- 已重读CLI返回的proposal/spec/design/tasks，以及test-plan与最终review。review Round2/3 APPROVE满足1.1，因此只将该项勾选；未追认任何实现任务。
- CLI本版返回task id/description/done，没有sourcePath/line；直接read确认tasks.md第3行描述完全匹配后targeted edit。每次后续完成仍须重新核对原文并刷新apply。
- 前置只读Node解析检查：@deepseek-ai/dsh与@deepseek-ai/dsh-cordis-host-runner均MODULE_NOT_FOUND；这是捕获并报告的可用性结果，检查命令本身exit0。
- 可解析：Cordis4.0.4；dsh-agent-loop、dsh-api-session-controller、dsh-session-persistence-jsonl、dsh-agent-preset-registry、dsh-sandbox-policy、dsh-user-approval均0.2.0-rc.2。
- 因design D8/tasks1.3明确禁止静默安装、借日常profile或用自写signal handler替代发行Host，此处暂停并请求用户决定是否准备隔离发行运行体。未启动1.2真实组件harness，未完成1.3；没有任何真实Host验收结果，不能标记GREEN或skip通过。
- 未修改产品代码/manifest/依赖；未安装、部署、创建会话或运行外部模型；未改上轮Anvil验收、提交、合并、归档或清理。

## 现有组件测试 — 用户明确同意后

用户明确只做现有组件接入测试，不安装完整DSH、不动日常环境。新增两个测试文件，不新增package.json/依赖/manifest或插件实现：

- packages/dsh-collab/test/component-seams.test.mjs：真实Cordis/AgentLoop/ToolRuntime/LLM scripted adapter，三项探针。
- packages/dsh-collab/test/run-components.mjs：独立子进程，环境仅PATH与临时HOME/DSH_HOME标识，不继承凭据；受控绝对临时目录核验后清理。

实际结果：`node packages/dsh-collab/test/run-components.mjs` => 3 tests / 3 pass / 0 fail / 0 skip / 0 cancelled / 0 todo，exit0；git diff --check exit0。

1. component-identity：模型提交forged callerSessionId，真实工具execute取得的exec.agent.id/session.id仍为component-b，cwd仍为其workspace。
2. component-idle：idle followup返回void、新请求真实包含指针；持久内存事件user/message保留创建时的message.id与plugin:dsh-collab来源。
3. component-busy：脚本模型barrier挂起当前回合时提交followup，当前request不含指针；释放后第二request出现，真实inbox claim的turn不同且只admit一次。

最初测试有3个harness错误（非产品RED）：defineTool.output误沿旧接口而非当前schema/render；user/message数据误认data.message（当前是data本身）；turn应取真实inbox claim。读当前d.ts与AgentLoop源码后修正，未改产品，不将这些失败算TDD行为RED。随后审查改为busy主体finally释放barrier，防失败时dispose卡死；环境恢复/临时case清理亦在finally执行。早期仅隔离DSH_HOME的试跑未安装配置/persistence、只用ScriptedAdapter；最终runner加强为启动前清空环境并同时隔离HOME/DSH_HOME。早期空fixture经绝对路径核验后仅删除空目录，无raw session保留。

## 独立测试评审与修正

独立只读评审dd796501确认3个probe触达真实语义，但指出两项测试可靠性问题：busy after先dispose后release可能死等；AgentLoop吞driver错误导致仅whenIdle/seen断言可能假绿。已将busy gate释放放主体finally、清理放finally；harness收集agent/error并在每case断言为空、预期request数量、script消费完、turn/end全部completed。修正后重新执行runner：3/3 pass、0 fail/skip/cancelled/todo，exit0；diffcheck exit0。评审没有独立复跑，不把Lead重跑冒充独立执行。task1.2仍未完成。

## 冷恢复组件前提缺口

只读调研并用require.resolve复核：当前根缺`@deepseek-ai/dsh-fs-local`、`dsh-fs-sandbox`、`dsh-attachment-local`、`dsh-credentials-local`（均MODULE_NOT_FOUND）。已有dsh-fs/dsh-attachment/dsh-credentials为抽象服务接口，不可冒充concrete backend。SessionController还依赖FileUploads→Connection→Credentials，Connection激活立即需modifyRecord；不因只测文本就免除装配要求。

因此没有启动官方SessionController，不曾执行P1→P2冷恢复或sandbox/approval/worktree权限矩阵；task1.2仍未勾选。这3个probe只是该任务的部分组件证据，不标绿30个consumer验收场景，不替代task1.3发行Host启停链。

## 后续现有组件进展：JSONL checkpoint/reopen

新增component-persistence：真实JSONL persistence（compression:none）写入插件来源消息，显式sessions.flush返回true；释放handle并dispose旧Context，新Context通过官方persistence.open/read重读物理日志，断言同message.id只出现一次、source/content完全保留且没有激活live session。不是低层agents.resume替代SessionController，也不宣称preset/权限冷恢复。

最终runner：4 tests / 4 pass / 0 fail / 0 skip / 0 cancelled / 0 todo，exit0。该新增probe测试已有DSH功能，没有产品实现修改或TDD RED声称。

## 用户授权后的隔离具体组件与冷恢复

用户在问答中明确选择“允许补齐测试组件”，只在隔离目录准备精确官方组件、不安装完整DSH。已先ws promote确认mutable，再安装到忽略目录spike/collab-components；未修改根package.json/lock或日常profile。官方dsh-base@0.2.0-rc.2依赖元数据用于核对具体包名称，不安装base或dsh本体。

初次解析发现registry最新patch导致loader/include/group与Cordis4.0.4 peer冲突（ERESOLVE/ELSPROBLEMS）；没有force/legacy忽略。按当前仓库实际已用版本限定loader1.0.5/include1.0.9/group1.0.4，核验精确fixture依赖绝对路径后仅重建其node_modules/lock。最终npm install与npm ls --all均exit0，无invalid peer。可复核配方保存在非忽略的test/support/component-dependencies.json（待随源码加入版本控制，未声称已commit），README记录手动安装步骤及传递依赖不完全锁定的边界。

controller-seams.test.mjs全runtime从该单一隔离graph导入，避免与根Cordis/scope私有符号混用。真实fs-sandbox、attachment-local、credentials-local、SessionController全部inject、preset loader、JSONL、workspace/SQLite以及Bash sandbox等均是真实现，未空stub：

- controller-assembly：真实全部Controller服务激活，不启动webserver/完整DSH进程。
- controller-cold：官方create(P1)→select(P2)→flush true→销毁writer→全新reader官方resolveAgent。header仍P1，真实request/header工具面P2有/P1无。read-only/approval never从日志恢复；真实file write拒绝且字节不变/read允许；root和B同名不同内容文件的相对read命中B；无workdir Bash pwd命中B。Bash写入返回foreground、read-only、full enforcement、denied true、非零整数exit且无timeout/abort/signal/runnerFailed，不接受SANDBOX_UNAVAILABLE假绿；同agent只读Bash成功。实际turn内approval.request即使有允许answerer仍rejected，answerer未调用且拒绝audit存在；driver errors为空、turn completed。
- controller-worktree：独立临时真实git repo/worktree和schema2 operation，编译真实wire/containment/guard/recovery源码闭包，在agent/created用真实recoverBindingSync/installGuard；新Context官方coldresolve观测source=resume。danger-full-access下worktree内read成功、源repo read/write被guard拒绝且字节不变，不同cwd unbound会话同源read成功，隔离worktree归因。这是worktree recovery/guard组件hook，不冒充完整worktree plugin的HTTP/archive/reconciliation编排。

最终实际运行（Node v24.20.0 / npm11.19.0 / TS5.9.3）：controller runner 3/3、basic runner4/4，共7tests、0fail/skip/cancelled/todo；全部exit0。npm ls --all与diffcheck exit0。初步Bash过宽字符串oracle经独立review指出后已收紧结构化拒绝和允许对照；cwd行为与可保存recipe缺口亦修正。没有用新增产品代码制造GREEN，也没有声称这些已有组件探针具备产品TDD RED。

## 当前状态

独立只读复核90fd590b PASS；Lead已收齐最新3+4全部exit0结果后勾选task1.2，当前2/22。独立评审未独立复跑，不混淆执行来源。task1.3发行Host启停门仍未验证；30个consumer产品验收场景仍未实现。仅测试源码与配方/执行文档、隔离测试依赖有新增，不改kernel/产品manifest/日常部署、不用用户凭据或真实模型、不提交合并归档。
