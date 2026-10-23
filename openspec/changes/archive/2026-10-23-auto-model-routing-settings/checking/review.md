# Agent B 独立审查：可向用户确认，尚不可直接执行

**状态：reviewed-with-revisions-awaiting-user-confirmation。** 已先抽取原8条trail的逐CP摘要，再逐条读取，对照[用户24CP oracle](<checkpoints.yaml>)、[change spec](<../specs/auto-model-routing/spec.md>)与[现行规范](<../../../specs/auto-model-routing/spec.md>)审订；无independent-only缺口。未增加验收预期，仅重新分组、去重及补充证据/停止/恢复纪律。未打开浏览器、未修改Host配置、未付费、未跑UT/e2e、未向下委派。阶段2只读观测沿用Collector记录，不冒充B现场复验。

## 审查结论及修订

1. **出站证据不能伪造。** 原9个请求类CP使用不可观察的expected_url占位；全部改null并显式network_assertion_enabled=false、blocked_subassertion，不执行网络匹配、不造正则、不以未匹配假URL判功能失败。保留partial及独立可观察子断言。官方request/header.config只是合成配置，不是provider线级；实际入口/schema还需执行前只读绑定，当前不声称已找到观察出口。CP14判档记录与CP16零判档也不能证明Jev真实出站/零出站。
2. **付费去重但保留完整范围。** CP17复用T2精确medium回合，CP18复用T6保存后high回合，取消独立两次toast回合；删除T5没有具体动作的2次生命周期预留。CP04对照模型Sol四档设low，Luna默认最低medium，在当前目录不再有medium偶合导致无法辨别继承的无谓风险；只按实际tier判预期，不重抽分类。工具仅1次T3+1次T10 AUTO判档，MANUAL工具不应判档；真实child最多1个。
3. **三分钟不能只写一句。** 原T2三个付费回合和T4多段UI/付费混在一起；拆成T2/T9/T6以及T4/T10，共10条（9活跃+T8台账），仍24CP。每trail180秒含finally，120秒停止新动作/取消，60秒保留恢复；单付费链最迟60秒启动。T5三段链按30/60/90秒启动截止，前链没结束不继续。长尾允许blocked，不承诺必能完成；不暂停计时、不反复重跑、不能超时后宣称恢复成功。
4. **操作后果。** 保留草稿切页后回显/真实及默认选择不变；主/子保存回读与官方请求配置子断言；cap UI两格冲突+Host拒绝/字节不变；同提交修复；恢复默认删除稀疏键不固化；新旧模式及工具实际结构输出；toast连续观测而非晚截图；CP19逐负例/hash与合法边界恢复。CP10拒绝状态按oracle的4xx断言，取消无来源的精确400限定。没有新增视觉/IME/键盘oracle。
5. **可执行性边界。** 部分selector/target是自然语言、多动作说明而非已验证CSS，部分expected_text是结构比较要求非字面文案。已在[执行合同](<execution-notes.md>)要求写入/发送前只读绑定唯一DOM/RPC/事件与恢复出口；绑定失败不造定位器、不发送。故“9活跃trail”不是“全9已证明可自动执行”。
6. **全局写入/并发恢复。** single_only不隔离其它业务消费者，必须用户确认安静窗口。逐trail原config字节/存在性/mode/hash与官方当前选择/新会话默认均恢复；每写前/恢复前比对自己上次确认状态，包含官方选择，发现外部修改或归属不明停，不盲覆盖。明确取消本次在途主子调用并确认异步selectModel稳定，再恢复/验证；无原子CAS证明，不承诺静态hash能消除竞态。不用模型请求恢复，也不误套已删除的MANUAL锚点复原义务。
7. **skip不可偷换通过。** CP21固定延迟、CP22共享列表收缩、CP23不兼容effort仍仅T8 skipped；不改共享名单、不启新mock、不拿自然timeout或UT fixture当真实场景。总量24=21活跃+3skip；full11、partial13（含3skip）；无运行结果/通过率。

## 可一次性提交用户的确认摘要

入口为既有 http://127.0.0.1:3080/ ，PC 1280×800、amr-accept；不build、不重启、不另起服务、不改key/共享列表/门禁。

| 顺序 | Trail | 范围 | Jev预计 | 模型预计 |
|---|---|---|---:|---:|
| 1 | [T1](<trails/T1.yaml>) | CP01/02/20：env只读、草稿、criteria/候选 | 0 | 0 |
| 2 | [T2](<trails/T2.yaml>) | CP03/05/17：精确medium、官方选择、toast关 | 1 | 1 |
| 3 | [T9](<trails/T9.yaml>) | CP04：另一未覆盖模型缺省 | 1 | 1 |
| 4 | [T6](<trails/T6.yaml>) | CP06/18：旧medium保存为high、下一请求、toast开 | 1 | 1 |
| 5 | [T3](<trails/T3.yaml>) | CP07/08/09/24：精确子推荐、官方派发、主子独立、无max样本 | 2 | 4（含child1） |
| 6 | [T4](<trails/T4.yaml>) | CP10/11/13：cap冲突拒绝/同提交修复/删除覆盖 | 0 | 0 |
| 7 | [T10](<trails/T10.yaml>) | CP12：低cap的主子缺省 | 2 | 2 |
| 8 | [T5](<trails/T5.yaml>) | CP14/15/16：新AUTO、自建旧MANUAL、工具直通 | 1 | 4 |
| 9 | [T7](<trails/T7.yaml>) | CP19：非法设置/期限整数边界、字节不变 | 0 | 0 |
| — | [T8](<trails/T8.yaml>) | CP21/22/23已skip，只保留未覆盖台账 | 0 | 0 |

需要用户一次性明确：

- 同意上述范围及**单agent顺序执行**（single_only，不提供swarm），提供整个窗口没有其它AUTO/route_subagent消费者或全局设置/默认选择编辑的安静条件。
- 同意临时全局非密钥配置写入，和仅准确插件config的原字节/存在性/mode精确清理授权；官方当前模型/effort和新会话默认也必须恢复。无这些条件不启动写入。
- 同意费用提案：**Jev预计8、尝试停止阈值10；主子模型预计13、含自动重试停止阈值20；官方child创建至多1个。** 原10/12与17/24提案已缩减，未获自动授权。金额未知，不能承诺美元上限。
- 接受数量是执行停止阈值而非Host硬配额，自动请求可能在可见前发出；Jev到8/模型到16先暂停新链检查。没有可信既有计数/取消出口就不付费。若要求绝对不超请求数或硬美元封顶，当前计划不能保证，须先解决硬控制再执行。
- 接受线级出站不可观察相关仍partial，CP21/22/23未覆盖，以及超时/绑定不到时停止并报告，不重复凑通过。

## 恢复策略摘要

安静窗口内S0快照：准确DSH_HOME插件config原字节/存在性/mode/hash，官方当前选择与全局新会话默认provider/model/effort；仓库外0700私有备份，排除credentials/.env。每写trail S_T=S0，每提交记录hash/稀疏键并追踪自己的选择变更；finally取消运行、验收会话MANUAL，恢复config和官方当前/默认并确认无在途写回。原API序列化无法重现时仅按已授权准确路径做原子字节恢复；原本不存在只删除本次该文件。并发差异、路径/恢复出口不明或hash/默认未恢复时停后续，不盲覆盖；保留私有备份交用户，不宣称环境已恢复。详见[执行合同](<execution-notes.md>)。

## 明确未覆盖

CP21/22/23；Host→provider/Jev线级出站与MANUAL零外发；同回合配置缓存失效（下一用户回合不冒充）；跨Host重启；受控门禁拒绝；稀疏effort能力/候选空、主子目录差集；所有tier/模型穷举。CP24只汇总本轮实际样本，child未出请求则child部分仍缺。部分观察/恢复入口尚待只读绑定，3min未完成的矩阵项逐项报告。独立性低，不能以这次绿代替人工。

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能。

## 实际运行的检查

- 初次修订后mock gate通过、trail gate退出1，原文：`FAIL: T6.yaml:CP06: 自动化 checkpoint 只有 presence-only 断言，需补状态/值/回读/后果断言。` 原因是脚本未检查expected_params且注释含“出现”；补明确旧medium/新high保存回读与官方config三元组子断言（不复活出站占位）后重跑。
- 最终mock gate：退出0，`PASS verifying mock gate: trails=10`，见[mock门禁](<gates/mock-gate.txt>)。
- 最终trail gate：退出0，`PASS verifying trail gate: trails=10`，见[trail门禁](<gates/trail-gate.txt>)。
- 本地静态清单检查退出0：24个唯一CP且01–24齐全；focus为integration18/interaction6；automation full11/partial13；9个不可观察出站断言均显式禁用，无旧expected_url占位。

**门禁绿不等于trail可立即执行、不等于CP通过。下一步只向用户确认，不执行。**
