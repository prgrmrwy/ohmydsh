# Verification — dsh-collab

## Verdict

**当前功能与隔离运行验收通过；严格流程验收未全部完成，不能宣布change/goal完成。**

代码基线为 `bbf89108`（kernel、目录构建输入及规划/组件）和 `c5b8ad66`（consumer实现）。本报告伴随的最后一批只补测试矩阵与证据，不修改生产源码。主场景为30项，acceptance-01展开normal/budget/kill后为32个叶项，不能把父项与子项混加为33项独立场景。逐场景定位见[test-plan](test-plan.md)。

## 当前行为验证

| 检查 | 实际结果 | 范围 |
|---|---|---|
| `npm --workspace packages/dsh-collab test` | 32单测、2产物/sync测试通过，无skip | 配置、provider、工具、FileStore生命周期、maintenance、npm pack/CLI、源码构建与复制部署 |
| consumer `typecheck` | 生产与测试TS均通过 | 不代替运行期接入 |
| consumer `test:components` | basic4、Controller/consumer12通过，无skip | 真实AgentLoop、ToolRuntime、session持久层、Controller、preset和安全组件 |
| consumer `test:host` | 三种官方关闭与业务重启、direct profile正常装配/重启通过 | 官方DSH 0.2.0-rc.2；只用合成会话/本地ScriptedAdapter |
| kernel `test` / `typecheck` | 38文件、205测试通过，类型无错误 | 原授权/持久格式/状态机回归 |

### 最后一批补足的oracle

- consumer发起invite实际触发冷恢复；P2真实request/header工具、文件read-only拒绝与read允许、Bash真实sandbox写拒绝与pwd允许、persisted approval never绕过允许answerer并留下rejected audit。工作树用例也改由真实consumer邀请恢复目标，验证原guard仍拒跨根读写、另一workspace允许控制不受影响；仍不宣称完整worktree HTTP/GUI装配。
- 四个真实读工具在join前全部拒绝；invited写拒绝、普通active成员领导操作拒绝、同cmdId不同payload保留CMD_CONFLICT，CAS保留STALE_REVISION/currentRevision。
- 仅.lock无.jsonl空间不被启动list当日志恢复，create仍LOCKED、不新建日志、不改变外来锁，健康空间可用且新锁0600。
- resolve等待期间目标归档及resolved agent.id/session.id不一致均零followup；header-only列表的inspect/observe/readTitleSnapshots和正文属性访问设拒绝计数器，验证只使用header列表且不读正文。该spy是consumer API边界，不冒称对官方后端每次OS read做了字节级追踪。
- maintenance覆盖非正数/小数/超安全整数/string/null/缺PID、坏JSON/错ID、live/EPERM/unknown、探测期间换ID与同ID换字节；拒绝路径锁字节保留，成功仅probe一次、breakLock一次、从不open。PID重用由“探测仍live即拒绝”规则保守处理，没有杀死或操纵无关进程来制造重用实验。
- 20工具逐schema保留身份字段不暴露、伪造输入拒绝；空白cmdId由插件拒绝，缺cmdId由DSH required schema提前INVALID_ARGS拒绝。首次把缺字段期望写为插件code的失败是oracle错误，修正预期而非改产品，不算TDD RED。

## 仓库与目录输入回归

本轮目录相关六suite（sync-build-inputs-dirs/build-freshness/local-package/preflight/deploy-refresh/deployment-integrity）48 tests全通过。根 `npm test` 445 tests：443 pass、0 fail、2既有MCP seam skip；skip原因均为根执行图不含精确dsh-mcp-client能力，它仅在managed profile/integration probe安装。未为清空skip访问日常profile或安装其它图。`check:artifacts`与`git diff --check`通过。root测试运行时含原先无关未提交README/.archify治理改动，不把其算作协作实现；提交严格定向排除这些改动。

## 官方关闭证据边界

最新实跑：normal11ms/code0/锁释放，budget5015ms/code0/残锁，kill3ms/SIGKILL/残锁。官方预算为同版profile-boot的5000ms总树预算，不是测试自设终止timer；外部deadline只作失败清理。budget是在真实append FileHandle.sync入口的受控barrier，不是声称OS fsync实际挂死。

三门由官方root持有native probe、await生产consumer teardown，probe内部为真实独立Context；每项均用第二个官方进程重启验证同cmdId原收据、serviceId/绑定和日志字节不增。额外direct测试把服务和consumer作为官方loader的同级profile行，验证Config/inject/appReady、正常停止/重启；**没有把direct正常门扩大为direct budget/kill已测**。

官方bin摘要 `1a03dee18683483ff6a1b27b2a1e650230da6bcca9a0f55f7d81b3308c3f307f`，预算chunk摘要 `c394b2aa2ce08a3b1fcc8c544257c7d689dd4d0b1cfaf8602687e65eeaba5aa1`。摘要用于识别检查的字节，不是独立上游tarball签名或供应链证明。

## 构建、移除与环境隔离

产物测试损坏旧kernel/lib并改src约定，真实tsdown/pack副本仍加载当前源码及原字节Markdown；Node权限隔离使源码不可达，缺Markdown副本明确失败。sync使用仓库fake installer复制fixture，但源码构建、部署JS/Markdown字节变化和import真实；连续第二次sync无变化。禁用后部署副本移除、独立持久台账保留。不是对真实包管理器日常profile安装的验收。

所有Host探针使用临时HOME/DSH_HOME、环境白名单和合成会话；没有读取日常profile/用户会话/凭据，未调用外部付费模型，未打开或重启3080 GUI。这里的证据是隔离路径与受控进程构造，**没有声称另对日常profile树做了实际前后快照测量**。未日常部署、合并、规范同步、归档或清理worktree。无关工作区改动不属于协作提交。

## 评审

whole-change只读review59afe指出3项Important：startup dispose晚封禁、动态workspace准入窗口、cold header managed目标竞态。Lead确认后修复，前两类有日志记录的真实失败回归；真实Cordis加载中dispose、Host启动/commit围栏、header返回后live重验均通过。focused review47727重读最新源码确认3项关闭且无有证据的剩余Important；这两项是静态评审，不是reviewer独立复跑。

最后测试批由当前executor完整diff本地复核：保留真实组件拒绝/允许对照、共享schema映射，store/maintenance spies不stub掉真实行为，临时文件删除前检查绝对目录，超时仅失败而非通过判据；未新增生产能力或依赖。

## 未关闭的历史流程门

详见[执行记录](implementation-log.md)与[任务列表](tasks.md)。**不是全部缺RED**：产物契约、config允许错误输入、provider身份/发现/来源、20工具空集合、maintenance未拒绝、CLI --help及后续两类竞态都有真实RED记载。

但是tasks3.1、3.3、4.1、4.3、5.1各要求完整列举负例先写并观察真实RED；现有证据没有逐项证明所有later cases都满足该顺序。当前补充测试通过只能证明当前行为，不能回到过去，也不能把harness/import/猜错code的失败计入产品RED。tasks6.1要求逐行RED/GREEN核验，同样不能以现在全绿勾完。保留这六项未完成，不删除、不重写要求，也没有标成accepted deviation。

3.4为执行矩阵任务，不附加历史先写要求，当前行为/请求头/来源/turn及额外竞态可独立验收。6.4是按事实写本总结并严格校验，也不等于接受其余流程偏差。若需要关闭严格流程门，须人明确决定如何处置缺少完整历史顺序证明；本报告不代用户接受，也不重新跑人为RED冒充原始顺序。

上轮Anvil严格FAIL与根既有两个MCP seam skip均不改写；根skip不属于本consumer支持路径。change和goal保持未完成，不自动进入合入或归档。

## 自主收尾说明

用户随后要求「如果可以的话，要求你自主完成」。已重新核对三个协作提交、当前生产实现、官方任务状态和严格校验；当前功能测试确已全部执行，不要求用户再跑测试，也没有已确认而未修复的产品缺陷。余下六个复选框表示的是原任务中完整测试先行顺序的历史证据不足，不是六组功能未实现或尚未运行。

自主执行不等于接受历史偏差，故没有把该回复登记为豁免、没有勾选这六项，也不制造新的失败来替代过去的执行记录。当前交付已提交，可独立检查；严格change闭环仍受这项不可追溯补造的历史条件限制。后续只有新增当时的真实证据或人明确改变验收条件才会改变该判定；没有生产改动时不重复相同全套测试，不启动部署、合并或归档。
