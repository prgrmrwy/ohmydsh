## 0. 冻结目标与基线

- [x] 0.1 查询 `@deepseek-ai/dsh` dist-tags，确认目标仍为 `0.2.0-rc.2`，记录 tag commit；出现更新的 rc 时停下，回到 proposal 重新冻结目标
- [x] 0.2 在当前 0.1.5 上执行并记录 `npm test`、`npm run check:artifacts`、11 个 local package 的 build/typecheck/test 结果（含已知跳过项），作为后续每波的比对基线
- [ ] 0.3 记录生产启动清单、loader 行数，以及 memex 各工作区的路由、主入口和开关结果（逐工作区快照），供 W4 迁移比对（部分：6个真实路径新旧resolver只读对照完成；发现主干1519454把internalHosts外置，devbox无私有overlay时2个内部库会退external——生产前置条件；生产dump176行/候选207行、差异逐项归因完成，见checking/current-main-remaining-host-gates.md）

> 执行边界：本机实施/devbox验收；2026-10-08起用户授权devbox作专用测试机，其真实`~/.dsh`已完成0.2切换演练（本机Mac现役与他人Host未动）。下方W1/W2“上线”、用户重启以及6.4–6.6生产步骤属于原分阶段方案，未经独立明确批准不执行。每批由用户授权的DSH subagent只读评估主线/变更扩散；不因待验任务而扩大产品范围。

## 1. W1 前置清理（原分阶段方案：0.1.5 上线，约 1h）

- [x] 1.1 在私有 overlay `dsh.yaml` 中把 traex-bridge 设为 `enabled: false`，note 写明「用户不再使用，0.2.0 无兼容版」（2026-10-08更正：此前只改了验收环境，devbox与本机的实际overlay仍为enabled:true；devbox切换时实测其使0.2 Web boot整页失败，已在devbox改为false。本机overlay同样需改，否则切到0.2后打不开）（2026-10-08再更新：私有registry发布traex 0.1.16，peer支持0.2.0-rc，已审查并在devbox改为0.1.16重新启用，模型目录25、真实调用与web_search通过；停用不再需要，本机overlay切换前改为0.1.16）
- [x] 1.2 审查 cost-meter 1.8.6（实施时 latest 已到 1.8.11，改 pin 1.8.11，双侧 peer 同样满足）、subscriptions 0.9.7、width-tiers 1.0.6 的发布物差异（网络、凭据、依赖），更新精确 pin 与 note，并写明回滚 pin
- [x] 1.3 worktree-session：`agent/session-start` 改为 `agent/created`；补测试证明注入、绑定仍在首个回合之前完成
- [x] 1.4 dsh-memex：`agent/session-start` 改为 `agent/created`；补测试证明召回引导仍在首个回合之前注入
- [x] 1.5 ai-code-report-bridge：`tool/code-dispatch`→`tool/ptc-dispatch`、`header.model`→`header.config.model`、`message.model`→`source.model`；用 vendor 生成物做差分测试，并在 note 中写明上报内容的变化
- [ ] 1.6 运行 W1 涉及包的测试与根 `npm test`，`dsh build` 连跑两次（第二次无变化），确认启动清单不再含 traex 且其余条目各出现一次
- [ ] 1.7 请用户执行 `dsh restart`；验收费用面板、订阅登录与 codex 目录、宽度档位、Worktree 首发、memex 召回注入，然后提交

## 2. W2 配置所有权（0.1.5 上线，约 2–3h）

- [x] 2.1 写失败测试：设置页写入 profile patch 后连续 sync 两次，写入的内容仍在；覆盖片段与下层 config 键共存
- [x] 2.2 sync 的 patch 写入改为只替换生成标记区段，区段外内容逐字节保留；首次迁移时把旧的整文件生成物识别为区段
- [x] 2.3 覆盖类片段（如 org-hosts 的 `dsh-memex`、`session-links`）改为按键合并 config，替代整行替换（实现为 manifest 显式 `mergeConfig: true`，只允许纯覆盖行；运行时**之后**的保存仍会覆盖同一行，见 design D3「W2 实施发现」，由 3.8 定案）；`patches/connection-webserver.yml` 保持原有整行语义并加测试锁定
- [x] 2.4 sync 区分出厂 bundle、manifest 定制和运行时安装的插件：漂移只报告、不纳入 `shippedBundles`、不删除；写 profile `package.json` 时与运行体的文件锁协调
- [x] 2.5 在 0.1.5 上实测：生成 patch 的生效配置与改造前逐项一致（dump-config 比对），连跑两次 sync 幂等
- [ ] 2.6 用户重启验收后提交；更新 `repo-layout` 实现说明

## 3. W3 运行体与易改项（隔离候选，约 3–4h）

- [ ] 3.1 创建隔离候选：独立 `DSH_HOME`、非 3080 端口；放入 `~/.dsh/sessions`、Pet SQLite、profile 与 `settings.yaml` 的 owner-only 脱敏副本，并做完整性校验
- [ ] 3.2 在候选中部署裸 `0.2.0-rc.2` 官方 profile，验证 CLI、dump-config、Web 认证链和 `settings.yaml` 导入；记录被导入的段落与未被接收的段落
- [x] 3.3 `dshVersion`→`0.2.0-rc.2`，同批完成：skill-filesystem、mcp-client provider 的 pin 与 integrity；`scripts/jev-readiness.mjs` 和 tests 中写死的 0.1.5；11 个 local package 的 peer 改到 0.2.0 版本族；`dsh-settings-file` 等已删除包按接口迁移处理，不改成同名新版
- [x] 3.4 subscriptions-sandbox-shim：先写 `role:'tool'` 工具结果的失败测试，再让配对识别同时支持两种表示
- [x] 3.5 session-links：`content[0]?.isError` 改为 `message.isError`，补测试
- [x] 3.6 worktree-session：适配运行中归档抛 `WorkspaceActiveSessionError` 的清理路径；handoff 对 `input.submit` 透传新增的 `source` 参数；测试覆盖 Enter 与点击两种提交方式
- [x] 3.7 第三方插件：better-sidebar 0.24.1、skin-center/session-archive 0.4.4 审查后改 pin；历史候选核对 cockpit-bridge 0.5.1 与 0.6.0。移植到较新主干 b6e5c474 后保留其既有 0.5.2 pin，不回退为旧候选0.5.1，也不机械升0.6.0；当前0.5.2组合的实测仍由3.11/6.1放行
- [ ] 3.8 候选上实测 D3 增强方案 B：`dsh-memex` 实际设置编辑成功，org 键即时共存，build×2 后用户值与 org 键仍生效；`session-links` 仅验证既有链接/产物能力与声明式 rule hosts 的保留，不新增 Config/设置编辑功能（按用户范围纠正）；不以文档或单测代替此验收（部分：合成org两键+真实configForms编辑/立即回读→sync×2第二次no changes→official dump→Host重启回读→恢复用户值/退休合成org PASS，未读真实private overlay；session-links真实v4会话整日志基线+合成声明式rule hosts经mergeConfig sync×2后由Host下发并按规则分类PASS；仍缺真实private overlay值逐项比对，见checking/current-main-remaining-host-gates.md）
- [x] 3.9 候选上验证 connection 405 修复片段仍然需要且有效：去掉它时插件 RPC 返回 405，加上后返回 200（83c69cf devbox：支持的 --patch 恢复 dump-default-config 中原始 connection 行，已认证 RPC 405；正常 composition 已认证200/未认证401；见 checking/devbox-final-regression.md）
- [ ] 3.10 Session v4 演练：脱敏副本上首次写入发布 v4；重启后状态一致；损坏与截断样本按预期处理；回滚到 0.1.5 并恢复备份后可读（部分：合成样本+候选built storage已验证v4发布/新Context重载/损坏拒绝/截断非破坏读取；0.1.5-rc.2独立进程拒绝v4、恢复v3后读回7事件；755上游测试通过。后续三个远端原样私有zstd副本1009/1093/597事件已完成built组件read/write/独立进程reopen匹配与备份恢复后old-read，临时副本删除；不外传内容。2026-10-08补隔离回滚演练：备份→0.2发布v4+Pet DB切换后写入→恢复备份逐字节一致→0.1.5 reader读回一致、Pet DB切换后写入消失；真实0.1.5-rc.2 launcher在恢复数据上启动并列出78会话。仍缺旧Host续写已恢复会话的GUI路径、旧Pet live行为与npm ci/compat重建全流程，见checking/current-main-remaining-host-gates.md）
- [ ] 3.11 候选中禁用 memex 与 Pet，组合其余全部定制；记录启动清单（每项各出现一次）、loader 结果和各插件功能证据，与 0.2 基线比对

- [ ] 3.12 （本地实施中发现）三个包读的 `SessionListState.current` 在 0.2.0 被删（upstream 6830e1460d），改为 `retainedBy.mainView` 双版本读取；候选上实测标题徽标、provider 图标、guard 预热跟随会话切换（部分：2026-10-08 真实点击A→B→A标题徽标精确跟随PASS；实测发现0.2当前crumb改为span致徽标不出现，已RED→GREEN修复title-locator。provider图标按行随所选会话更新已补证（不同provider的两会话）；仅guard按切换预热未独立证明（切换期间无可归因HTTP请求），见checking/current-main-remaining-host-gates.md）

## 4. W4 memex（隔离候选，约 2–3h）

- [x] 4.1 声明 dsh-memex 自有的 MessageSource kind，替换 `kind:'plugin'`；测试证明含该消息的会话可经 0.2.0 持久化路径写入后重新加载
- [x] 4.2 Host 侧配置从 `ctx.settings.register`/`SettingsScope` 迁到 loader 行 config（schemastery + last-good 语义）；移除 `dsh-settings-file` 依赖，改写相关测试
- [x] 4.3 设置页从 `settingsScope.bind` 迁到 `configForms`：保存仍以 Host 回读为准，保留工作区声明、主入口和开关的守门逻辑
- [x] 4.4 配置迁移：`settings.yaml` 导入的 `dsh-memex.scopes` 与 org-hosts 的键合并后生效；迁移失败时 fail closed，不发布工具
- [ ] 4.5 候选上启用 memex：逐工作区比对路由、主入口和开关结果与 0.3 快照一致；人工验收记忆设置页、卡片浏览、召回注入和写卡提醒（部分：原样cost1.8.4/header0.1.0+自研bridge验收包，真实Memory保存/回读/sync×2/刷新、合成卡片真实kernel浏览、双库同workspace primary/fallback/memory resolve投影均PASS；另：现役6路径新旧resolver只读对照（internalHosts外置前置条件）、真实Go会话召回注入与写卡提醒持久化PASS；不等于实际工具拒绝或memex_retro写卡，见checking/current-main-remaining-host-gates.md）

## 5. W5 Pet（隔离候选，约 4–5h）

- [ ] 5.1 先实测子代激活名额池：确认 locus 创建、只读访问、冷恢复各自怎样占用和释放名额，据此确定 5.5 的改动面
- [x] 5.2 `compat/subagent` 改为以 `dsh-v0.2.0-rc.2` 为基线：重写失败的 `child-agent.ts` hunk 和测试 hunk；4 个 seam 逐项重新举证并记录被排除的官方替代路径；更新 tag、commit、patch hash、能力 marker 和 README
- [x] 5.3 launcher 的依赖范围改写（`~`/`*`→`^`）后，证明 cordis 等运行体包在依赖树中只有一个实例；`supportedDshVersion` 与 `dshVersion` 精确一致（devbox bab1a536：npm ls --all 无 problems、Cordis 4.0.4 单实体、builder/cache 验证通过；见 checking/devbox-runtime-continuation.md）
- [x] 5.4 `dsh-pet-executor` 改为由 sync 渲染成 `dsh-agent-preset` 声明行；清理 sync 账本中记录的 `.agent-presets` 产物；Pet 依赖从 `dsh-agent-presets` 迁到 `dsh-agent-preset-registry`
- [x] 5.5 child 存在证明改为依赖 catalog 现存字段（`child.ts:1701`、`qa/subagents.ts`）；名额不足时进入可重试状态，不丢投递
- [ ] 5.6 Pet 全量测试与运行时探针：silent 结算、idle child、independent 冷恢复 + 已保存 preset、精确 child Session、Storage 原子性，任一项退化即判定 NO-GO（部分：真实Host locus子代创建→Host重启后durable同child/generation、header标记preset dsh-pet-executor→幂等重绑→归档PASS（未证恢复后实际turn/preset重新挂载）；实测发现本候选新home缺attachments时locus子代每次创建失败，已RED→GREEN修复project-read-guard；silent结算/投递未验）
- [ ] 5.7 候选上启用 Pet：轮盘、Locus fork/independent 基线、SQLite 单 writer、真实飞书入口与媒体下载

- [ ] 5.8 （本地实施中发现）Pet 客户端：`SessionListState.current` 删除、`sessions.open/openSubagent` 迁到 `uiWorkspace.openSession`；executor preset 的 `dsh-workflow-worker-thread` 在 0.2.0 已更名 `dsh-workflow-ptc`；候选上实测「打开会话 / 打开 locus 子代」与 executor preset 挂载（部分：executor preset实际37工具挂载含workflow-ptc PASS；普通会话真实点击打开PASS；Pet面板打开locus子代经官方openSession(SubagentAddress)选择精确PASS，有内容子代渲染未验）

## 6. 原子切换 gate

- [ ] 6.1 候选完整组合（W3+W4+W5）连跑两次 sync/build：第二次无变化，dump-config 可用，启动清单每项恰好出现一次，loader 全部可执行（部分：验收manifest组合sync×2第二次no changes、official dump207行无重复id、Host+未改浏览器boot无加载错误；正式bridge pin仍为未适配公开0.5.2，需bridge发布后用正式pin复跑）
- [ ] 6.2 复跑根测试、11 个 local package 测试、`check:artifacts`、`openspec validate --strict`、`git diff --check`，与 0.2 基线逐项比对（部分：2026-10-08对含全部修复的未提交源码快照v2做devbox清洁构建，root321/319/2skip、11包全过、typecheck全过、artifacts/diff通过，本机strict通过；须在6.3精确commit上复跑后勾选）
- [ ] 6.3 提交候选 commit；在 devbox 上对该精确 commit 做清洁构建与场景验收（沿用 0.1.5 change 的 9.x gate）
- [x] 6.4 生产备份：`~/.dsh/sessions`、Pet SQLite、profile 目录、`settings.yaml`、manifest，全部 owner-only 并做完整性校验；记录回滚所需的旧 commit 与 pin（仅devbox 2026-10-08：cutover-backup-20261008T161806，0700、Pet integrity ok、全量21003文件sha256、原分支main/HEAD 59ad0e5b与旧launcher留存；本机Mac的备份待其切换时再做）
- [ ] 6.5 用户批准后按 Worktree Session 受控流程合入，生产执行 `dsh build` 两次，由用户执行 `dsh restart`（devbox演练部分：未合入，本地分支`upgrade-0.2.0-rehearsal`应用精确源码，build×2幂等、restart成功；本机生产与正式合入待用户批准）
- [ ] 6.6 刷新现有 3080 GUI 完整验收：Session 列表与续写（产生 v4）、各插件、memex、Pet/飞书；失败时按 design 的回滚顺序恢复（部分，devbox 2026-10-08：79会话列表、真实会话续写产生v4、模型目录、自动化任务、设置13节、Pet ready+4 locus、组织值规则生效；飞书真实入站与正式bridge pin复验待做）

## 6a. devbox 验收发现的 profile 组合修复（2026-10-05）

- [x] 6a.1 补官方含注释空数组 scaffold 与写前拒绝回归，在 devbox 证明 RED → GREEN
- [x] 6a.2 仅规范化空序列括号、保留注释，完整组合在写 patch/backup 前校验；对齐 D3 的 proposal/design/delta spec
- [x] 6a.3 devbox 精确修复提交：完整根测试、真实新 profile sync×2 + dump、既有失败候选自然修复 + dump，记录证据；不替代 6.1 的全部 loader/功能验收（20a498a，293 total / 291 pass / 2 skipped；见 checking/devbox-profile-fix.md）

## 6b. devbox 完整运行体实测阻断（2026-10-05）

- [x] 6b.1 历史诊断：header0.1.0与cost-meter1.8.11的fetch环曾用未发布a5011e0验证根因（见checking/devbox-final-regression.md），但用户已明确不允许改第三方源码/为此patch DSH，该修复不作正式部署方案；最终无源码改动方案由6d.1/6d.2承接
- [x] 6b.2 在 cockpit bridge 发布源适配 0.2.0 Session selection/status 并验证 client 正常激活（2026-10-07用户再次明确“bridge是自研，允许单独适配”，第三方cost/header仍不改源码）；0.6.0 同样使用旧 pendingInteractions，且有端口转发 breaking change，不可机械升级（bridge7102a12，32测试；真实cockpit auth d13befa后hello/selection/pending均201、聚合1→0；不代表0.6 forwards通过，未发布；2026-10-08当前0.5.2本机适配包经独立Cockpit实例(39910)真实联调hello/A→B→A session-opened/pending 1→0全部2xx，见checking/current-main-remaining-host-gates.md）
- [ ] 6b.3 修复后重跑真实设置页、完整 loader 与其余独立门禁；历史 Host API scope 保存/拒绝/立即回读/sync×2 持久化已过；当前主干0.5.2桥接本机适配后34测试/typecheck/build与真实Memory页面保存→Host回读→sync×2第二次no changes→official dump→刷新通过（见checking/current-main-bridge-memory-ui.md），仍不替代完整3.8/4.5

## 6c. 当前主干移植与共享配置修复（2026-10-07）

- [x] 6c.1 纠正基线：本机 b6e5c474 比 devbox59ad0e5b 更新；只移植净migration，保留较新主干能力；clean npm ci/全部包build与11包tests通过
- [x] 6c.2 验证当前主干正式组合：sync×2幂等、官方dump207行、exact launcher builder通过；真实Host发现正式header fetch递归，验收专用a5011e0修复后认证shell200/__DSH_BOOT__通过（正式pin未改，不等于完整loader/GUI）
- [x] 6c.3 RED→GREEN修复ConfigEditor同款锁、patch/backup owner-only原子发布、mergeConfig键保守退休、legacy原值恢复与!!js保留
- [x] 6c.4 patch/ownership跨文件进程中断恢复、malformed ledger fail closed；最终devbox root321 total/319 pass/2 skip/0 fail，sync×2第二次no changes、官方dump207，严格规范与diff检查通过（非断电fsync保证）

## 6d. Header/cost-meter无需源码patch的组合选择（2026-10-07）

- [x] 6d.1 核对正式版本边界：0.2 peer从1.7.44支持，fetch observer从1.8.5引入；22个发布物SHA512核验，候选pin改1.8.4，header保留原0.1.0，不修改第三方源码或为此patch DSH
- [x] 6d.2 devbox原样安装、Cost RPC/真实Settings→Cost、原header进程内无网络注入探针、sync×2第二次no changes及官方dump各一条；sync后再启动/browser通过，干净storage候选亦通过；沿用先前acceptance-only bridge，不替代正式完整组合，见checking/header-community-options.md
- [ ] 6d.3 现役1.7.30账本脱敏副本→1.8.4读取兼容、真实模型usage费用累加与Go/Zen实际调用（部分：devbox20天/80会话历史读取/写回/重载完全保留，合成监听器usage入账一次/固定计价正确，两种stream listener顺序并发会话独立；2026-10-08经用户授权复用主干Go凭据：候选真实opencode-go/deepseek-v4-flash一次调用成功，cost-meter1.8.4按provider/model/session计入token与calls，Go按订阅plan计0元；原header在线未触发MissingSessionID；Zen经用户确认不在范围（主干只用Go，未配置Zen））；若完整验证失败，按用户最新优先级保留OpenCode/header、显式禁用cost-meter，不修改插件/DSH源码（1.8.11已写过的候选价表有旧codec告警，不得删用户价表换取PASS）

## 6e. bridge 0.6.1 消费方迁移与正式部署（2026-10-08）

> 本轮收尾决定（用户2026-10-09）：能力完成后推送远端主干即结束；新机部署由用户自行另行处理。不追加浏览器验收、隔离服务或其他设备部署。下列未完成的完整验收/归档项保留事实，不算本轮交付阻塞，也不因用户结束交付而伪标验证通过。此决定不是整个历史升级change的全量验收或归档授权。

- [x] 6e.1 清理已授权 .local-repair；保留在用 launcher 与未授权 staging/其他 worktree
- [x] 6e.2 真实 memex registry + 仅 forwards 服务回归证明旧 shim RED；迁移新 API 与错误分类、等待/取消/释放/单飞，package 测试和类型检查通过
- [x] 6e.3 完成完整 diff 自审、package build、根测试、artifact 与严格 OpenSpec 校验，受控合入并推送主干（d1c4c15；见 checking/devbox-main-d1c4c15-deployment.md）
- [ ] 6e.4 devbox 从主干拉取，正式 build×2 幂等、restart、真实功能/浏览器验收；保留私有 overlay 和历史（部署/start已过，第二build no changes，3080 PID656211；未认证401不作业务API通过；专用单agent待oracle/入口确认，浏览器验收未执行）
- [ ] 6e.5 已撤销：不在devbox部署隔离新服务。用户2026-10-09明确新机验收指其他设备，devbox只验现有主干正式3080；其他设备待后续独立决定。执行者此前误解范围额外做了隔离home启动检查，临时39522已停止，该检查不计用户要求的新机验收（历史事实保留于 checking/devbox-main-d1c4c15-deployment.md）。

## 7. 收尾

- [ ] 7.1 把每个第三方插件的最终 pin、审查与回滚说明写回 `dsh.yaml` note
- [ ] 7.2 写入轻量验收报告到 `checking/`（不含原始数据、密钥和批量截图），更新相关 docs/notes
- [ ] 7.3 请用户确认后归档本 change，同步 current specs
