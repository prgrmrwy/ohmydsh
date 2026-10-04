## Context

registry `latest`/`next` 已是 `0.2.0-rc.2`；本仓精确 pin `0.1.5-rc.2`，`autoUpdate` 关闭。2026-10-02 做了一轮只读勘察：在上游 tag `dsh-v0.1.5-rc.2..dsh-v0.2.0-rc.2` 之间比对源码，并下载 npm 发布物核对。确认以下事实，并在源码中逐条复核：

- **peer 硬门禁**：`app-boot/src/plugin-compatibility.ts:77` 用 `semver.satisfies(runtime, range, {includePrerelease:true})` 判定 peer 兼容，不满足就拒绝。安装时 exit 1；启动时整个 bundle 被跳过，插件行被设为 `disabled`。11 个 local package 的 `^0.1.5-rc.2` 全部不满足。
- **持久化**：`SESSION_FORMAT_VERSION = 4`。只读打开时只在内存里迁移；首次以写入方式打开时才发布 v4 successor，旧 generation 保持逐字节不变。0.1.5 读到 v4 会拒绝打开。
- **配置所有权**：config-editor 把设置写入 profile `cordis.patch.yml`（`config-editor/src/index.ts:87-140`），首启时把 `$DSH_HOME/settings.yaml` 导入后改名为 `.imported`。新增 home 层 `$DSH_HOME/cordis.patch.yml`，位于 profile patch 之上（`profile-context.ts:63-70`）；被更高层覆盖的编辑会被拒绝（`:140`）。
- **API 删除**：`agent/session-start` 事件；`MessageSourceMap` 中的 `plugin` kind；V4 读取遇到 `plugin` 会抛错（`session-format-v3-to-v4/src/message-sources.ts:10`）；`settingsScope` 与 Host 端 `settings.register`；npm 包 `dsh-agent-presets` 与 `dsh-settings-file`；目录式 preset 也被移除（上游 note `2026-09-18-declarative-agent-presets`）。工具结果改为 `role:'tool'` 消息。
- **Pet**：4 个 compat seam 在 0.2.0 仍无官方等价物。patch 能否直接套上已在 /tmp 用 dry-run 检查过，只有 `child-agent.ts` 的 1 个源码 hunk 与 1 个测试 hunk 失败。另有三处变化：`listChildren` 不再返回 `kind`；新增子代激活名额池（`maxActiveSubagents` 默认 8）；新增 peer `dsh-agent-preset-registry`、`dsh-permission-presets`、`dsh-workspace`。
- **不变的部分**：`patches/connection-webserver.yml` 的退休条件仍未满足，0.2.0 web-app 的 connection 行仍是 `inject: [webRuntime]`。AGENTS.md 与 `$DSH_HOME/skills` 的加载方式不变。skill-filesystem 与 mcp-client 的配置键仍在。cockpit-bridge 0.6.0 只要求 `cordis ^4.0.1`。Node 引擎要求 `^22.19 || >=24`，本机 v24.16。
- **第三方**：

  | 兼容范围 | 版本 |
  |---|---|
  | 新旧运行体都兼容 | cost-meter 1.8.6、subscriptions 0.9.7、width-tiers 1.0.6 |
  | 只兼容 0.2.0 | better-sidebar 0.24.1、skin-center 0.4.4、session-archive 0.4.4 |
  | 无兼容版 | traex-bridge（用户已不再使用） |

- **0.1.5 已提供的部分**：`agent/created` 在 0.1.5 已存在（`runtime-types.ts:258`），可以前置替换。`configForms`、自定义 MessageSource kind 只有 0.2.0 提供，只能随运行体切换。

历史校准：上次 0.1.5 升级共 66 个任务，用 AI coding 实际约 1–1.5 个日历日完成，瓶颈在真机验收，不在写代码。

## Goals / Non-Goals

**Goals:**

- 以「前置波次先上线、运行体依赖波次在候选中由易到难推进、最终一次原子切换」的方式迁到 `0.2.0-rc.2`。
- 生产不经历 memex 或 Pet 缺席的中间态；用户设置、Session、Pet 数据不丢。
- 每一波都有独立验收证据；前置波次可以独立回滚。

**Non-Goals:**

- 不追踪 `0.2.0-rc.2` 之后的版本；如中途出现新 rc，停下来重新冻结。
- 不启用官方实验性语音输入，不新增社区插件。
- 不改变 `pet-locus-independent-agent-inquiries` 的产品语义，不顺带重构 local package。
- 不评估或适配 traex-bridge。

## Decisions

### D1. 五波划分以「能否在 0.1.5 上成立」为界，波内按复杂度排序

| 波 | 内容 | 在哪里 | 估时（AI） |
|---|---|---|---|
| W1 | traex 禁用；双兼容第三方插件；`agent/session-start`→`agent/created`；ai-code-report 字段修正 | 0.1.5 生产 | ~1h |
| W2 | sync patch 层所有权与 config 合并 | 0.1.5 生产 | 2–3h |
| W3 | 运行体 pin + peer + provider；session-links / shim / worktree 适配；0.2.0-only 第三方插件；Session v4 演练 | 隔离候选 | 3–4h |
| W4 | memex：自有 source kind + 配置迁到 profile config | 隔离候选 | 2–3h |
| W5 | Pet：compat 重推导 + 声明式 preset + listChildren / 名额池 | 隔离候选 | 4–5h |
| 切换 | W3–W5 一次原子写入生产 | 生产 | ~1h + 人工验收 |

替代方案 A 是 W3 先上线，同时临时禁用 memex 与 Pet。用户选择了不经历该中间态（方案 B），因此不采用。

替代方案「全部合为一批」：W1、W2 的收益会被运行体风险阻塞，失败时也难以归因，因此不采用。

### D2. traex-bridge 在 W1 显式禁用，不参与兼容评估

用户已不再使用 traex。在私有 overlay 中把它设为 `enabled: false`，sync 后它从部署面消失。它曾经覆盖的默认模型、`web.searchProvider` 随之回到官方默认，这一行为变化本身就是用户意图，不另设处理。

### D3. sync 生成内容的承载位置：先实测，再在两个方案中二选一

问题有两层：0.2.0 运行时会写 profile patch，并导入 `settings.yaml`；org-hosts 等覆盖片段是整行替换 config，不做深合并。

- **方案 A（首选）**：sync 生成内容写入 home 层 `$DSH_HOME/cordis.patch.yml`，profile patch 留给运行时。风险有两点。第一，0.1.5 不读 home 层（`readProfilePatches` 在 0.1.5 没有该层），所以 W2 在 0.1.5 上无法直接切到 home 层，只能在 W3 随运行体一起切换。第二，home 层位于 profile 之上：如果 org-hosts 在 home 层整行覆盖 `dsh-memex`，config-editor 对该行的编辑会被拒绝，报 `overridden by a home patch`。
- **方案 B（兜底）**：保留写 profile patch，但只替换生成标记圈定的区段，区段外由运行时写入的行原样保留。0.1.5 和 0.2.0 都能用，但同一文件由两方写，需要与运行时的 `withFileLock(profile/package.json)` 协调。

W2 在 0.1.5 上先落地**方案 B 的区段化**，并把覆盖片段改为**按键合并**：sync 读取下层既有 config，只覆盖片段声明的键。这一步在 0.1.5 上即可验收。W3 再在候选上实测 home 层与 config-editor 的交互，实测证明安全才迁到方案 A，否则保留方案 B。两种结果都满足 `repo-layout` 中「生成文件带标记且按序合并」的修订要求。

`settings.yaml` 导入：在 W3 候选中实测导入结果。导入的段落与 sync 合并后的 config 必须同时生效，这一点由 spec 场景「覆盖片段只合并自身声明的键」覆盖。

**W2 实施发现（2026-10-04，源码核实）**：0.2.0 的 config-editor 保存时只改**最后一条**同 id 覆盖行（`findLastIndex`），并整份替换该行的 `config`。loader 的覆盖语义也是按键整替换（`cordis-plugin-include` `applyEntryPatches`：`target[key] = value`）。因此，只要生成区段与运行时写入的行同在 profile patch 里：

- sync 能把运行时**已经写入**的同行 config 键并入区段（W2 已实现，带 `mergeConfig: true` 的片段才这样做）；
- 但运行时**之后**再保存同一行时，它会在区段下方写出一份不含 org 键的完整 config，这一行排在后面、组合时生效，org 键随之失效，直到下一次 sync。

所以方案 B 能保证「不丢运行时写入」，保证不了「运行时写入不覆盖 sync 的键」。

**W4 定案（2026-10-04，本地实现，待候选实测）**：在 0.2+ 上，带 `mergeConfig: true` 的片段**不再渲染进生成区段**，改为维护区段下方的一条**运行时所有行**（id 相同）：
- 没有该行时 sync 种一条：config = 片段声明的键（org hosts）叠上 `settings.yaml` 中对应旧分节（dsh-memex 的 scopes/bindings/workspaces/autoDerive）；
- 已有该行时 sync 只把片段声明的键保持为最新值（`yaml` Document API，保留注释、顺序与 `!!js`），其余键属于运行时；
- 设置页保存改写的正是这条「最后一条同 id 行」，于是表单写入与 org 键在同一行内共存，sync 再跑是空操作；
- 区段末尾固定一条空 insert 锚行，保证 config-editor 追加的新行落在区段之外（`yaml` 会把尾注释挂到最后一个节点上，没有锚行时新行会被追加进区段、下次 sync 被删）；
- `settings.yaml` 读不了或分节形状不认识时整次 sync 失败、不写 patch（fail closed）；`settings.yaml` 原样保留，交给上游首启导入，它对同一行合并的是相同的值。

这样 A 不再必要；3.8 仍需在候选上实测「设置页编辑 → build×2 → 值仍在且 org 键仍生效」。后者只有方案 A（生成层位于 profile 之上的 home 层）能做到，代价是 config-editor 会以 `overridden by a home patch` 拒绝编辑被 home 层覆盖的行。3.8 实测时必须同时验证两件事：被 org-hosts 覆盖的 `dsh-memex`/`session-links` 行在设置页是否还能编辑；如果不能，org 键要换一个不和运行时抢同一行的承载方式（例如由插件读取独立配置源）。

### D4. 运行体依赖波次在单一候选 `DSH_HOME` 上累积

W3 建立隔离候选：独立 `DSH_HOME`、非 3080 端口，使用真实数据的脱敏副本。W4、W5 在同一候选上叠加，每波结束时记录启动清单、loader 结果与功能证据。后一波失败时只回退本波改动，不重建前面的波次。最终 devbox 用精确 commit 做一次清洁构建，作为切换 gate。

W3–W5 进行期间，memex 与 Pet 在候选上可以处于禁用态；这只是候选内部状态，不会进入生产，符合 `staged-upgrade-execution` 新增要求中「生产不经历缺席」的约束。

### D5. memex 迁移：自有 source kind + profile config，配置无损迁移

- 用 `declare module` 扩展 `MessageSourceMap`，声明 `dsh-memex` 自有 kind（参照上游 `context/time-context/src/index.ts:15`）。用 0.2.0 的持久化读路径证明含该消息的会话可以重新加载。
- 配置从 `settingsScope` 迁到本插件 loader 行的 config 与 `configForms`。0.2.0 首启会把 `settings.yaml` 中的 `dsh-memex` 段导入本插件行的 config；该段与 org-hosts 的 `internalHosts`/`internalDomains` 键依靠 D3 的按键合并共存。设置页的读写从 `settingsScope.bind` 改为 config form。
- 迁移前后，各工作区的路由、主入口与记忆开关逐项比对一致，作为 `dsh-memex-scope` 修订要求的验收证据。

### D6. Pet：沿用 compat 机制，按 0.2.0 重推导

- `compat/subagent` 的 tag 改为 `dsh-v0.2.0-rc.2`，重写失败的 `child-agent.ts` hunk。逐项重新举证 4 个 seam，按 `pet-compat-minimization` 的要求记录每个 seam 被排除的官方替代路径。重新固定 commit、patch hash 与能力 marker。
- `build-launcher.cjs` 的 `materializeWorkspaceRanges` 会把上游 `~`/`*` 改写为 `^`。0.2.0 对 cordis 用的是 `~4.0.4`，需要重新证明依赖树中只有唯一实例。
- `dsh-pet-executor` 改由 sync 在生成 patch 层渲染为 `dsh-agent-preset` 声明行；同时清理 `.agent-presets/` 中由 sync 账本记录的产物。
- `child.ts:1701` 的存在证明改为依赖 0.2.0 catalog 仍然保留的字段（id、createdAt、mode）。名额不足时进入可重试状态，不丢投递。

### D7. Session v4：备份优先，回滚即恢复

切换前对 `~/.dsh/sessions`（约 648M）、Pet SQLite、profile 目录与 `settings.yaml` 做 owner-only（`umask 077`）备份，并做完整性校验，避免重演上次备份权限被放宽的问题。W3 在候选上用脱敏副本演练三件事：v3→v4 写入、重启一致性、回滚到 0.1.5。回滚顺序固定为：停止 Host 与全部 writer，恢复备份，切回旧 manifest、runtime 与 compat 缓存，然后执行 `npm ci`。

## Risks / Trade-offs

- [0.2.0 仍是 rc，一周内已出 rc.1 和 rc.2] → 目标冻结在 `0.2.0-rc.2`；每波开始前查一次 dist-tags，出现新版本就停下评估，不自动追新。
- [W2 方案 A 在 0.1.5 上无法验证] → W2 只落地两个运行体都适用的方案 B；方案 A 推迟到 W3 候选实测后再决定。
- [Pet 名额池导致 locus 创建或访问失败，W5 估时的主要不确定项] → W5 第一步先实测名额占用的路径，再决定改动面；超出估时则在 W5 内部再拆分。
- [shim 的破坏在类型层不可见] → W3 先写覆盖 `role:'tool'` 的失败测试，再修实现。
- [memex 配置迁移出错可能把业务内容路由进错误的库] → 迁移失败时 fail closed，不发布工具；迁移前后逐工作区比对路由结果。
- [运行时插件管理与 sync 互相覆盖] → W2 引入漂移报告与写锁协调；切换后禁止在 Web 插件页安装 manifest 之外的插件，等漂移报告上线后再放开。
- [ai-code-report-bridge 的字段修正改变了上报内容] → 修正只让原本为空的 PTC 与模型统计开始有值，上报目标与门禁不变；在 W1 的 note 中写明。

## Migration Plan

1. **W1**：manifest、overlay 与代码改动 → `npm test` 与受影响包测试 → `dsh build` 连跑两次，确认第二次无变化 → 重启验收 → 上线。回滚方式：回退该提交并 build。
2. **W2**：sync 改动与测试 → 0.1.5 上实测「设置页修改 → sync 两次 → 修改仍在」→ 上线。回滚方式：回退提交，从 `.bak` 恢复 profile patch。
3. **W3→W5**：在隔离候选上逐波实现与验收，证据写入 `checking/`。
4. **切换 gate**：devbox 清洁构建精确 commit → 生产备份 → `dsh build` 两次 → 用户执行 `dsh restart` → 刷新现有 3080 GUI，跑完整验收。
5. **回滚**：停 writer → 恢复 Session、Pet、profile 备份 → 回退 manifest 与代码到切换前 commit → `npm ci` → 清 compat 缓存 → `dsh build` → 重启。

## Open Questions

- D3 最终用方案 A 还是方案 B？由 W3 实测决定。
- 0.2.0 首启导入 `settings.yaml` 时，`llm-pi-ai.providers` 等不属于本仓插件的段落是否全部被正确接收？W3 实测；有段落丢失时记录并评估是否需要手动迁移。
- cockpit-bridge 是否要随本次升到 0.6.0？它在本仓外维护；W3 候选上验证 0.5.1 与 0.6.0，选择能通过验收的版本。
