## 1. 前置:环境与基线复用确认

- [x] 1.1 创建隔离 Worktree Session(独立 `DSH_HOME`),并建立 fail-closed 的 sync 包装(`scripts/sync.mjs` 在 `DSH_HOME` 缺省时回落 `~/.dsh`,而本分支 `dshVersion` 将被改动——漏传一次 env 就会升级掉日常运行体;包装须在隔离 home 不存在时直接退出,不得回落)。
- [x] 1.2 确认归档 change `2026-09-04-staged-dsh-and-plugin-upgrade` 的 `baseline.md` 覆盖面仍适用于本次影响范围;在**当前运行体**上复跑其 A1/A2 自动化部分并记录(预期:仓库 96 例 95 通过 1 跳过、自研包合计 951 例,`dsh-pet` typecheck 因 `@types/react-dom` 环境漂移为升级前即失败)。
- [x] 1.3 为本次特有的破坏面补充专项验收项并写入基线:`authority` 回环边界、`Session.events` 替代读取、`registerContinuableSetup` 承接后的行为;为每项写出可执行步骤与预期结果。
- [x] 1.4 复核 registry 实况:`@deepseek-ai/dsh` 的 `latest` 是否仍为 `0.1.2-rc.1`,以及 `better-sidebar` / `sidebar-qa` 当时的最新版本,据此确定本次目标版本(design Open Questions 末条)。

## 2. spike:查清五个破坏点(门槛,不通过则停)

- [x] 2.1 查清 `Session.events` 在 `0.1.2` 的替代读取方式;分别确认 `dsh-pet`(取标题与水位)与 `worktree-session`(判定 blank session)两种用法各自的替代路径,记录是否需要不同处理。
- [x] 2.2 **查清 `authority: 'loopback'` 的等价机制**:确认 `0.1.2` 是默认即限回环、提供了其它配置方式、还是确实不存在等价机制。**若确认不存在,在此停止并将缺口作为显式决策上报,不得删参了事**(design D3、spec「安全语义类 API 被移除时不得静默降级」)。
- [x] 2.3 查清 `SubagentRuntime.registerContinuableSetup` 的承接 API,并判断 `worktree-session` 的 continuable subagent 建立策略是仅需换 API,还是需要改写调用形态。
- [x] 2.4 查清 `SessionLogOffset` 类型收紧后 `session-links` 的迁移方式。
- [x] 2.5 查清 `worktree-session` 3 例 `no agent factory registered` 的成因:是测试装置问题还是运行体行为变化。
- [x] 2.6 **在隔离环境让 5 个受影响包实际构建通过**,以此作为 spike 的完成判据;仅凭类型分析得出的"可以改通"不构成结论(design D1)。若任一破坏点无法在保持既有语义的前提下适配,停止并上报。
- [x] 2.7 输出 spike 结论并写回本 change 的 `design.md` Open Questions;结论须覆盖 host 与 client 两个半区(spec「运行体迁移的审计面必须覆盖宿主与客户端两个半区」)。

## 3. 适配与升级(同一批次,不可拆分)

- [x] 3.1 `dsh.yaml` 将 `dshVersion` 升到 spike 确定的目标版本(预期 `0.1.2-rc.1`)。
- [x] 3.2 适配 5 个包的 host 半区:`dsh-pet`、`worktree-session`、`system-clock`、`home-network-model-guard`、`session-links`;以保持既有功能语义为准,不借机重构、不调整用户可见行为。
- [x] 3.3 按前次已查清的映射改 7 个包的 client 半区 inject 声明(`sessions`→`dsh-api-session-controller`、`slots`→`dsh-client-ui-renderer`、`workspaces`→`dsh-api-workspace-controller`、`conversation`→`dsh-client-ui-conversation`);对上游已移除的 `dsh-client-runtime`,改为声明实际承接包或移除,**不得**机械改写为 `^0.1.2-rc.1`(该版本不存在)。
- [x] 3.4 同批更新全部 8 个 local package 的运行体 peer 至新版本族,刷新 `package-lock.json`,使 `tests/local-package-peers.test.mjs` 重新通过;不得通过放宽检查、豁免个别 package 或跳过检查来消除失败。
- [x] 3.5 各自研包分别通过 build / typecheck / test;**不得为迁就适配而修改测试期望**——测试失败应视为适配未保持原语义的信号。
- [x] 3.6 在隔离环境物化并连续两次确认幂等(第二次应为 `no changes`)。

## 4. 验收

- [x] 4.1 复跑 1.2/1.3 的完整基线并与升级前记录逐项比对;任何失败项必须先比对升级前结果再归因,不得未经比对即断言为升级导致。
- [x] 4.2 **专项验证 `authority` 回环边界实际成立**:确认 `/dsh-system-clock` 等 channel 对非回环来源不可受理;"编译通过"与"无报错"不作为通过依据(spec `settings-system-clock` 的「非回环来源访问 channel」场景)。
- [x] 4.3 逐项确认 8 个自研包在 Web 端**确实加载并可用**(复用基线 B1 的可见证据判据),对抗静默不激活。
- [x] 4.4 验证 `worktree-session` 的 `agent/session-start` 编排时序仍然正确(同步跳过 guard 安装 + 异步落盘),以及 `ws status` / `promote` / `clean` 的安全门仍 fail-closed。

## 5. 放行后置插件

- [x] 5.1 `dsh.yaml` 将 `better-sidebar` 升到 `0.18.0`(或 1.4 确定的版本),确认侧边栏各面板可开且无 duplicate prefix route 报错。
- [x] 5.2 `dsh.yaml` 将 `sidebar-qa` 升到 `0.5.0`(或 1.4 确定的版本);**确认 `dsh-client-ui-model-selection` 确实随 profile 加载**——`selectModel`/`modelCatalog` 由该包提供而非 `dsh-api-session-controller`,未加载则功能静默消失(design D6)。
- [ ] 5.3 验证 sidebar-qa 划选提问实际可用,以及依赖方 `session-links` 的「文档/资料」tab 仍正常注册与计数。
- [x] 5.5 (补)`dsh-cockpit-bridge` 升到 0.3.0(适配 0.1.2 + 承接 typert 设备的待审批观测),`@tangzai/dsh-ui-archive-manager` 禁用(其 client bundle require 已移除的 dsh-client-runtime,会中止整个浏览器 loader);补做「loader 可执行」审计,61 个已服务模块全部可解析。
- [x] 5.4 复核 `session-links`(peer `^0.16.0`)与 `sidebar-qa` 对 `dsh-better-sidebar` 的 peer 声明是否需要跟进(归档 change 已记录该声明滞后但运行时无双实例)。

## 6. 回主 checkout 与收尾

- [ ] 6.1 隔离环境验收通过后,回主 checkout 物化并复跑基线;确认日常 GUI 全部插件正常加载(启动清单项数与预期一致)。
  - ⚠ **阻塞项(2026-09-05 验收发现)**:`dsh-cockpit` 无法连接 0.1.2 实例(`/api` 换成 typert 网关:认证 + 端点命名 + 载荷形状三处同时变),主机一旦升级驾驶舱即失去对本机的观测。已记入 `BACKLOG.md` [U002],详见 `baseline.md`「验收发现的范围外破坏」。**执行 6.1 前需先决定 U002 的处理方式。**
- [x] 6.2 提交为独立 commit(`dshVersion`、5 包 host 适配、7 包 inject、8 包 peer 同批),使回滚粒度与批次一致。
- [x] 6.3 更新 `dsh.yaml` 各条目的审查记录,使 note 反映升级后的实际版本、信任面与已知约束;特别记录 `authority` 语义在新运行体下的表达方式。
- [x] 6.4 复核本 change 的 spec 是否已反映最终行为;如实际做法与 design 决策不一致,先更新 design/specs 再归档。
- [x] 6.5 `openspec validate dsh-0-1-2-host-api-migration --strict` 通过;仓库 `npm test`、`npm run check:artifacts` 通过。
- [ ] 6.6 归档本 change,并把发现但未处理的事项写回 `BACKLOG.md`(含 U001 的关闭或更新、P001 `dsh-ego-browser` 的重评估条件是否已满足)。
