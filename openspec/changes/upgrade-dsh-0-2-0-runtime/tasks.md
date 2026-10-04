## 0. 冻结目标与基线

- [ ] 0.1 查询 `@deepseek-ai/dsh` dist-tags，确认目标仍为 `0.2.0-rc.2`，记录 tag commit；出现更新的 rc 时停下，回到 proposal 重新冻结目标
- [x] 0.2 在当前 0.1.5 上执行并记录 `npm test`、`npm run check:artifacts`、11 个 local package 的 build/typecheck/test 结果（含已知跳过项），作为后续每波的比对基线
- [ ] 0.3 记录生产启动清单、loader 行数，以及 memex 各工作区的路由、主入口和开关结果（逐工作区快照），供 W4 迁移比对

## 1. W1 前置清理（0.1.5 上线，约 1h）

- [x] 1.1 在私有 overlay `dsh.yaml` 中把 traex-bridge 设为 `enabled: false`，note 写明「用户不再使用，0.2.0 无兼容版」
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
- [ ] 3.3 `dshVersion`→`0.2.0-rc.2`，同批完成：skill-filesystem、mcp-client provider 的 pin 与 integrity；`scripts/jev-readiness.mjs` 和 tests 中写死的 0.1.5；11 个 local package 的 peer 改到 0.2.0 版本族；`dsh-settings-file` 等已删除包按接口迁移处理，不改成同名新版
- [ ] 3.4 subscriptions-sandbox-shim：先写 `role:'tool'` 工具结果的失败测试，再让配对识别同时支持两种表示
- [ ] 3.5 session-links：`content[0]?.isError` 改为 `message.isError`，补测试
- [ ] 3.6 worktree-session：适配运行中归档抛 `WorkspaceActiveSessionError` 的清理路径；handoff 对 `input.submit` 透传新增的 `source` 参数；测试覆盖 Enter 与点击两种提交方式
- [ ] 3.7 第三方插件：better-sidebar 0.24.1、skin-center/session-archive 0.4.4 审查后改 pin；在候选上核对 cockpit-bridge 0.5.1 与 0.6.0，选定版本
- [ ] 3.8 候选上实测 D3：若生成内容迁到 home 层，config-editor 是否会被 `overridden by a home patch` 拒绝；据此定案方案 A 或方案 B 并回填 design
- [ ] 3.9 候选上验证 connection 405 修复片段仍然需要且有效：去掉它时插件 RPC 返回 405，加上后返回 200
- [ ] 3.10 Session v4 演练：脱敏副本上首次写入发布 v4；重启后状态一致；损坏与截断样本按预期处理；回滚到 0.1.5 并恢复备份后可读
- [ ] 3.11 候选中禁用 memex 与 Pet，组合其余全部定制；记录启动清单（每项各出现一次）、loader 结果和各插件功能证据，与 0.2 基线比对

## 4. W4 memex（隔离候选，约 2–3h）

- [ ] 4.1 声明 dsh-memex 自有的 MessageSource kind，替换 `kind:'plugin'`；测试证明含该消息的会话可经 0.2.0 持久化路径写入后重新加载
- [ ] 4.2 Host 侧配置从 `ctx.settings.register`/`SettingsScope` 迁到 loader 行 config（schemastery + last-good 语义）；移除 `dsh-settings-file` 依赖，改写相关测试
- [ ] 4.3 设置页从 `settingsScope.bind` 迁到 `configForms`：保存仍以 Host 回读为准，保留工作区声明、主入口和开关的守门逻辑
- [ ] 4.4 配置迁移：`settings.yaml` 导入的 `dsh-memex.scopes` 与 org-hosts 的键合并后生效；迁移失败时 fail closed，不发布工具
- [ ] 4.5 候选上启用 memex：逐工作区比对路由、主入口和开关结果与 0.3 快照一致；人工验收记忆设置页、卡片浏览、召回注入和写卡提醒

## 5. W5 Pet（隔离候选，约 4–5h）

- [ ] 5.1 先实测子代激活名额池：确认 locus 创建、只读访问、冷恢复各自怎样占用和释放名额，据此确定 5.5 的改动面
- [ ] 5.2 `compat/subagent` 改为以 `dsh-v0.2.0-rc.2` 为基线：重写失败的 `child-agent.ts` hunk 和测试 hunk；4 个 seam 逐项重新举证并记录被排除的官方替代路径；更新 tag、commit、patch hash、能力 marker 和 README
- [ ] 5.3 launcher 的依赖范围改写（`~`/`*`→`^`）后，证明 cordis 等运行体包在依赖树中只有一个实例；`supportedDshVersion` 与 `dshVersion` 精确一致
- [ ] 5.4 `dsh-pet-executor` 改为由 sync 渲染成 `dsh-agent-preset` 声明行；清理 sync 账本中记录的 `.agent-presets` 产物；Pet 依赖从 `dsh-agent-presets` 迁到 `dsh-agent-preset-registry`
- [ ] 5.5 child 存在证明改为依赖 catalog 现存字段（`child.ts:1701`、`qa/subagents.ts`）；名额不足时进入可重试状态，不丢投递
- [ ] 5.6 Pet 全量测试与运行时探针：silent 结算、idle child、independent 冷恢复 + 已保存 preset、精确 child Session、Storage 原子性，任一项退化即判定 NO-GO
- [ ] 5.7 候选上启用 Pet：轮盘、Locus fork/independent 基线、SQLite 单 writer、真实飞书入口与媒体下载

## 6. 原子切换 gate

- [ ] 6.1 候选完整组合（W3+W4+W5）连跑两次 sync/build：第二次无变化，dump-config 可用，启动清单每项恰好出现一次，loader 全部可执行
- [ ] 6.2 复跑根测试、11 个 local package 测试、`check:artifacts`、`openspec validate --strict`、`git diff --check`，与 0.2 基线逐项比对
- [ ] 6.3 提交候选 commit；在 devbox 上对该精确 commit 做清洁构建与场景验收（沿用 0.1.5 change 的 9.x gate）
- [ ] 6.4 生产备份：`~/.dsh/sessions`、Pet SQLite、profile 目录、`settings.yaml`、manifest，全部 owner-only 并做完整性校验；记录回滚所需的旧 commit 与 pin
- [ ] 6.5 用户批准后按 Worktree Session 受控流程合入，生产执行 `dsh build` 两次，由用户执行 `dsh restart`
- [ ] 6.6 刷新现有 3080 GUI 完整验收：Session 列表与续写（产生 v4）、各插件、memex、Pet/飞书；失败时按 design 的回滚顺序恢复

## 7. 收尾

- [ ] 7.1 把每个第三方插件的最终 pin、审查与回滚说明写回 `dsh.yaml` note
- [ ] 7.2 写入轻量验收报告到 `checking/`（不含原始数据、密钥和批量截图），更新相关 docs/notes
- [ ] 7.3 请用户确认后归档本 change，同步 current specs
