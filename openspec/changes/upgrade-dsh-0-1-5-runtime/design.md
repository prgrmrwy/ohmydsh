## Context

见 `proposal.md`。同步远端后，registry `latest`/`next` 仍为 `0.1.5-rc.2`，`alpha` 为 `0.1.6-alpha.2`；上游没有更新的稳定频道目标。当前分支已 fast-forward 到 `origin/main` 的 Pet 官方媒体下载变更，该变更移除了独立 lark-cli compatibility 构建，对本次 DSH runtime 迁移没有新增宿主阻塞。

当前仓库的约束不是单一版本号：

- `dsh.yaml` 精确 pin `0.1.2-rc.1`，`autoUpdate` 关闭；9 个 local package 的 runtime dependency/devDependency/peerDependency 同属 0.1.2 族。
- Pet 长期 Host 通过 `hostRuntimeCompatibility` 选择一个审查过的隔离 runtime；Subagent/Agent Loop 与四个 Storage 包的源码、patch、commit、hash、版本和能力 marker 都绑定 0.1.2。
- 目标上游包含 Session persistence handle seam、格式 v0→v3、Agent ownership、assistant stream、generic attachment/file upload、右侧 Sidebar 与文件交付等跨模块变化。
- `worktree-session` 当前直接使用图片草稿 seam；0.1.5 已改为 generic attachments，这是已确认的源码适配点。
- 正在进行的 `pet-locus-independent-agent-inquiries` 已定义 G1–G5 产品门槛，但尚未验收。本变更不能改变或假称完成这些产品语义，只能迁移其所依赖的 runtime seam。

## Goals / Non-Goals

**Goals:**

- 形成一个可审查、可分阶段回滚、最终可生产部署的 `0.1.5-rc.2` 候选组合。
- 保持现有 local package 用户语义、安全边界和数据，不以删功能换取编译通过。
- 针对目标 tag 重建并证明 Pet compatibility runtime，而不是复用旧产物。
- 用真实旧 Session、真实 Web loader 和用户可见功能证明兼容。
- 把第三方插件分为可前置升级、运行体原子批和隔离放行闸，缩小失败归因面。

**Non-Goals:**

- 不追踪 `0.1.6-alpha`，不恢复自动更新。
- 不在本变更中重新设计 Pet inquiry 的圈范围、权限、完成语义或 G1–G5 标准。
- 不顺便重做 local package 架构或新增 DSH 0.1.5 的产品功能。
- 不手工迁移 Session 文件格式，不修改部署目录或 npm 缓存作为持久方案。
- 不将所有第三方插件无条件升级到最新；只有兼容、安全审查或原子批需要时才改 pin。

## Decisions

### D1. 固定目标为 `0.1.5-rc.2`，不使用 dist-tag 漂移

实施时将精确 pin 写入 manifest；`latest` 仅用于提案前确认候选，没有运行时解析权。`autoUpdate` 继续关闭。

替代方案是启用 `latest` 自动升级，但 Pet compatibility 与 local peers 的版本闸会有意阻止未知版本，且自动改写不能安全完成源码适配，因此拒绝。

### D2. 先固定 0.1.2 基线，再用四层隔离组合定位失败

基线沿用既有升级规范并更新到当前仓库：根测试/artifacts、9 包 build/typecheck/test、sync 两次、启动清单、loader 可执行及人工功能。目标候选在独立 `DSH_HOME` 和备用端口按以下顺序组合：

1. 裸官方 0.1.5：profile、CLI、Web、真实旧 Session v0→v3；
2. 9 个 local package，但先关闭 Pet：定位通用 host/client 与 Worktree attachment 迁移；
3. remote 插件最小组：每次只加入一个依赖簇；
4. 新 Pet compatibility runtime：最后加入最复杂的 Host 替换并跑能力矩阵。

替代方案是一次性完整组合，失败时无法区分 runtime、local、remote、数据迁移或 Pet overlay，拒绝。

### D3. local runtime 声明与代码适配作为一个原子批

先在分支内把所有受管 `@deepseek-ai/dsh-*` 声明迁到 `^0.1.5-rc.2`，随后逐包修 API 并真实构建；门禁在批次中间失败是预期状态，不放宽或跳过。审计重点包括：

- AgentSetup 新签名与 parent runtime ownership；
- Session persistence/format/assistant stream；
- client session/layout/conversation attachment；
- RPC Host fence、sandbox、workspace 与 scoped injection 时序。

声明和适配最终同一提交集合完成。替代方案是先只改 `dshVersion` 或 peers，都会产生不可运行中间态，拒绝。

### D4. Worktree 首发改为不可分割的 generic attachment handoff

handoff 在用户点击时冻结文本与官方 draft attachment identifiers，预检其仍可用；Worktree 准备完成后只调用目标 runtime 的官方 submit 一次。`SubmitAttempt.seq`、receipt/Session 绑定、上传失败恢复、echo retirement 和成功后 commit/retire 均属于官方 input/file-upload 生命周期，插件不得复制这些状态或创建跨重试 operation/upload 协议。普通模式完全不经过 Worktree handoff。

测试至少覆盖纯文本、纯图片、普通文件、混合载荷、准备失败、上传失败从 byte 0 重试、取消、重复点击、live/cold/wrong Session receipt 绑定与跨 Session 复用拒绝。还要验证 resource address 使用其 authorizing Session 而非当前 tab；cold Session 能从 persistence header 定位而不激活 Agent；成功 delivery 后才退休 attachment。不得把附件内容复制进插件自有永久存储；插件只持有完成一次 handoff 所需的短期官方引用。

替代方案是继续访问旧 `draftImages/imageIds/addImages`、逐附件自行上传或自建确认账本，前者在目标 API 不存在，后两者会绕开官方生命周期并制造重复，均拒绝。

### D5. Pet compatibility 以目标 tag 重新推导，不机械 port

先制作 upstream capability matrix。0.1.5 已有的 durable `toolFilter` 等能力直接采用官方实现；仍缺的能力才进入最窄补丁。Subagent patch 从目标源码重新推导，因为旧 patch 已确认无法 apply；Storage patch即使可文本 apply，也重新固定目标 commit/hash/version并复跑事务、崩溃与双 writer 实验。

新 launcher 必须验证：

- 官方 root 与所有 override 包身份、版本、commit、patch hash；
- 依赖树和 `require.resolve` 无双实例；
- silent settlement、idle independent child、saved preset/tool filter、精确 child Session、isolated claim/turn seam 的真实 marker；
- Storage transaction 的全有或全无、SQLite exclusive owner、crash recovery；
- compatibility version 与 manifest 精确相等，未知版本拒绝。

`pet-locus-independent-agent-inquiries` 的 desired-behavior probes 可作为共享证据，但只有该 change 自己才能宣布 G1–G5 完成；本变更只要求升级前已有能力在新 runtime 等价。

替代方案包括删除 overlay、继续旧 launcher、只换 tag/hash，都会导致能力缺失或 provenance 虚假，拒绝。

### D6. 第三方插件按兼容责任分组

- **前置独立升级候选**：不依赖目标 runtime 且可在 0.1.2 验收的安全/依赖治理升级。
- **运行体原子批**：现 pin 明确不接受目标 prerelease 或目标 API，且已有兼容 pin，例如 better-sidebar `0.19.1`。
- **隔离放行闸**：没有声明兼容版本或 stale inject 的插件。分别检查 manifest graph、bundle import/require、实际 UI/Host 功能；失败则升级、做审查过的最小 patch，或在原子批显式禁用。

发布物审计形成如下候选：cost-meter `1.7.30`、width-tiers `1.0.5`、better-sidebar `0.19.1`、skin-center/session-archive `0.3.24`、cockpit-bridge `0.4.0`；opencode-session-header `0.1.0` 保持并复验。用户明确移除 sidebar-qa、open-in-vscode、setting-restart；better-sidebar 仍由 local session-links 使用，不随 sidebar-qa 移除。archify-dsh remote package 是当前唯一 Archify Skill 来源；用户确认保留。它只通过 filesystem provider 暴露包内完整 Skill，无 Host/Web/网络能力，本轮只验证 0.1.5 下 Skill catalog 唯一和生成/校验/导出可用。

subscriptions 是必保能力。精确目标包树审计确认 `0.9.2` 发布物已经包含 0.1.5 exact `/api` Fetch routes 与 command description resolver，运行源码/API 无需修改；最小 production patch 只给 attachment/home-paths/llm/tools 四个 peer 追加 `|| ^0.1.5-rc.2`。为了 fork CI 可复现，另更新 devDependencies 到 0.1.5、显式加入 dsh-agent augmentation 与缺失测试依赖，但不改 client inject、cordis patch 或 runtime 源码。该 fork/tarball 必须固定 tag commit、tgz/hash 与 patch provenance，并在正常 profile 完成尚未获得的 Host smoke；不允许以禁用 subscriptions 作为生产放行路径。

Trae 保留 repo 默认 `enabled:false + enabledEnv` 的可分享语义，升级候选为 `0.1.15`；其 peer 明确覆盖 0.1.5，且含 rc.2 RPC 405、工具轮、空内部消息和图片尺寸适配。本 change 只在 devbox 完成完整验收：先证明该机本地启用意图，再在 fresh allowlisted 环境显式设置 `DSH_TRAEX_BRIDGE=1`，不得 source 生产 `.env.local`；同时验证反向 gate，unset/0 时内部包和三条 patch 均不存在。host 与 lumevm 不进入自动验收或生产操作范围，用户在 devbox gate 通过后自行按相同精确 pin、profile registry、env gate 和备份/回滚步骤部署。

### D7. 0.1.5 Web 文件面和 outbound proxy 作为独立安全迁移面

0.1.5 Web shell 新增 file-upload、resources、workspace-files、files sidebar/document preview 与 open-in-app。验收不能只看右侧栏布局：receipt 必须精确绑定 authorizing Session，cold Session 走 persistence header，wrong/current-tab Session 不得借权；取消/失败恢复、跨 Session 复用拒绝、成功 delivery 后才 retire 都需验证。`workspace-files` 的 read/readBytes/readAll/readRelated 不承诺 workspace containment，只按 composed fs read policy 授权，只有 list/changes 限 workspace，因此安全 oracle 必须分别验证 sandbox/read policy 和 workspace 外文件的预期结果，不能把 `workspaceRoot` 当成普适边界。better-sidebar/官方 sidebar-right 还要覆盖 resources tab、Session 切换、unload/abort 与 reload 后 memory-only 状态。

目标运行体还新增进程级 outbound HTTP proxy。应记录旧版网络基线并隔离验证 Geo、subscriptions、cost-meter、web_fetch/search、MCP、Pet/lark 子进程；回环 RPC 必须直连，项目 `.env` 不得注入 Host 代理，生产 `$DSH_HOME/.env` 不得被候选误读，代理 URL/凭据不得进入报告。Node child process、workflow/code runtime 对代理继承能力不同，必须按真实执行面逐一判定，不能只依赖 devbox shell 的 `set_sh_devbox_proxy`。

### D8. Session 与 Pet 数据先备份，迁移只交给各自官方/受控路径

在目标首次写生产介质前：停止或隔离 writer，创建 Session home 与 Pet SQLite 的一致性备份并校验；记录旧 manifest、runtime、profile 与恢复命令。Session 格式只由 DSH 0.1.5 官方相邻 format migrators 与 JSONL generation publication 处理；“冷读”只针对备份副本，首次 open 可能发布新 generation。验收必须证明旧 generation 保留、新 generation 原子发布、lease 排他及中断后的 generation 选择规则；Pet 数据继续使用显式离线迁移/备份规则。回滚时先停新 writer，再恢复数据备份和旧代码，绝不让 0.1.2 读取已被 0.1.5 写过且未恢复的介质。

### D9. devbox 承担主干清洁构建与场景验收，本地 `ws/dsh` 保持开发隔离

本地当前 Session 位于托管 `ws/dsh` worktree，主要职责是保存规划与实现工作，不作为长时间、重依赖或会改写 DSH home 的验收宿主。实现形成可复核 commit 后，devbox 通过 Git 获取**精确候选 commit**并在独立 checkout 验收；不得用 rsync/scp 未提交工作树、共享 `node_modules`、本地构建产物或本地 `DSH_HOME` 代替 Git 边界。

SSH 登录 devbox 后必须进入**同一个受控 login shell**：先用 `type set_sh_devbox_proxy` 确认函数存在，再调用并检查退出码；之后所有 `git fetch/clone`、npm/pnpm/corepack、registry 或 GitHub 网络操作都必须在该 shell 或其子进程内完成，因为函数导出的代理不会跨独立 SSH 连接保留。函数缺失、调用失败、shell 提前结束或代理无法确认生效时，远端验收 fail closed；不得因网络失败转而在本地生产 home 上跑候选构建。历史上 devbox 的 GitHub IPv4/IPv6 均有间歇性问题，因此以实际 git/package-manager 操作为准，不用单次 curl 推断可达性。

远端流程采用临时、可识别的验收根：

1. 以公钥免密、`BatchMode=yes`、已人工确认的 host key 连接；SSH alias 和参数使用 option boundary，不拼 shell 注入内容；
2. 调用 `set_sh_devbox_proxy`；记录代理准备成功，但不把代理值、凭据或环境完整输出写入证据；
3. fetch 主干仓库并 checkout 候选 commit 到新的 detached checkout/worktree，验证 `HEAD` 等于预期 SHA、工作区干净；若候选尚未进入远端主干，可推送显式临时验收 ref，验收完删除，不得把未提交本地目录复制过去；
4. 使用 fresh install 与独立 `DSH_HOME`、独立端口和独立缓存/构建目录运行构建、测试、sync×2、Host/Web 与场景矩阵；不读写 devbox 日常 DSH home。鉴于 profile `.npmrc` 不受 sync 管理且 devbox 用户级配置可能指向 bnpm，先在隔离 home 创建最小 profile registry 配置：默认公开包使用 `https://registry.npmjs.org/`，只有本轮明确启用且获准验证内部包时才为对应 scope 添加内部 registry；不得把内部 registry 设成全局默认；
5. 采集轻量报告：commit SHA、工具链版本、命令与退出码、测试摘要、启动清单、HTTP/场景判据、已知环境差异；不提交 raw session/history、密钥、完整环境或批量截图；
6. 无论成功失败都停止远端候选 Host/SSH tunnel，删除临时 checkout、`DSH_HOME` 和候选 ref；只清理本次路径/进程身份可证明的资源，身份不明则保留并报告。

场景分为两层：devbox 必须完成无桌面依赖的清洁构建、包测试、Session 数据副本迁移、Host 启动、loader/RPC/HTTP、Pet runtime/Storage、Worktree Host 语义；需要浏览器交互的场景可通过 SSH loopback tunnel 访问 devbox 候选端口完成，但仍使用远端隔离 `DSH_HOME`。涉及本机现有 GUI、真实本机 workspace、真实飞书入口和生产数据的最终验收只在 devbox gate 通过后进行。

替代方案是在本地 `ws/dsh` 直接承担全组合构建或把未提交树复制到 devbox；前者可能耗尽资源或污染当前会话，后者不可复现且绕过 Git 身份，因此均拒绝。

### D10. 本 change 以 devbox 完整验收和手动部署交接收尾

仓库变更、本地隔离测试、devbox 候选和备用 server 都不更新当前本地 GUI。本 change 的执行责任到 devbox 精确 SHA 完整 gate、受控合入和手动部署清单为止；不远程操作 host/lumevm，也不替用户重启或宣称这些机器已经验收。用户随后在各机器自行使用相同精确 commit/pins、profile-scoped registry、私有 env gate、数据备份、build/sync×2、重启与真实 GUI 验收步骤。若用户日后要求代为部署，应作为新的明确指令处理。

## Risks / Trade-offs

- **[上游 RC 仍快速演进]** → 精确固定 `0.1.5-rc.2`，实施期间再次检查 dist-tags；目标变化则停止并更新提案，而不自动追新。
- **[Pet patch 面随 Agent/Subagent 重构扩大]** → 先做 capability diff，只补缺口；每个 patch 都有 marker、源码测试和 launcher 级真实实例探针。
- **[Session migration 首次写入不可逆]** → 真实副本演练、写前一致性备份、禁止新旧 writer 共享介质。
- **[第三方插件无 0.1.5 声明]** → 分组组合，以实际 loader/功能为准；不通过则显式禁用，避免静默缺功能。
- **[better-sidebar 与官方 sidebar-right 重叠]** → 使用声明 0.1.5 的版本并单独验 tab/单实例/布局，再加入 local session-links；sidebar-qa 按用户决策移除。
- **[Worktree attachment 重试造成重复上传]** → 以官方 `SubmitAttempt.seq`、receipt/Session 绑定和失败恢复做黑盒验证，禁止插件自行维护 operation/upload 确认协议。
- **[并行 Pet inquiry change 漂移]** → 共享 runtime seam 与测试证据，但不修改其产品规范/任务状态；合入前 rebase 后重跑 G1–G5 diagnostics。
- **[升级工作量过大导致不可归因]** → 每个阶段有准入、退出、证据和独立回滚；发现未审计破坏点立即停并回填设计。
- **[devbox 网络经常间歇失败]** → 登录后先执行 `set_sh_devbox_proxy`，以实际 git/package-manager 命令验证；网络失败只重试远端阶段，不回落污染本地生产 home。
- **[远端临时资源或进程遗留]** → 每个验收对象写入唯一标识和预期路径，正常/失败都走 finally 清理；无法证明身份时不盲删，报告给操作者。
- **[候选 commit 与本地实现不一致]** → devbox 只验收显式 SHA，远端 checkout 必须 detached 且 clean；轻量报告记录 SHA 并在最终合入后复验漂移。
- **[代理设置泄漏环境信息]** → 只记录 `set_sh_devbox_proxy` 成功与网络操作结果，不打印代理变量、token 或完整远端环境。

## Migration Plan

1. 再次记录目标 dist-tags/tag commit，冻结当前 0.1.2 能力基线和人工缺口。
2. 在可独立验证时先完成 remote 前置升级；每项单独物化、验收、回滚。
3. 创建本地隔离 `DSH_HOME`：验证裸 0.1.5 与真实旧 Session 副本迁移，不触碰现有 GUI/生产 home。
4. 原子迁移 local runtime 声明与 9 包 API；完成 Worktree generic attachment handoff，Pet 暂关验证通用组合。
5. 按最小分组加入 remote plugins，确定升级/保留/禁用决策并记录证据。
6. 重新推导、构建并验证 Pet compatibility runtime；跑既有 Pet 全量与目标 runtime probes，不把 inquiry G1–G5 未完成项误报为完成。
7. 将候选实现形成可复核 commit；SSH 登录 devbox 后先调用 `set_sh_devbox_proxy`，再通过 Git 在远端独立 checkout 获取精确 SHA，使用 fresh install、隔离 `DSH_HOME` 与独立端口执行主干清洁构建和场景矩阵。
8. 清理 devbox 候选进程、checkout、home 与临时 ref，保留轻量验收报告；对失败只重跑远端阶段，不把负载转移到本地生产环境。
9. 本地与 devbox gate 都通过后，对生产数据做一致性备份；获得确认后合入、正式 build/sync、重启并刷新现有 GUI 验收。
10. 若正式验收失败：停止新 writer，按失败阶段恢复 manifest/runtime；涉及新格式写入时先恢复数据备份，再恢复 0.1.2 服务。

## Open Questions

无。插件最终是保留、升级还是禁用由已定义的隔离放行结果决定，不改变规范或任务结构。