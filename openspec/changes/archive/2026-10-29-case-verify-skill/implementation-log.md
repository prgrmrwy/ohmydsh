# 实施记录

## 2026-10-27

- 规划先提交：120f9140。实施采用用户明确授权的 Agent Teams：模型门禁与 adapter 分离写域，Lead 负责文档/manifest/仓库测试。
- evidence-core 初始完成001..003后多次恢复turn失败；由 evidence-recovery 接管同一 task。没有并发覆盖写域。
- 核心恢复遵循行为测试，007/009/010/011等先观察到错误接受输入再修复；若继承实现已经满足004/005/006/008则记录为已有行为GREEN，不伪造RED。001..047命名场景均有测试；额外并发、结构读取、历史证据和文档示例回归。
- Adapter 052..064 初始13测试在可执行NotImplemented stub上行为RED，随后实现，最后与真实片段门禁/报告门禁集成。
- Lead 048注册测试先因manifest未登记而RED，登记后隔离部署/第二次无变化/禁用删除测试GREEN。050/051公开URL检查与068标准库导入检查通过。
- 066嵌套Node测试首次因继承NODE_TEST_CONTEXT输出内部二进制协议而断言失败；清除该环境值后使用公开summary的skipped/pass计数断言，2项回归GREEN。
- 069制品检查先对checking/plan.json未拦截而RED，规则实现后069/070与其余制品单测9/9通过。但真实全仓check:artifacts新增236个历史checking路径违规，需要用户决定历史适用边界。没有删除旧文件，没有默认建立豁免或改spec。该事项尚待确认。
- 当前不执行生产build、合入、重启、私有仓修改或unlink旧软链。Viewer按顺序等待基础change验证完成。

## 本轮验证与修复

- Lead独立Python集成82通过，后续review补容器/枚举/结构presence与typed-env测试后由实现者报87通过；最后Leadfresh测试见后续记录。
- Focused Node：case-verify + tracked-artifacts + repo-facade 共31测试全部通过（含Python子套件）。
- npm test已运行但整体失败。新增manifest项没有README根索引的回归已修，repo-facade单独14/14通过。其余subprocess-closure临时目录EACCES清理错误、sync-dsh-openspec构建失败单独重跑复现，未修改无关package也未修改依赖。
- 新增基础实现review指出4组缺陷：结构presence-only、automation拼写绕过pending、JSON env bool/number等价、容器类型traceback。按RED→GREEN修复，focused复核仍需记录。
- Adapter gate解释器加-B后，旧mock按argv[1]识别script失效；根因是新增解释器flag移动了脚本位置。已改为匹配argv中的脚本名，不改门禁断言。

## Round 2：fixture 与文档可执行性

- 新增持久recipe `tests/fixtures/minimal.py`，运行时生成2 oracle、3 checkpoint（含derived）、5观察、假截图和报告。先用空观察recipe得到真实RED（0 != 5），再实现fail→pass与blocked→pass显式supersede，fixture测试GREEN。
- 新增文档契约测试，从references的JSON代码块直接抽取oracle/plan/trail/observation，经真实freeze/mock/trail/confirm/append/execution全链路接受。初次已GREEN，如实记录为文档既有行为验证。
- Final fresh `python3 -B -m unittest discover -s skills/case-verify/tests`：89 tests /33.186s，OK，无skip。临时数据均自动清理，不提交截图或来源数据。
- 历史制品政策仍待用户确认，不建立例外、不清理历史、不启动后序viewer。目标保持active。

## 用户决策后恢复

- 用户明确选择“本次一并清理旧文件”，不使用祖父豁免；保留历史未决文字作为先前快照，上述“待确认”已由本条解除。
- 现有spec/design已要求archive及真实checking全部遵守严格规则，不改行为契约；新增70A任务与historical-cleanup.md记录迁移执行范围，无需改写原review认可的规范。
- 任务分工：core-reviewer负责14个archive186文件；evidence-recovery负责2个在途change50文件及test helper迁移。Lead处理跨目录引用和最终验证。

## 历史引用与TDD证据补账

- 实现者原始测试输出归因补齐：012..024全部因行为缺失RED（10FAIL、3数据缺失ERROR，非import failure），025..037全部RED（7FAIL、6缺hash/状态输出ERROR）；039/040/042/043/045/046为RED。004/005/006/008、038/041/044/047为已覆盖首次GREEN，不能宣称观察过RED。任务checkbox仅补真实见证部分。
- 旧notes迁移治理要求9个已批准删除的checking目标永久存在；增加retired元数据固定完整commit/blob，继续读取历史原文验证H1、迁移头和脱敏规则，禁止当前副本，不跳过测试。新retirement测试先因缺元数据RED。
- review正文曾使用相对于仓库根而非文档的链接，现只规范化链接目的路径，finding/verdict不变。
- 新skill/测试/helper及16摘要、236精确删除已暂存以满足git-ls-files治理；未提交，未合入。

## 隔离依赖恢复与基础集成闭环

- 调查全仓17失败：typescript/bin/tsc缺失、launcher报根依赖不完整、只读共享依赖复制导致EACCES。先ws promote进入mutable隔离依赖，再npm ci --ignore-scripts（exit0，491packages，未执行生命周期、锁文件无变更）。npm报告既有3漏洞（1moderate/2high），未擅自audit fix或升级。
- 恢复后实际npm test：645 tests、643pass、0fail、2existing skips，127.555s，exit0。focused affected49/49、0skip。依赖问题不通过修改断言解决。
- 基础模型89Python已验证，历史制品与独立代码review闭合后，按顺序开始viewer；私有adapter与生产cutover仍未授权，基础tasks不伪造完成。

## 待闭环

- 历史checking清理236文件与16摘要已完成、独立复核关闭；制品检查GREEN。依赖环境修复后全仓复跑进行中。
- 文档完整流程与原来源的最终核对、全仓失败调查仍待处理。最小fixture和示例schema测试已补齐，fresh Python89通过，4组独立review问题focused关闭。test-plan所有70命名场景已green；部分tasks尚未机械勾选没有逐项RED证据的条目（继承/组合测试初次即green），不伪造TDD历史。
- 私有adapter迁移/内部脱敏扫描、生产部署与入口切换需要单独授权/用户参与，不作为已完成。
