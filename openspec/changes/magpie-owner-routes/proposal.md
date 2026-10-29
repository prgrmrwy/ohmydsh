## Why

商店维护者复核 awesome-dsh-plugin PR #10211 时指出：`dsh-magpie-connector` 描述的「模型按上游 provider 分组」只在 ohmydsh 自建的 Pet compat Host 扩展（`model-display.patch`，重建 5 个 `@deepseek-ai/*` 包加 `displayGroup`）下成立；原版 DSH 0.2.0-rc.2 只有一个 `Magpie` 组，里面平铺全部模型。插件作为独立商店插件，必须不依赖任何宿主改造就能呈现 `Magpie (Claude)`、`Magpie (Codex)` 这样的分组。

原版宿主的模型选择器按 **provider route** 分组（`buildModelCatalog` 每个 route 一组、组名取 `providerInfo().name`，空组自动隐藏）。因此唯一不改宿主、也不伪造 DOM 的做法是：插件按网关 `owned_by` 注册多个真实 route。

## What Changes

- 插件按网关目录的 `owned_by` 注册多个真实 route：`dsh-magpie-connector-<owner>`；没有 `owned_by`（或取值不合法）的模型统一归入 `dsh-magpie-connector-other`。每个 route 只列出本归属的模型，模型 id 保持网关原值（如 `claude/claude-opus-5-5`）。
- 组名为 `Magpie (<Owner>)`，`<Owner>` 是规范化（小写）后的归属键首字母大写（`Claude`、`Codex`、`Opencode-go`、`Deepseek`），只由归属键决定；其余归 `Magpie (Other)`。
- 见过的归属持久化到设置 `knownOwners`；Host 启动时在目录同步之前就先注册，保证重启后 route 身份存在（目录同步完成后模型才可选）。首次注册失败按启动失败报告，不假装成功。之后某个归属从目录里消失，route 仍然保留，组为空时选择器自动隐藏。
- **BREAKING**：不再注册旧 route `dsh-magpie-connector`，不提供兼容别名。升级后旧会话和默认模型需在选择器中重选。
- 每个 route 返回的模型信息 `provider` 等于被请求的 route（宿主强制校验）；原生推理回放使用与 route 无关的固定传输身份，归属 route 上和跨本插件 route 的续聊都保留推理元数据。
- 删除 AMD2 的 `displayGroup` 输出，插件不再依赖 Pet compat 的 `model-display.patch`。
- 速度控件改为在当前 provider 是任一本插件归属 route 时生效。
- 版本 0.3.0；README 去掉「需要 Host 扩展」限制；发版后更新商店 PR 条目描述。

**不在本期范围**：
- AUTO（`auto-model-routing`）对新 route id 的适配——由用户另行安排；本 change 期间 AUTO 中的 `dsh-magpie-connector` transport 会失效。
- 出口守卫（`home-network-model-guard`）部署默认豁免的更新——跟随 AUTO 那一轮另行处理；本 change 期间 Magpie 的 Claude 模型在 blocked/unknown 出口会被守卫按 fail-closed 拦截。
- 退役 Pet compat 的 `model-display.patch`（不再有使用方后另起 change 清理）。
- 可见性 / 默认 effort 偏好键迁移（继续按 `owned_by`/首段 provider 与模型 id，不受影响）。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `dsh-magpie-connector`：插件身份与命名（单 route → 按归属的多 route，旧 route 退役）；网关连接与凭据、连接身份与代际隔离、模型目录字段映射、禁用不删除用户数据、旧格式升级（去掉对旧 route 的引用）；Codex 速度切换（适用于全部本插件 route）；新增「按网关归属注册 route」「原生回放身份跨 route 稳定」「归属 route 持久」；移除「选择器按网关归属展示分组（AMD2）」。

## Impact

- 代码：`packages/dsh-magpie-connector/src/{index.ts,host/catalog.ts,host/adapter.ts,host/settings.ts,host/runtime.ts,client/SpeedSelect.ts}` 、`host/routes.ts`（设置写入队列下沉）及测试；README / README.zh / CHANGELOG / package.json；`dsh.yaml` 中本插件条目的版本与说明。
- 已检查无需改动：`sidebar-session-provider-icon` 对 `dsh-magpie-connector-*` 经 `normalizeIdentity` 后按 `magpie-` 前缀识别为 Magpie（`packages/sidebar-session-provider-icon/src/client/logos.ts:50-63`）。
- 受影响但不在本 change 修改：`packages/auto-model-routing/src/strategies/{claude,codex}.ts` 的 `transports`、`patches/home-network-model-guard-config.yml` 的 `exemptProviders`（见上「不在本期范围」）。
- 依赖：本 change 的 `dsh-magpie-connector` delta 建立在 `magpie-dual-lines` 之上，应在其归档后再归档本 change。
- 用户可见：选择器从一个 `Magpie` 组变为多个 `Magpie (<Owner>)` 组；旧会话选中的 `dsh-magpie-connector` 模型不再可用（宿主报 `NO_ADAPTER`），必须重选。
