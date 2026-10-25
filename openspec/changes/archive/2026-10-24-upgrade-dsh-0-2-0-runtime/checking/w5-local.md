# W5 本地实现证据（Pet，0.2.0 依赖，隔离 DSH_HOME；未部署、未构建 launcher）

## 5.2 compat/subagent 重新推导
- 基线 `dsh-v0.2.0-rc.2` = `639ed015397290b3745d163aafe02ffee4aa3f84`。四个 seam（`settlementNotice` / `createIdleContinuable` /
  `independent-v1` / `withLiveContinuableChildSession`）在干净 HEAD 中 `git grep` 仍为 0 命中 → 全部保留，排除理由同 README「退役还取决于…」表，前提未变。
- 旧补丁在 0.2.0 上：`child-agent.ts` 第 3 个 hunk 与 `list-children.spec.ts` 失败；`git apply --3way` 自动合并源码 hunk，
  逐行比对与 0.1.5 hunk 语义相同（0.2.0 `AgentPresetRegistry.mount(ctx,id)` 仍返回 `{ id }`）；测试 hunk 作废（上游删除了该用例），取上游版本。
- 新补丁 sha256 `86310610709d80d540dd97b1b7fb1fbc4012a3ef1f5eadc12ba590f7905005fa`；build.mjs / build-launcher.cjs / package.template.json / README 同步。
- 上游 subagent 规格（只装 `@deepseek-ai/dsh-subagent...` 依赖、原生 addon 取自同版本预编译包）：未打补丁 316 通过，打补丁 327 通过。
- `DSH_COMPAT_SUBAGENT_CHECKOUT=<0.2.0 worktree> node build.mjs`：语义门 continuation.spec 160 通过、构建、5 个能力 marker + `deliverSubagentPrompt` 全部命中，
  产物 `0.2.0-rc.2-locus-settlement-notice.2`；构建后上游工作区已还原为干净。

## 5.3（未做，留 devbox）
launcher 安装真实 `@deepseek-ai/dsh@0.2.0-rc.2` 并校验依赖树唯一，需完整网络安装与 ~GB 磁盘；manifest `supportedDshVersion` 已与 `dshVersion` 一致，守卫测试已更新。
undici 7.30.0 偏差在 0.2.0 仍适用：`dsh-http-proxy`/`dsh-web-fetch-http` 仍声明 `undici ^8.10.0`。

## 5.4 executor preset
- sync 在 0.2+ 上把 `type: preset` 渲染成 `@deepseek-ai/dsh-agent-preset` 声明行（`id: preset-<id>`、`config.id`、`preset.yml` 的 name/description、`plugins` 保留 `!!js`），
  并以「全部禁用」跑目录同步，经账本删除 0.1.x 复制到 `.agent-presets` 的副本。4 例新测试，关闭渲染时 3 例红。
- 与 0.2.0 shipped `standard` 结构对比：差异仅为既有刻意差（无 skill-filesystem / present / command-goal / plugin-manager，`fetch:false`，
  无 `modelSelectionSettings`）加一处上游更名：`dsh-workflow-worker-thread` → `dsh-workflow-ptc`（已改）。
- Pet 依赖 `dsh-agent-presets` → `dsh-agent-preset-registry`（W3 已改），服务名同为 `agentPresets`。

## 5.5 child 存在证明
0.2.0 `listChildren` 返回 `SubagentCatalogEntry`（id/createdAt/mode/label，无 `kind`、不混 diagnostic）。判据改为 `mode === 'continuable'`，
若报告了 `kind` 仍须为 `child`。新增 3 例 0.2.0 形态，旧判据红。`qa/subagents.ts` 只用类型别名，不做运行时判别。

## 其他 0.2.0 发现
- `agent/created` 监听器显式返回 `undefined`（foreign executor 的异步组合仍不阻断创建）。
- 客户端：`SessionListState.current` 删除 → `mainView` 判据；`sessions.open/openSubagent` → `uiWorkspace.openSession(SessionId | SubagentAddress)`；
  新 peer `dsh-client-ui-workspace`。4 例行为测试。
- DSW 令牌在 0.2.0 只由 `dsh-client-ui-theme` 的 client bundle 定义（0.1.5 时被其他 bundle 内联）→ 加为 devDep，令牌词表测试恢复有效。
- `sessionController.inspect()` 签名与 `SessionInspection.events` 不变，复核后把 seam 测试的版本 pin 改为 0.2.0-rc.2。

## 结果
- dsh-pet：build / typecheck ok；159 文件 2813 通过 / 43 跳过（与基线跳过数一致）。
- 根 `npm test`：281 / 279 pass / 0 fail / 2 skipped；`check:artifacts` ok。
- manifest：dsh-pet 与 dsh-pet-executor 已恢复 `enabled: true`。

## 留给候选 / devbox
5.1 名额池实测、5.3 launcher、5.6 运行时探针（silent、idle child、independent 冷恢复 + 已保存 preset、精确 child Session、Storage 原子性）、5.7、5.8。
