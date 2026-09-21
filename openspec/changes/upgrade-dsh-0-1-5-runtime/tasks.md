## 1. 冻结目标与升级前基线

- [x] 1.1 再次查询 `@deepseek-ai/dsh` dist-tags、`dsh-v0.1.5-rc.2` tag commit 与目标包元数据；若稳定频道目标变化则停止实施并更新 proposal/design，不自动追新
- [x] 1.2 盘点所有 local package 的 runtime dependency/devDependency/peerDependency、host/client seam 与当前测试命令，生成 9 包迁移矩阵
- [x] 1.3 在当前 `0.1.2-rc.1` 上执行并记录根 `npm test`、`npm run check:artifacts`、9 包 build/typecheck/test 及已知跳过/环境差异
- [x] 1.4 在隔离旧版 `DSH_HOME` 连续执行 sync/build 两次，记录第二次无变化、dump-config、启动清单及每个已启用插件恰好一次
- [x] 1.5 固定旧版人工/黑盒基线：Worktree 首发、Session 冷恢复、Memex、guard、clock、session-links/title/provider icon、Cockpit、remote Web 插件与 Pet/飞书链，并列出无自动化覆盖项
- [x] 1.6 选择经脱敏的真实旧 Session v0/v1/v2 样本与 Pet 数据副本，记录身份、标题、workspace/cwd、lineage、provider、assistant/tool 内容等迁移 oracle，不提交原始 session/history evidence

## 2. 第三方插件前置审查与分组决策

- [x] 2.1 审查 `dsh-cost-meter@1.7.30` 发布物、网络/凭据/依赖变化与 `^0.1.5-0` peers；若可在旧版独立升级则单独改 pin、物化和验收，否则记录进入运行体批次的理由
- [x] 2.2 审查 `skin-center`/`session-archive@0.3.24` 发布物与 engines/Session 行为，分别决定前置升级或运行体同批，并记录回滚 pin
- [x] 2.3 审查 `dsh-better-sidebar@0.19.1` 对官方 sidebar-right 的接线、peer、工具/网络面及与 local session-links 的组合边界，确认作为运行体同批候选；sidebar-qa 不再进入组合
- [x] 2.4 为 subscriptions `0.9.2` 制作可复现最小 compatibility fork：仅给 attachment/home-paths/llm/tools 四个 production peer 追加 `|| ^0.1.5-rc.2`；runtime 源码/client inject/cordis patch 不改，dev/CI 另更新 0.1.5 dev deps、dsh-agent augmentation 和测试依赖；固定 tag/tgz/hash/patch provenance
- [x] 2.5 从 manifest 原子移除 open-in-vscode、sidebar-qa、setting-restart，验证其 bundle/patch/dependency/启动清单条目消失且不误删 better-sidebar（local session-links 仍依赖）
- [ ] 2.6 保留 archify-dsh `0.1.0`（当前唯一 Archify Skill 来源），验证 0.1.5 下只有一个 archify provider，生成、validate、deliver、visual-check 和导出仍可用
- [ ] 2.7 复核 width-tiers、cockpit-bridge、opencode-session-header；审计 Trae `0.1.15`，保持 repo 默认 env gate，并只在 devbox 验证本地启用状态与升级后的实际能力；host/lumevm 留给用户手动部署

## 3. 裸 DSH 0.1.5 与数据迁移演练

- [x] 3.1 创建独立 `DSH_HOME` 和非生产端口，只部署官方 `0.1.5-rc.2` profile；验证 CLI/dump-config/Web，并覆盖 `--from-default-profile` 的 launcher 路由、fresh/existing custom profile、shipped profile 名、desktop 拒绝及 plugin add/remove/why（见 `checking/official-runtime-probe.md`。隔离 `DSH_HOME=/tmp/official-home-3x/*`、端口仅 3099。**命令面与 launcher 不同**:官方 CLI 只有 `web` 与 `plugin` 两个动词,**没有** build/stop/restart/start（那是本仓库 launcher 包装层独有的）；选项为 `-V/--version`、`--profile`、`--from-default-profile`、`--patch`、`--dump-config`、`--dump-default-config`。`--dump-config` → exit 0，**loader 条目 152 / 唯一 id 152 / 重复 id 0**（20 个分片 id 互不相交）；唯一重复「名字」是 `@deepseek-ai/dsh-tool-subagent` 而 id 不同（provider: spawn / fork），非 id 冲突。**profile 路由矩阵逐格实测**:fresh custom + `--from-default-profile web` → 0（建出 rescue profile）；同一命令重跑 → **1** `already exists …; omit --from-default-profile to use it`；existing 不带该参数 → 0（幂等）；fresh 不带该参数 → **1** `does not exist; create it with 'dsh plugin --profile <name> add <package>'` 且不建目录；shipped 名当目标 → **1** `is shipped and cannot be a custom profile target`；未知模板 → **1** 并直接列出内置模板全集 `acp/headless/sdk/sdk-minimal/web`；5 个 shipped profile 自动初始化 → 全 0；克隆体真实启动（`--profile rescue`@3099）→ **0**，HTTP 200 / 27 724 B。**desktop 拒绝**四个入口文本逐字相同、exit 均 1：`error: profile "desktop" is managed exclusively by the Electron application`。Web 认证链:无 token → **401**，带 token → **303** 并下发 `dsh-auth-<hex>`（HttpOnly/SameSite=Strict/Max-Age=2592000），跟随 → 200；CDP DOM dump 确认**真渲染非空壳**（352 502 B DOM、真实文案）。**plugin 实测是 pnpm 10.16.1 转发器**：add/why/remove 均 exit 0、bundles 正确回收；两个边界:`why` 对**未安装**包 exit 0 且零输出、`remove` 未安装包 exit 1 `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`。**两个环境坑值得记入文档**：① `plugin` 的 profile 在仓库外 ⇒ 读**用户级** `~/.npmrc`（devbox 上是内网 `bnpm.byted.org`），该镜像 `dsh-headless` 的 `dist-tags.latest` 仍是陈旧的 `0.0.1-rc.1`，导致**不带版本号的 add 失败**；钉版本 + `npm_config_registry=https://registry.npmjs.org/` 即通。② **add 失败时 profile 仍会被创建**（初始化与装包非原子）。**诚实边界**:本项证明的是**官方运行体**语义，不外推到本仓库 overlay 组合）
- [x] 3.2 在真实旧 Session 备份副本上触发官方 v0→v1→v2→v3 migrators，逐项比对内容并证明旧 generation 保留、新 generation 原子发布、lease 排他与中断后 generation 选择
- [x] 3.3 在迁移后的同一 Session 中继续提交、停止并重启 Host，确认恢复写入和重启结果一致且原始生产源未被候选打开或改写
- [x] 3.4 注入损坏、不受支持格式、写所有权竞争与中断场景，确认候选 fail closed 且备份可恢复（见 `checking/migration-adversarial-injection.md`。素材为升级前 `dsh-home.tgz` 解出的副本（40 文件 / 6 项目），官方 `dsh-session-persistence-jsonl@0.1.5-rc.2`。**⚠ 最重要的一条是负面发现**:尾部**截断 41%**（1 686 827→1 012 096 B）→ **exit 0、stderr 全空**，读回 **409 事件**（干净基线 654，即 62.5%），并**静默发布** 382 913 B 的新 generation ⇒ **这一格没有 fail closed，会静默产出半截会话**。除此以外**其余各格均 fail closed**：中间翻转 64 字节 → exit 1 `corrupt Zstandard session log: invalid frame magic at byte 843470`；迁移后破坏当前 v3 代 → exit 1 **且不回退到完好的旧 v0**（一律拒绝、从不自动回退）；**不支持格式 5/5 全 fail closed**（`version=99` 名实不符 / `version="99"` 非法类型 / `version=2` / 自洽的 `session.v99.jsonl.zstd` → `SessionFormatUnsupportedError` / 完好 v0 + 一个不可读 v99 **同样拒绝而不降级**）—— 运维含义:一次误写入的高版本 generation 会让同目录**可读的旧数据一并不可达**。**写所有权**:陈旧 lockfile 不阻塞（内核 flock，进程死亡即释放，**设计正确**）；**两个活 writer → exit 1 `SessionAlreadyOwnedError`（排他成立）**；但**持有期间外部 `rm session.lock` 会让第二个 writer exit 0（双写窗口）** —— 复现了上游源码自己记载的 POSIX 语义，需外部行为体删锁才触发。**中断（SIGKILL）**：精确命中临时文件 186 B 与 268 290 B（改名前一瞬）两个杀点，杀后 **v0 逐字节完好、无 v3、无半迁移 generation**，重跑 exit 0 且产物 sha `166fe87a4e77a690` 与干净迁移**逐字节相同**（强于计数证明）。**备份可恢复（三重实证）**：注入前后 manifest 重扫 40/40 文件、79 450 行、DRIFT=0/MISSING=0；源备份只读核验 sha256 `eeac5805…`；从 tarball **全新重解**后迁移产物 sha 与基线/两次 SIGKILL 重跑**完全相同** ⇒ 备份可恢复**且迁移是确定性的**。另记两条小发现:崩溃残留 `.tmp` **不被回收**会累积（无害、不参与代发现）；朴素一次性 zstd 解码会把任意会话报成「1 行」（**多帧**解码下样本 dd03534e 为 95 帧/310 行），全文行数均用多帧解码器产出。**诚实边界**：全部注入走**官方库**而非本仓库 overlay 的 Host 装配路径 ⇒ 证明的是官方运行体语义，**不能直接等同"本仓库 Host 端到端同样 fail closed"**；未做真实 `dsh web` 界面触发迁移（需模型凭据）、未测多会话并发迁移、未单测 worker 线程自身被杀、未测 Windows 分支、截断只测了 41% 一个点）
- [x] 3.5 记录生产迁移的 writer 停止顺序、Session/Pet 一致性备份、完整性检查与从新格式回滚到 `0.1.2-rc.1` 的演练结果
- [x] 3.6 让回滚路径真正可用 —— **已完成并实机验证**(checking/rollback-drill.md)。实测判定:回滚可行,不需预置“可运行旧运行体快照”;缺失的是**依赖也要一起退**:旧源码 + `npm ci` + `dsh build`(exit 0/143s/零失败)+ `dsh restart`(exit 0/77s)可完整退回 0.1.2-rc.1,Pet ready、GUI index 200、会话回到 plain 40/v3 0。原先记的三个阻塞中,①靠 `npm ci` 解决,③(admitPromptContent)证实是依赖不匹配的连带症状而非独立缺陷,②(compat 浅克隆拿不到旧 commit → 启动器拒绝降级 → Host 不启动)靠删除 `.upstream`/`.storage-upstream` 让其重新克隆解决。遗留(不阻塞回滚,故合并在本条):最终跑通那次缓存已在旧 commit 上,即“干净缓存 + npm ci”组合是由两半各自观测推出、未在同一次连续运行中合并验证。

## 4. Local runtime 声明与通用 API 迁移

- [x] 4.1 将 `dshVersion`、全部受管 local `@deepseek-ai/dsh-*` dependency/devDependency/peerDependency 及 lockfile 原子迁到 `0.1.5-rc.2` 版本族，保持 `autoUpdate` 关闭并让 peer 门禁最终重新通过
- [x] 4.2 适配 AgentSetup `(agentCtx, agent)`、parentAgent/runtime ownership、Inbox/Agent Loop 私有化及手造 child fixtures，验证 parentSession 持久 lineage 与 live parent ownership 不混淆
- [x] 4.3 适配 Session persistence handle、format v3、assistant transient/durable stream 与读取 seam，保持标题、blank 判定、projection 和 session-links 行为
- [x] 4.4 适配 client session/layout/conversation、modelDirectories、settings、RPC 与 scoped injection seam，保留 guard blocks 共存、Memex ensure-before gate、provider icon 和 clock Host fence
- [x] 4.5 分别执行 dsh-memex、dsh-pet、home-network-model-guard、session-links、session-title-copy、sidebar-session-provider-icon、subscriptions-sandbox-shim、system-clock、worktree-session 的 build/typecheck/test，逐包记录 host/client 结论（Pet full suite was rerun with its generated client bundle; final source tree was cleaned afterward）
- [x] 4.6 运行根 peer 门禁、`npm test`、`npm run check:artifacts` 与 diff/artifact 检查；发现未审计破坏面时停止并回填 design/tasks 后再继续

## 5. Worktree Session generic attachment 迁移

- [x] 5.1 用目标 runtime 的公开接口重写首发 preflight/snapshot/handoff，冻结文本与官方 draft attachment identifiers，不再引用 `draftImages`、`imageIds`、`addImages` 或第二套上传协议
- [x] 5.2 只在 Worktree 准备成功后调用一次官方 submit，把 attempt/receipt Session 绑定、上传失败恢复、echo retirement 和成功后 commit/retire 留给官方 input/file-upload 生命周期
- [x] 5.3 扩展测试覆盖纯文本、纯图片、普通文件、混合载荷、附件失效、准备失败、上传失败从 byte 0 重试、取消、重复点击，以及 live/cold/wrong Session receipt 与跨 Session 复用拒绝
- [ ] 5.4 验证 resource address 不借当前 tab Session、cold Session 从 persistence header 定位且不激活 Agent，并在隔离 Web 实例确认同一源 Session、单个 worktree、单次提交及普通模式沿用官方行为

## 6. Pet 0.1.5 Host compatibility runtime

- [x] 6.1 对 `dsh-v0.1.5-rc.2` 重新制作能力矩阵，区分已上游能力与仍需 compatibility 的 silent settlement、idle/independent child、精确 child Session、isolated claim/turn 及 Storage 原子能力
- [x] 6.2 从目标 tag 重新推导 Subagent/Agent Loop 最窄 patches，更新 reviewed commit、patch hash、能力 marker、版本与可应用性测试，不复用旧 0.1.2 patch 身份
- [x] 6.3 针对目标 tag 重新推导并版本化 Storage/Domain/SQLite/JSON patches，更新 `replaces` provenance，验证 transaction 全有或全无、applyBatch、exclusive owner 与 JSON/SQLite 原子语义
- [x] 6.4 更新 launcher/root template/build fingerprint/override，确保 `supportedDshVersion` 精确匹配、官方一次性 CLI 不加载 overlay、未知版本在副作用前拒绝
- [x] 6.5 构建新 compatibility runtime，验证包名/版本/tag/commit/hash、`npm ls` 与 `require.resolve` 唯一实例、实际 runtime markers 和自包含原子发布
- [x] 6.6 执行 silent idle child、independent cold resume、saved preset/toolFilter、exact child Session、crash recovery、并发与双 writer；并覆盖首轮 Host 注入顺序、claim-before-bind 收敛、GUI/parent steer 污染 fail closed 和 agent own-layer subagent 逃逸负例
- [x] 6.7 明确 isolated queued-turn claim 当前未进入已装载 0.1.2 runtime：若本次选择启用则完成真实 marker/probe，否则保持 unavailable + marker 缺失 fail closed，不能误称为生产基线
- [x] 6.8 复跑 Pet 全量、固定 runtime probes 和现有 G1–G5 diagnostics；Pet 为生产切换硬 gate，silent/idle/independent cold resume+saved preset/exact Session/Storage 等当前可达能力任一退化即 NO-GO；仍不修改 inquiry 产品门槛或把未完成项标为通过

## 7. Remote 插件最小组合放行

- [ ] 7.1 在 Pet 关闭的隔离候选中加入 better-sidebar `0.19.1` 与 width-tiers `1.0.5`，验证 sidebar-right/resources tab、单实例/node-pty、rightbar 宽度、Session 切换、unload/abort/reload，再加入 local session-links
- [ ] 7.2 升级 cost-meter `1.7.30`，验证启动、费用展示、凭据迁移/不可回显、允许主机和 DSH runtime 包无双实例
- [ ] 7.3 以 subscriptions `0.9.2` peer-only compatibility fork 加入正常 fresh profile，证明 18 条 auth route 唯一、Host/Origin fence、codex/claude/grok/copilot/antigravity 登录与凭据保留、目录、stream/tools/image/video/x_search、proxy 和 sandbox shim；不得把尚未完成的 Host smoke 写成已通过
- [ ] 7.4 升级 skin-center/session-archive 到 `0.3.24`，验证 Node 约束、主题/壁纸与旧 Session 的归档、预览、恢复、物理删除及迁移后一致性
- [ ] 7.5 验证 open-in-vscode/sidebar-qa/setting-restart 已从组合中彻底移除，better-sidebar/session-links 不受 sidebar-qa 移除影响；archify-dsh 保持唯一 Skill provider 且功能可用
- [ ] 7.6 评估 cockpit-bridge `0.4.0`，验证 selection/pending snapshot 与 editorOpen seam；保持 opencode-header 当前版并复验 OpenCode 请求头和非目标域负例
- [ ] 7.7 将 Trae 升级候选 `0.1.15` 加入启用环境的隔离组合，验证设置登录、模型目录、stream/图片、队列计时、web_search、默认模型覆盖与 0.1.5 proxy；未启用环境仍不得安装内部包
- [x] 7.8 把每组最终 pin/启用状态、安全审查与回滚说明写回 `dsh.yaml` note，remote/fork 条目保持精确、可复现身份

## 8. 最终隔离组合与安全验收

- [x] 8.1 在完整隔离组合执行 sync/build 连续两次，确认第二次无变化、dump-config 可用、启动清单每项恰好一次且 loader 全部可执行
- [x] 8.2 复跑根与 9 包自动化、真实旧 Session 迁移/重启、Worktree 文本/图片/文件首发、全部 local/remote 用户可见基线并与 0.1.2 记录逐项比对（见 `checking/final-regression-baseline-compare.md`。**根自动化**:0.1.2 `127 pass / 1 skip` → 当前 **`132 pass / 0 fail / 0 skip`**，差额 `+3` 覆盖式接线测试 + `+1` 入口守卫测试 + `+1` 原本条件 skip 的那一例转为真实断言。**9 包**:9/9 全绿，且 **0.1.2 时的每一处失败都已消失** —— `dsh-pet` typecheck 失败与 4 套件 6 例失败（旧依赖树缺 `layout/client`、`workspace-controller/client`、`storage-sqlite` 与 DSW token 声明）→ 现 **2 687 pass / 0 fail / 43 skip**；`worktree-session` build/typecheck 失败（解析不到 `dsh-user-questions`）→ 现 build/typecheck 通过、**206 pass**；其余各包用例数**相等或增加**（memex 174、guard 70、session-links 54、title-copy 20、provider-icon 25、clock 21、shim 26）⇒ **无一项退化**。**Node 版本影响结论**:`@touchskyer` memex kernel 只全局装在 Node 24 下，用 v22 跑 `dsh-memex` 会 ENOENT 失败，那是**环境缺口不是回归**；上表统一用与本机 DSH 一致的 v24.20.0 采集；`subscriptions-sandbox-shim` 无 `build`/`typecheck` 脚本（`Missing script`）属实而非跳过。**Session 迁移/重启**与 **Worktree 文本首发**均通过（见各自证据文件）；**Worktree 图片/文件/混合载荷**四项全部通过（`worktree-attachment-paths.md`，含 PNG-only 字节落官方存储、混合载荷 `1 轮 3 步`、普通模式 worktrees 4→4、resource address 不借当前 tab 且 cold Session 可解析）。**⚠ 唯一未达成的子项**:「全部 local/remote 用户可见基线**并与 0.1.2 记录逐项比对**」——0.1.2 侧的 GUI 值**从未被测量**（`old-runtime-blackbox.md` 是一份**待跑场景清单**、`baseline-0-1-2.md` 自述只含根检查与 9 包、不含 GUI），故**数值级逐项比对不可构造**；实际做法是固定 0.1.5 侧实测值使其**成为**今后的可比基线，并**如实记录这一基线设计缺口**，未把结果写成「升级前后一致」）
- [x] 8.3 验证 RPC Host fence 与 Web 文件授权：非 trusted Host 拒绝；receipt 精确绑定 Session、cold/wrong Session、resource authorizing Session、跨 Session 复用拒绝；workspace-files read 按 composed fs policy 而非误设普适 workspace containment（见 `checking/web-file-authorization.md`。**Host fence 四格实测**：合法回环 + 凭据 → 200；合法回环无凭据 → 401；伪造 Host 两格**均 403**（与是否带凭据无关）⇒ **fence 先判、认证后判**，"Host 被拒"与"未认证"由此可判别。另测 `127.0.0.1.nip.io`→403(DNS-rebind)、`sec-fetch-site: cross-site`→403、跨源 `Origin`→403、无 Host 头→403。**Session 解析**：正向(活会话)200；**cold Session 解析成功**（经 persistence header，与 5.4/design 口径一致——任务原文的 cold 项本就是"支持"而非"拒绝"）；同一相对路径在三个身份下解析出**三个不同绝对路径** ⇒ 根只由线上 SessionId 决定，不借当前 tab；**不存在的 Session 被拒** `gateway/lookup-not-found`。**fs policy**：6 条 workspace 外**读**全部放行、而同一 workspace 外的 `list` 被拒 `workspace-file/outside-workspace` ⇒ 两个策略面方向相反，无法由朴素 containment 解释（`/etc/shadow` 的 EACCES 是 OS 权限而非 DSH 策略）。**两处诚实边界**：① 真正的 "receipt" 属 `dsh-client-file-upload`（`stagedFiles` WeakMap 以接收 Agent 的 Session 对象为键），**正向铸造 receipt 需把字节写入真实 Session 附件存储（会 resume Agent），超出只读探测约束，故跨 Session 复用拒绝只有代码证据 + 无写入负例**（`resolve()` 对外来 receipt 返回 undefined、`bindPrompt` 抛 `session/attachment-invalid`/`FILE_NOT_STAGED`）,该路径另有 5.3 单测覆盖；② 本部署未声明 workspace 外的额外根，故未能把"策略允许"与"OS 允许"两种原因分离，workspace 外可读只能归因到 `ctx.fs` 读权限，**该条不算完全通过**）
- [x] 8.4 验证 0.1.5 outbound proxy：Geo/subscriptions/cost-meter/web_fetch/search/MCP/Pet-lark 各执行面，回环 RPC 直连、项目 `.env` 不注入、候选不读生产 `$DSH_HOME/.env`，child/workflow/code-runtime 继承差异有明确结果且报告不含代理凭据（见 `checking/outbound-proxy-surfaces.md`。**Host 进程代理变量数 = 0**（`no_proxy` 也不存在），登录 shell 同为 0——即"构建期代理不得被长驻 Host 继承"这条约束**当前成立**。历史坑成因已定位:代理是 `~/.zshrc:113` 的手动 alias，而**孤儿 lark-cli pid 2300412(01:39:29 那次启动)仍带着完整代理串**、当前 Host 是 01:58:43 那次不带 ⇒ 同机两次启动代理状态不同。**回环直连 = 是**:把 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 全指向不可达 `127.0.0.1:9` 后 Node fetch 到 `127.0.0.1:3080` 仍到达（同一环境下 curl 连不上 ⇒ 毒药有效、探针不空转）；源码 `if (isLoopbackHost(url.hostname)) return void 0` 覆盖整个 `127.0.0.0/8`。**七执行面**:唯一"DSH 出自己的站代理配置"的面是 subscriptions（`~/.dsh/plugins/subscriptions/proxy.json`，实测**不存在**⇒回落全局 fetch）；Geo 有**运行证据**（guard status 返回 `source:"primary"`、`degraded:false`，主端点真实 HTTPS 取值成功）；其余为**代码证据**并已逐条标注；**MCP 在本 profile 未挂载（dump 0 命中），无运行证据**。**三个"明确结果"**：① 项目 `.env` 不注入 —— 代理名键(`HTTP_PROXY`)与 `DSH_HOME` 均 **REFUSED(fail-closed)**、校验发生在任一文件应用**之前**（混入代理名会让整个启动失败），但**普通名 `FOO=bar` 会被 ACCEPTED**，故不可简化成一句"项目 .env 不生效"；② 候选不读生产 `.env` —— 读取路径由 `resolveDshHome()` 唯一决定，实测候选 home 下读的是自己的路径；运行时**不存在 "candidate home" 概念**，且 devbox 生产 `$DSH_HOME/.env` **不存在**，**正例无法构造**（如实记录）；③ **child/workflow/code-runtime 三者互不相同**:subprocess 缝 = `scrubbedParentEnv()`（扣密钥类与全部 `DSH_*`）**再叠加**解析后的代理策略；workflow worker thread = **完全不继承**(`workerSpawnEnv()` 返回 `{}`)；code-runtime worker thread = 同样 `env: {}`；**Pet-lark 子进程绕过整条缝、原样全量继承**（运行证据:pid 2309290 environ 22 项为 Host 全量副本、`DSH_*` 未被抹掉）⇒ "子进程是否继承代理"**没有单一答案**。**凭据自检本身就是验收项**：两文件 grep `user:password@` 零命中，无 token/cookie/Authorization，唯一代理串不带 userinfo。**诚实边界**:本机无可用代理，**七个面在有代理时的正向行为全部未验证**，需一次 `set_sh_devbox_proxy` 后启动的专门验收补齐）
- [x] 8.5 在新 compatibility runtime 上验证 Pet 普通轮盘、Locus 既有 fork/independent 基线、SQLite 单 writer、真实飞书入口与官方媒体下载；新 inquiry G1–G5 未通过时仍保持未发布
- [x] 8.6 验证失败回滚：插件组失败只撤该组，runtime 候选失败回到旧 manifest/runtime，数据已写新格式时先停 writer并恢复备份（见 `checking/plugin-group-failure-rollback.md`。插件组失败为本次新增实测：坏 pin 下 `dsh build` `exit=1` + `ERR_PNPM_NO_MATCHING_VERSION` + `finished with 1 failure(s)`，失败组的依赖表 / `node_modules` / bundle 组合三层均停在原值，撤销后一次 build 即 `no changes` 收敛；附带发现 sync 的漂移判定读 `version:` 而非 `spec:` 字面量，只改 `spec` 是静默 no-op）
- [x] 8.7 运行 `openspec validate upgrade-dsh-0-1-5-runtime --strict`、根全量测试、artifact check 与 `git diff --check`，记录最终候选证据

## 9. devbox 主干清洁构建与场景验收

- [x] 9.1 将候选提交为 clean Git commit；以高熵 run id 推送唯一验收 ref 到 expected SHA，devbox 仅 fetch 该 ref 并记录 expected/fetched/HEAD 三个 SHA，全部相等且 checkout clean 才继续
- [x] 9.2 以公钥免密、`BatchMode=yes` 和已确认 host key 连接 devbox；在单个 `set -euo pipefail`、`umask 077` login shell 中先 `type set_sh_devbox_proxy`、再调用并检查 rc；函数缺失、失败或 shell 结束即 fail closed且不输出代理值
- [x] 9.3 在同一 shell/子进程内完成 git/npm/pnpm/corepack 网络操作；建立环境 allowlist，拒绝直接 source checkout `.env.local`，unset `DSH_BIN/DSH_OPEN_APP/DSH_UPDATE_CHANNEL`，设置 `DSH_SKIP_UPDATE=1` 并把 HOME/DSH_HOME/npm/XDG/Corepack/pnpm store 全部指向 run root；Trae 按该 devbox 已证明的本地启用意图显式设为 1 或 0，不复制秘密值
- [x] 9.4 detached checkout 精确 SHA，断言无 node_modules、packages/*/lib 等 ignored 产物；禁止共享/symlink依赖，记录 Node/npm、lock hash并执行 fresh `npm ci`
- [x] 9.5 在独立 profile 写最小 `.npmrc`（公开 npmjs，内部 scope 默认关闭）；用独立端口、PID/PGID/start token/cwd/home/SHA fingerprint 写 ownership ledger，再执行根测试、9 包构建、artifact、sync/build×2、CLI/Host/loader/RPC/HTTP
- [x] 9.6 数据迁移使用 owner-only 的脱敏真实副本或结构等价 fixture并记录差异/hash/oracle；Worktree 使用 `$RUN_ROOT/fixtures/repo` disposable Git 仓库，不得拿候选 checkout 当被测仓库（见 `checking/gate-hygiene-9-6-9-7.md`。迁移素材为升级前 `$DSH_HOME` 真实副本 `src-head=986b9324…`，oracle/差异已记；Worktree fixture 实测为独立 disposable 仓库 `/tmp/wt-fixture/repo` HEAD `8463e19`，非候选 checkout。**并查出一处真实缺陷**:升级前备份曾**全局可读**——目录 `755`、`dsh-home.tgz`/`ohmydsh-src.tgz`/`src-head.txt` 均 `644`，而源 `$DSH_HOME` 与 `sessions` 都是 `700`，即备份**放宽**了权限；在共享机器上等于把 session 与凭据面摊给所有本地用户。已 `chmod 700/600` 修复并复验完整性(tar 18 214 / 33 355 条目)，且已把 `umask 077`/chmod 写回 host/lumevm apply 序列。注意多帧 zstd 读数陷阱:朴素解码器会把任意会话误报成「1 行」，行数对比须用多帧解码才作数）
- [x] 9.7 GUI 需要时才以严格 OpenSSH 参数建立 loopback tunnel，本地端口不得 3080；HTTP/DSH probe 才算 ready，浏览器使用临时独立 profile；前后记录本地 3080 Host PID/start/健康不变（见 `checking/gate-hygiene-9-6-9-7.md`。**前置条件未触发**:GUI 验收在 devbox 本机用其缓存 Chromium 直连 devbox 侧真实 origin `127.0.0.1:3080` 完成，**未建立任何 SSH tunnel**，故不存在"本地转发端口"这一面，也就无从与 3080 冲突；随之省掉 tunnel ready 判定。浏览器始终用临时独立 profile(`--user-data-dir=/tmp/cdp-*`)。本机(=host) 3080 前后一致实测:PID `84619`、启动时间 `2026-09-20 15:45:12`、`127.0.0.1:3080 LISTEN`、健康 `HTTP 401`(未带凭据，符合 fence)、部署 runtime 仍 `0.1.2-rc.1`(尚未 apply)。**诚实边界**:这是本次 worktree 工作期间的前后一致(时间戳未变可佐证未被重启)，不是"自 launch 至今从未重启"的完整证明。经 tunnel 访问的备用路径**未验证**，不可写成可用）
- [x] 9.8 生成轻量报告，记录工具链、lock hash、三个 SHA、脱敏命令/cwd/exit/duration、runtime fingerprint、端口、场景判据和环境差异，不提交 raw 数据、密钥、环境 dump 或批量截图
- [x] 9.9 按浏览器→tunnel→远端 Host/子进程→Worktree fixture→checkout/home/cache→创建侧 compare-and-delete ref 清理；逐项记录 done/not-owned/preserved，身份或 ref 漂移则保留报告，任一清理失败不得完成本 gate

## 10. 收尾与用户手动部署交接

- [ ] 10.1 重新同步 `origin/main` 与上游 dist-tags，处理并行 Pet inquiry 变更漂移；最终候选 SHA 变化默认重跑完整 devbox gate，只有纯文档 diff 且有明确证明时才可豁免
- [ ] 10.2 在用户明确批准后按 Worktree Session 受控流程合入任务分支，不裸跑 merge 或强删 worktree
- [x] 10.3 输出 host/lumevm 手动部署清单：精确 commit/pins、profile-scoped registries、机器私有 env gate、停止 writer、Session/Pet/manifest/profile 备份、build/sync×2、重启、现有 GUI 验收及按数据写入状态回滚
- [x] 10.4 明确本 change 不远程操作 host/lumevm，也不把它们的部署状态写成已验收；用户手动完成后可另行补充机器级证据
- [ ] 10.5 更新 devbox 最终证据、current specs 与任务状态，另行请求归档 change