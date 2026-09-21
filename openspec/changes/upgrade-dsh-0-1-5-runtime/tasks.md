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

- [ ] 3.1 创建独立 `DSH_HOME` 和非生产端口，只部署官方 `0.1.5-rc.2` profile；验证 CLI/dump-config/Web，并覆盖 `--from-default-profile` 的 launcher 路由、fresh/existing custom profile、shipped profile 名、desktop 拒绝及 plugin add/remove/why
- [x] 3.2 在真实旧 Session 备份副本上触发官方 v0→v1→v2→v3 migrators，逐项比对内容并证明旧 generation 保留、新 generation 原子发布、lease 排他与中断后 generation 选择
- [x] 3.3 在迁移后的同一 Session 中继续提交、停止并重启 Host，确认恢复写入和重启结果一致且原始生产源未被候选打开或改写
- [ ] 3.4 注入损坏、不受支持格式、写所有权竞争与中断场景，确认候选 fail closed 且备份可恢复
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
- [ ] 8.2 复跑根与 9 包自动化、真实旧 Session 迁移/重启、Worktree 文本/图片/文件首发、全部 local/remote 用户可见基线并与 0.1.2 记录逐项比对
- [ ] 8.3 验证 RPC Host fence 与 Web 文件授权：非 trusted Host 拒绝；receipt 精确绑定 Session、cold/wrong Session、resource authorizing Session、跨 Session 复用拒绝；workspace-files read 按 composed fs policy 而非误设普适 workspace containment
- [ ] 8.4 验证 0.1.5 outbound proxy：Geo/subscriptions/cost-meter/web_fetch/search/MCP/Pet-lark 各执行面，回环 RPC 直连、项目 `.env` 不注入、候选不读生产 `$DSH_HOME/.env`，child/workflow/code-runtime 继承差异有明确结果且报告不含代理凭据
- [x] 8.5 在新 compatibility runtime 上验证 Pet 普通轮盘、Locus 既有 fork/independent 基线、SQLite 单 writer、真实飞书入口与官方媒体下载；新 inquiry G1–G5 未通过时仍保持未发布
- [x] 8.6 验证失败回滚：插件组失败只撤该组，runtime 候选失败回到旧 manifest/runtime，数据已写新格式时先停 writer并恢复备份（见 `checking/plugin-group-failure-rollback.md`。插件组失败为本次新增实测：坏 pin 下 `dsh build` `exit=1` + `ERR_PNPM_NO_MATCHING_VERSION` + `finished with 1 failure(s)`，失败组的依赖表 / `node_modules` / bundle 组合三层均停在原值，撤销后一次 build 即 `no changes` 收敛；附带发现 sync 的漂移判定读 `version:` 而非 `spec:` 字面量，只改 `spec` 是静默 no-op）
- [x] 8.7 运行 `openspec validate upgrade-dsh-0-1-5-runtime --strict`、根全量测试、artifact check 与 `git diff --check`，记录最终候选证据

## 9. devbox 主干清洁构建与场景验收

- [x] 9.1 将候选提交为 clean Git commit；以高熵 run id 推送唯一验收 ref 到 expected SHA，devbox 仅 fetch 该 ref 并记录 expected/fetched/HEAD 三个 SHA，全部相等且 checkout clean 才继续
- [x] 9.2 以公钥免密、`BatchMode=yes` 和已确认 host key 连接 devbox；在单个 `set -euo pipefail`、`umask 077` login shell 中先 `type set_sh_devbox_proxy`、再调用并检查 rc；函数缺失、失败或 shell 结束即 fail closed且不输出代理值
- [x] 9.3 在同一 shell/子进程内完成 git/npm/pnpm/corepack 网络操作；建立环境 allowlist，拒绝直接 source checkout `.env.local`，unset `DSH_BIN/DSH_OPEN_APP/DSH_UPDATE_CHANNEL`，设置 `DSH_SKIP_UPDATE=1` 并把 HOME/DSH_HOME/npm/XDG/Corepack/pnpm store 全部指向 run root；Trae 按该 devbox 已证明的本地启用意图显式设为 1 或 0，不复制秘密值
- [x] 9.4 detached checkout 精确 SHA，断言无 node_modules、packages/*/lib 等 ignored 产物；禁止共享/symlink依赖，记录 Node/npm、lock hash并执行 fresh `npm ci`
- [x] 9.5 在独立 profile 写最小 `.npmrc`（公开 npmjs，内部 scope 默认关闭）；用独立端口、PID/PGID/start token/cwd/home/SHA fingerprint 写 ownership ledger，再执行根测试、9 包构建、artifact、sync/build×2、CLI/Host/loader/RPC/HTTP
- [ ] 9.6 数据迁移使用 owner-only 的脱敏真实副本或结构等价 fixture并记录差异/hash/oracle；Worktree 使用 `$RUN_ROOT/fixtures/repo` disposable Git 仓库，不得拿候选 checkout 当被测仓库
- [ ] 9.7 GUI 需要时才以严格 OpenSSH 参数建立 loopback tunnel，本地端口不得 3080；HTTP/DSH probe 才算 ready，浏览器使用临时独立 profile；前后记录本地 3080 Host PID/start/健康不变
- [x] 9.8 生成轻量报告，记录工具链、lock hash、三个 SHA、脱敏命令/cwd/exit/duration、runtime fingerprint、端口、场景判据和环境差异，不提交 raw 数据、密钥、环境 dump 或批量截图
- [x] 9.9 按浏览器→tunnel→远端 Host/子进程→Worktree fixture→checkout/home/cache→创建侧 compare-and-delete ref 清理；逐项记录 done/not-owned/preserved，身份或 ref 漂移则保留报告，任一清理失败不得完成本 gate

## 10. 收尾与用户手动部署交接

- [ ] 10.1 重新同步 `origin/main` 与上游 dist-tags，处理并行 Pet inquiry 变更漂移；最终候选 SHA 变化默认重跑完整 devbox gate，只有纯文档 diff 且有明确证明时才可豁免
- [ ] 10.2 在用户明确批准后按 Worktree Session 受控流程合入任务分支，不裸跑 merge 或强删 worktree
- [x] 10.3 输出 host/lumevm 手动部署清单：精确 commit/pins、profile-scoped registries、机器私有 env gate、停止 writer、Session/Pet/manifest/profile 备份、build/sync×2、重启、现有 GUI 验收及按数据写入状态回滚
- [x] 10.4 明确本 change 不远程操作 host/lumevm，也不把它们的部署状态写成已验收；用户手动完成后可另行补充机器级证据
- [ ] 10.5 更新 devbox 最终证据、current specs 与任务状态，另行请求归档 change