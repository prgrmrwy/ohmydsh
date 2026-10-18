# Test Plan — dsh-collab

已进入实施。2026-10-18重新核验：consumer单元31/31、独立产物/隔离sync2/2（含npm pack与CLI）、基础组件4/4、真实Controller及consumer12/12通过，typecheck/build/diffcheck通过；无skip。首次复跑暴露上一轮最后新增断言把业务code误当Error.message，改为匹配code后通过，不把该夹具错误记为产品RED。下表保留原场景ID，并列真实测试标识与证据层级；“部分”不等于完成。官方CLI/kernel关闭门已通过；consumer经真实官方CLI关闭/重启门三项亦通过（normal10ms/budget5005ms/kill3ms）。三种关闭门是官方root持有probe并await真实consumer teardown；另official-composition独立验证真实官方profile sibling rows直接装配和两进程正常重启收据，不能把direct正常门扩大为direct预算/kill；pack/sync副本门已通过（sync installer用仓库复制fixture、构建/import真实）。TDD历史偏差继续保留，现有绿色不能追认先前测试顺序。

## 30场景一一映射

测试路径均在 `packages/dsh-collab/test/`；表中标识来自实际测试标题，不虚构同名规划文件已存在。

| 场景ID | 场景 | 实际测试文件 / 标识 | 当前证据与剩余缺口 |
|---|---|---|---|
| identity-01 | 跨workspace实际身份 | controller-seams.test.mjs / consumer-integration | consumer-integration与consumer-model-identity通过：实际B绑定/actor、不同cwd、P1与父关系不变；cold权限另见cold-01 |
| identity-02 | 参数伪造拒绝 | tools.test.ts / tool-contract；controller-seams.test.mjs / consumer-model-identity | 单元及真实模型ToolRuntime保留字段负例通过，日志无新增 |
| identity-03 | 无调用会话拒绝 | session-provider.test.ts / session-identity、session-registry；controller-seams.test.mjs / consumer-stale-exec | 单元无exec/旧handle与真实pre-tool等待后caller dispose拒绝通过 |
| session-01 | 名单外不可访问 | session-provider.test.ts / session-discovery；controller-seams.test.mjs / consumer-model-identity | 有效同Host C真实模型写拒绝通过，unit发现/认领名单外拒绝 |
| session-02 | 冷发现不激活 | controller-seams.test.mjs / consumer-cold-delivery | 真实consumer通过：发现前后无B Agent；unit禁止正文路径 |
| session-03 | 短前缀不认领 | controller-seams.test.mjs / consumer-integration | 真实prefix invite ADDRESS_UNCLAIMED，members/deliveries不增 |
| session-04 | 不认领human/子代理 | session-provider.test.ts / session-discovery；controller-seams.test.mjs / consumer-owned | 单元human/origin/depth+真实官方ownership拒绝，普通fork不误拒通过 |
| tools-01 | 创建邀请join协商 | controller-seams.test.mjs / consumer-integration | 真实consumer闭环通过 |
| tools-02 | cmdId未知重试 | host.test.ts / host-replay；controller-seams.test.mjs / consumer-integration | 真实工具同invite重试原收据、业务记录不增、通知不重复通过 |
| tools-03 | 内部能力不暴露 | tools.test.ts / tool-contract、tool-mapping；controller-seams.test.mjs / consumer-model-identity | 19方法精确映射及真实request/header恰20、无内部能力通过 |
| wake-01 | busy下一回合 | controller-seams.test.mjs / consumer-busy | 真实consumer通过：当前request无指针、下一request一次、两turn完成 |
| wake-02 | idle来源/白名单 | controller-seams.test.mjs / consumer-cold-delivery；session-provider.test.ts / session-delivery | 集成来源及精确指针、单元秘密正文负例通过 |
| wake-03 | invited不授读取 | controller-seams.test.mjs / consumer-integration | 真实工具join前MEMBER_INACTIVE通过 |
| cold-01 | 当前preset与权限 | controller-seams.test.mjs / controller-cold、controller-worktree、consumer-cold-delivery | consumer P2 request/header及真实read-only write拒绝/read允许通过；完整Bash/never audit/worktree guard由同图controller-cold/worktree组件行为覆盖，不声称完整worktree HTTP装配 |
| cold-02 | presence不激活 | session-provider.test.ts / session-discovery | session-cold-presence精确已有cold header仍unknown且零resolve通过；consumer冷发现同样不激活 |
| cold-03 | 枚举缺失非删除 | session-provider.test.ts / session-discovery、session-late | 单元缺失/throw/null header/错ID均unknown、不claim/restore/followup；consumer-corrupt-cold真实物理坏header枚举不泄露、不invite、不恢复且字节不动通过 |
| cold-04 | close后晚恢复不发 | session-provider.test.ts / session-late | session-late零followup、host-late-delivery关闭后晚provider结果不追加completion的真实kernel/FileStore回归通过 |
| lifecycle-01 | 跨workspace重启 | controller-seams.test.mjs / consumer-integration；host.test.ts / host-replay、host-pending-replay | 跨workspace/重启收据及身份稳定、pending保留不重发通过 |
| lifecycle-02 | 待claim关闭 | host.test.ts / host-claim-close | 真实kernel/FileStore通过：dispose不等claim，晚返回无日志/锁 |
| lifecycle-03 | 存储失败不假成功 | host.test.ts / host-fsync-failure、host-fsync-drain | 真实append handle sync失败不报成功/保持failed，重开同cmd按收据，close等在途commit通过 |
| lock-01 | 强退残锁恢复 | released-host-seams.mjs --consumer | 官方SIGKILL残锁/默认LOCKED，部署consumer recoverLock ESRCH exact恢复，再官方重启业务收据/字节不变通过 |
| lock-02 | live/unknown拒恢复 | maintenance.test.ts / maintenance-01 | 单元通过live/EPERM/unknown/坏JSON/错ID/非正PID/停机确认；packed CLI已过live拒绝/死亡exact恢复且日志保留；changed-during-probe替换锁字节拒绝回归通过 |
| lock-03 | 锁冲突空间隔离 | host.test.ts / host-isolation | 真实FileStore通过：locked/corrupt原诊断、healthy可用 |
| human-gap-01 | agent-only NO_DECIDER | controller-seams.test.mjs / consumer-integration | 真实工具拒绝、业务日志不增、无请求/决定/虚拟human通过（completion异步记录不属于该命令） |
| human-gap-02 | 历史human awaitingChannel | host.test.ts / host-human-history | 真实FileStore合法历史human无confirm provider，保持open/awaitingChannel，无dispatch/decided通过 |
| build-01 | 当前源码进入产物 | build-artifact.test.mjs / bundle-source；sync-artifact.test.mjs / consumer-sync | 坏旧lib+改src、npm pack权限隔离import、sync源码/Markdown更新部署字节且二次无操作通过 |
| build-02 | 漏Markdown必失败 | build-artifact.test.mjs / bundle-source | 独立产物加载负例通过，错误明确v1.md |
| acceptance-01 | 完整隔离Host | controller-seams.test.mjs；released-host-seams.mjs --consumer | 分层闭环、官方normal/budget/kill与每项业务重启；official-composition直接profile装配/正常关闭重启通过 |
| acceptance-02 | 未运行不冒充 | 本账本 / 发行Host子表 | 已明确保留未验证；最终交付门未关闭 |
| acceptance-03 | 移除保留日志 | controller-seams.test.mjs / consumer-integration | dispose工具撤销/日志字节/重启通过；sync-artifact禁用后部署JS消失、独立持久台账保留通过 |

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

主场景acceptance-01最终需consumer wrapper集成测试，不能以组件自写signal handler代替。用户已显式授权隔离准备官方运行体；task1.3的kernel/官方CLI接缝由released-host-seams.mjs实际执行，normal/budget/kill全部exit0，静态独立复核PASS。原版dsh0.2.0-rc.2 bin经profile-boot管理进程信号及5000ms总关闭预算，并非dynamicCordisRunner服务或fatal-release。bin/预算chunk hash与结果记录于实施日志。后续consumer集成已执行并逐项列于下表；与kernel先验分开记录，不将probe拥有的独立Context装配夸成直接生产profile组合。

| 子ID | 输入/触发 | 通过oracle | 当前状态 |
|---|---|---|---|
| acceptance-01-normal | 真实发行Host已打开空间，发送其官方停止信号/入口 | 真实dispose调用close，进程退出，锁消失，重启重放字节一致 | consumer/官方CLI已通过，含业务工具重启收据与字节核验 |
| acceptance-01-budget | 受控存储commit barrier持续超过真实运行体的dispose预算，再触发官方停止 | 预算机制终止进程、close未完成时锁不被强删、下次打开LOCKED；预算来源/退出状态可复核 | consumer/官方CLI已通过，5005ms预算关闭残锁，恢复后原收据/字节不增 |
| acceptance-01-kill | 对自己启动且已持锁的fixture进程发送SIGKILL | 等待该进程死亡，锁仍在，默认重开LOCKED，受信停机维护exactID后恢复 | consumer/官方CLI已通过，含业务工具重启收据与字节核验 |

如果运行体无可验证的正常shutdown预算，则budget项保持未验证，停止1.3并回报，不把人为定时kill/app-boot fatal-release预算代替。组件层scope、coldrestore和AgentLoop回合测试仍可独立完成，但不能因此标绿发行Host门。

## 额外矩阵与流程门

1. dataDir：相对路径、部署node_modules、任何workspace内路径拒绝；符号链接canonical containment核验；既有数据目录group/other可访问时启动拒绝；新目录0700、lock0600，日志只承诺父目录保护；同profile跨cwd稳定，不依赖工具会话的环境变量。
2. 工具身份：名单默认空、重复/空配置拒绝、未知完整ID未可接入、保留身份字段、caller.id/session.id不一致、同进程trusted插件边界明确。
3. 快速completion的断言定位command返回seq，不把日志最后一行当命令；慢恢复不设超时且不持有服务关闭队列。
4. 消息成功只指入队接受：记录followup返回void/不等待whenIdle/不自动重发；不声称flush或处理完成。可以故障注入flush/crash证明风险说明，而非新增durability承诺。
5. realhost依赖缺失须未验证而非skip后全绿。测试应给expected/observed、版本、turn/seq与工具集合摘要；只用mock不满足此门。
6. 当前执行证据：basic runner的component-identity/component-idle/component-busy/component-persistence共4项通过；用户随后授权仅补具体组件，隔离精确依赖后`node packages/dsh-collab/test/run-components.mjs --controller`的controller-assembly/controller-cold/controller-worktree共3项通过。共7tests，0fail/skip/cancelled/todo，npm ls --all exit0；冷恢复实际P2工具/相对cwd/read-only文件及Bash拒绝和允许控制/never审批audit、worktree恢复guard组件hook已验证。独立只读复核90fd590b PASS，测试由Lead执行非独立复跑。task1.2组件门完成，但不等于30个consumer主场景实现（表仍未实现）或完整worktree插件编排；task1.3官方CLI/kernel三种关闭门随后经授权独立运行体验证通过（normal4ms/budget5011ms/kill2ms）；consumer最终集成仍未验证。基础配方及复跑说明已随bbf89108提交，新Host配方/测试待后续提交。以上为当时接缝阶段历史结果；2026-10-18当前consumer证据以上表及实施日志最新同步为准，Controller suite已扩展到10项，不再把全部30场景笼统写成未实现。

## 计划验证命令

- `npm --workspace packages/dsh-collab test`、`npm --workspace packages/dsh-collab run typecheck`、`npm --workspace packages/dsh-collab run build`。
- `npm --workspace packages/collab-kernel test`；目录构建输入六suite复用其change验证命令。
- 根 `npm test`、`npm run check:artifacts`、`git diff --check`，精确报告既有两个MCP bridge探针是否仍skip。
- `openspec validate dsh-collab --type change --strict --json`。本change保持默认spec-driven，不修改上轮Anvil验证结论。
