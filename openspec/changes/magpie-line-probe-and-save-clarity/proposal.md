# Proposal

## Why

设置页目前无法在保存前判断一条线路是否可用：宿主只在「生效线路身份变化」时同步目录，所以新加的备用线路即使从没被连接过、key 写错、地址指错环境，界面也会安静地显示为已保存——只有等线路 1 挂掉那天才会暴露。用户只能先保存、再猜。

同一处交互还有两个与既有规范不符的副作用：

- 任何 `lines` 提交都会让设置页清空并重读用量卡片，即使生效线路完全没变。这与 `dsh-magpie-connector`「非生效线路的变化（编辑、增删、排序但生效线路不变）SHALL NOT 清空目录或卡片」相矛盾。
- 已保存但不完整的线路（填了地址没填 key 等）在卡片列表里没有任何标记，而 `magpie-line-selection` 要求「未完整配置的线路……并 SHALL 标记为未配置」。

## What Changes

- **新增只读的「检查线路」**：设置 API 增加一个检查端点，按草稿（地址、接入方式、key；凭据留空且有该线路 id 时用已保存值，地址留空不回退）对目标网关发一次真实 `GET /models`，返回单一分类结果（`kind`、网关状态、脱敏原因、耗时、模型数量与模型 id 摘要）。它的准入包含一个只存在于 host 内存的「连接写入版本号」：任何连接保存（即使失败）或凭据外部更新都会让它失效，解析后校验不过就返回 `pending` 且不发请求——因此它既不会与保存交错拼出新旧混合凭据，也不写凭据、不写设置、不换代、不参与选线、不注册路由、不写探测缓存。
- **传输边界随之扩展**：`dsh-magpie-connector` 的「只读与传输边界」新增第二个例外——只有线路检查可以向被检查线路经过校验的 API 根发这一条 `GET /models`，用该线路自己的凭据，仍禁止其它路径、`/api/*`、重定向与跨线路凭据。
- **快照只属于那张线路卡片**：每条线路卡片内提供「检查线路」，结果渲染为只读快照——一行结论、耗时、模型数量，以及与宿主**目录缓存**（`settings.groups` + `lastSyncAt`）按完整 model id 集合算出的多出 / 缺少。它不提供 checkbox、effort 或刷新入口，不写可见性与默认 effort，也不声称「与当前生效线路一致」（缓存可能是切线时的继承目录）；编辑生效线路的草稿时同样显示结果。本卡输入一变、保存成功、生效线路改变、重新打开页面，快照即失效，进行中的检查结果同时作废。
- **未配置标记**：已保存但未完整的线路在卡片头显示「未配置」，并说明它不参与自动选择。
- **保存结果只陈述状态**：保存成功后显示 `已保存 · 当前线路 N`（没有完整线路时 `已保存 · 当前无生效线路`）；它不描述切换事件，结果元素不带 `role="alert"` / `role="status"` / `aria-live`。
- **保存的身份隔离按提交前的意图收窄**：涉及生效线路地址 / 接入方式 / 凭据或删除生效线路的提交，在发出请求前隐藏旧卡片并推进 epoch；纯备用线路提交保留卡片与读取时间。响应后若生效线路因这次保存改变，按既有规则切换；失败（含部分写入）维持隔离，不恢复旧卡片。

**不在本期范围**：

- 按线路读取账号/用量（`GET /magpie/quotas/cards` 旁路）——配置阶段的真问题是"地址和 key 对不对"，用量快照单独立项。
- 手动选择或强制指定线路（仍然只有自动选择）。
- 进度条等其它视觉调整（已从范围中移除，本次不改）。

## Capabilities

### New Capabilities

<!-- 无新增能力 -->

### Modified Capabilities

- `magpie-line-selection`: 新增四条 requirement——「线路检查端点与结果分类」「线路检查请求字段契约」「线路检查的准入、读取一致性与单飞」「线路检查快照的展示与失效」；并在「线路列表与优先级」补充未配置标记与保存结果只陈述状态（含结果元素不带 alert/status/aria-live）。
- `dsh-magpie-connector`: 「只读与传输边界」新增线路检查这一 origin 例外（单次 `GET /models`、该线路自己的凭据、不跟随重定向、不触发换代/同步/注册），该 requirement 既有 6 个 scenario 与其它约束逐字保持不变。

## Impact

- `packages/dsh-magpie-connector/src/host/routes.ts`：注册线路检查端点（200 + `kind` 结果，请求体形状非法才 400）。
- `packages/dsh-magpie-connector/src/host/runtime.ts`：新增只读检查入口（自带的 disposed / saving / pending 准入、id 形状与成员校验、复用 `retainIdentity` / `retainKey` 做临时凭据的引用计数与脱敏、全局单飞）；不新增 generation，不改 `current`，不触发 `selector` / `syncCatalog` / `emit`。
- `packages/dsh-magpie-connector/src/client/SettingsPage.ts`：检查按钮与快照、未配置标记、保存结果文案与元素属性、提交前身份隔离与 epoch、响应后的自动切线判断。
- `packages/dsh-magpie-connector/src/client/styles.ts`：快照与未配置标记样式。
- 测试：新增 `test/line-check.test.ts`、`test/line-check-ui.test.tsx`；调整 `test/line-active-ui.test.tsx`（未配置标记）、`test/line-silent-ui.test.tsx`（保存结果元素无 role）、`test/cards-render.test.tsx` / `test/settings-write-isolation.test.ts`（身份隔离与不清卡片）。
- 无持久化 schema 变化、无凭据引用变化、不需要宿主重启；插件版本按发版惯例改动。
