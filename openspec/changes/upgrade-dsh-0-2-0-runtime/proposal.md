## Why

`@deepseek-ai/dsh` 的 registry `latest`/`next` 已前进到 `0.2.0-rc.2`，本仓仍钉在 `0.1.5-rc.2`。社区插件和官方新能力已经开始只按 0.2.0 发版，例如官方实验性语音输入、`dsh-ears`、better-sidebar 0.24.x。0.2.0 同时引入了几类破坏性变化：

- **加载面**：插件 peer 不满足就硬拒绝；
- **持久化**：Session 格式 v3→v4，单向；
- **配置所有权**：运行时开始写 profile patch，并一次性导入 `settings.yaml`；
- **API**：`agent/session-start`、`MessageSource kind:'plugin'`、`settingsScope`、`dsh-agent-presets` 目录式 preset 均被移除，工具结果改为 `role:'tool'` 消息。

直接改 pin 会让 local package 被拒绝加载，Pet 与 memex 失效，用户设置被 sync 冲掉，且无法安全回滚。因此需要一次按难度分波推进、最终原子切换的迁移。

## What Changes

按「0.1.5 上可前置完成的先做，其余按复杂度由易到难」分五波推进。W1–W2 在现役 0.1.5 上独立验收、独立上线；W3–W5 在隔离候选中依次完成，最后作为**一次**运行体原子批正式切换。生产环境不经历 memex 或 Pet 缺席的中间态。

- **W1 前置清理（0.1.5 上线）**
  - 在私有 overlay 中把 traex-bridge 设为 `enabled: false`；该插件无 0.2.0 兼容版，且用户已不再使用。
  - 把新旧两个运行体都兼容的第三方插件升到新版：cost-meter 1.8.6、subscriptions 0.9.7、width-tiers 1.0.6。
  - worktree-session 与 dsh-memex 的 `agent/session-start` 订阅改为 0.1.5 已提供的 `agent/created`。
  - 顺带修正 ai-code-report-bridge 的三处事件/字段名错误。这些错误在新旧版本下都会让统计静默为空。
- **W2 配置所有权（0.1.5 上线）**
  - sync 不再整文件独占运行时会写入的 profile patch。生成内容改写入 0.2.0 新增的 home 层 patch，过渡期保持 0.1.5 等价。
  - org-hosts 等覆盖片段只合并自身声明的 config 键，不再整行替换。
  - 本波是 0.2.0 不丢用户设置的前置条件。
- **W3 运行体与易改项（隔离候选）**
  - **BREAKING** `dshVersion` → `0.2.0-rc.2`。同批迁移 provider pin（skill-filesystem、mcp-client）与全部 local peer 声明，并清理写死 0.1.5 的脚本与测试。
  - 适配 session-links（`message.isError`）、subscriptions-sandbox-shim（`role:'tool'` 工具结果）、worktree-session（运行中归档受限、`input.submit` 新增参数）。
  - 升级只兼容 0.2.0 的第三方插件：better-sidebar 0.24.1、skin-center 与 session-archive 0.4.4。
  - 复核 connection 405 修复片段仍需保留。
  - 用真实 Session 备份演练 v3→v4 迁移与回滚。
- **W4 memex（隔离候选）**
  - 声明插件自有的 MessageSource kind。
  - 设置从 `settingsScope` / Host `settings.register` 迁到 profile 持有的 Cordis Config 与 `configForms`，迁移现有 scopes 配置，并去掉对已删除的 `dsh-settings-file` 的依赖。
- **W5 Pet（隔离候选）**
  - 以 `dsh-v0.2.0-rc.2` 重新推导 subagent compatibility patch，4 个 seam 上游仍未提供。
  - `dsh-pet-executor` 改为在 profile 中声明 preset，替代已失效的 `.agent-presets` 目录。
  - 适配 `listChildren` 新返回结构与子代激活名额池。
- **原子切换**
  - W3–W5 在隔离 `DSH_HOME` 与 devbox 清洁构建 gate 全部通过后，一次性写入生产。
  - 切换前完整备份 Session、Pet 与 profile；切换后刷新现有 GUI 验收。
  - 回滚走「停 writer → 恢复备份 → 旧 manifest/runtime」。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `staged-upgrade-execution`：允许「前置波次在旧运行体独立上线、依赖运行体的波次在隔离候选内按难度推进后合并为一次原子切换」。明确不再使用的插件以显式禁用退出，不随运行体候选评估。
- `repo-layout`：生成的 patch 层改为 home 层，profile patch 让给运行时写入；覆盖片段改为按键合并 config；sync 不得覆盖或回收运行时写入的配置；preset 物化从目录复制改为 profile 声明。
- `runtime-api-migration`：上游删除的事件、消息来源 kind、settings 接口与工具结果表示，纳入迁移审计面并要求按语义等价迁移。
- `dsh-memex-scope`：配置承载从 DSH settings namespace 改为 profile 持有的插件配置，保留分层、校验与 last-good 语义。
- `dsh-pet`：executor preset 改为声明式；Locus child 的存在证明不得依赖已移除的 catalog `kind` 字段；子代激活受名额池约束时 fail closed。
- `subscriptions-sandbox-shim`：会话历史一致性对 `role:'tool'` 形态的工具结果同样成立。

## Impact

- **真相源**：`dsh.yaml`，私有 overlay `dsh.yaml`（traex），`patches/connection-webserver.yml`，`presets/dsh-pet-executor`。
- **sync/启动器**：`scripts/sync.mjs` 中 patch 层写入、bundle 归属与 preset 物化；`scripts/jev-readiness.mjs`；启动清单脚本；相关 `tests/`。
- **local package（11 个）**：peer 声明。代码改动集中在 dsh-memex、dsh-pet（含 `compat/subagent`）、worktree-session、subscriptions-sandbox-shim、session-links、ai-code-report-bridge。
- **第三方 pin**：cost-meter、subscriptions、width-tiers、better-sidebar、skin-center、session-archive。cockpit-bridge 自研，已有 0.6.0，只需核对。
- **持久数据**：`~/.dsh/sessions`（约 648M，v3→v4 单向）、Pet SQLite、`~/.dsh/settings.yaml`（首启被导入并改名）、profile patch。
- **非目标**：
  - 不追 0.2.0 之后的新 rc，目标冻结在 `0.2.0-rc.2`，中途出现新版本时停下重新评估。
  - 不启用官方实验性语音输入，也不安装社区语音插件，另行处理。
  - 不修改 `pet-locus-independent-agent-inquiries` 的产品语义。
