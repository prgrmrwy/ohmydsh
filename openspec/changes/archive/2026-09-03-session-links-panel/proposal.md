## Why

会话过程中产生的关键链接(MR、CI/部署链接、meego 工作项、产物制品 URL)散落在长消息流里,切走会话或滚动后难以找回;用户需要一个常驻面板按类别实时收集、展示当前会话中的链接/文档,并随会话切换联动。

## What Changes

- 新增自研 local package「会话链接面板」:注册到 better-sidebar 右侧工作台的一个 tab(宿主已装 `dsh-better-sidebar@0.16.0`),不触碰官方左侧栏与官方代码。
- 订阅官方 runtime 的 conversation snapshot,增量采集 user / assistant / steering / context 消息 text 块中的 URL;长会话防抖、只保留链接摘要不持有全文。
- 链接按域名/特征自动分类:MR、部署、meego、产物制品、其他;助手消息产生的链接优先展示;显示链接出现时间与来源消息。
- 面板与当前会话联动:切换会话即清空/重建对应会话的链接集;badge 显示当前会话链接计数。
- 纯浏览器半区插件:无 host 能力、无网络外呼、不读凭据;仅依赖官方 runtime 数据面与 better-sidebar 注册面。
- 入口:better-sidebar「+」菜单与 tab 栏;manifest 新增 local 条目,默认启用,可独立禁用/升级/移除。

## Capabilities

### New Capabilities
- `session-links`: 会话链接面板 — 采集、分类、展示当前会话消息中的 URL(MR/部署/meego/产物/其他),随会话切换联动,并给出计数徽标。

### Modified Capabilities
<!-- 无现有 spec 行为变化。 -->

## Impact

- 新增 `packages/session-links/`(web client 插件,沿用本仓 local package 结构),`dsh.yaml` 增加 local 条目。
- 类型依赖:官方 `@deepseek-ai/dsh-client-runtime`(conversation snapshot / `ClientContext`)、`@deepseek-ai/dsh-client-ui-slots` 类型面;运行时依赖 `dsh-better-sidebar@^0.16.0`(registerTab / TabComponentProps)。
- 不修改任何官方包;DSH 升级后需回归验证 conversation 节点结构与 better-sidebar tab API 兼容性。
- 规模:单 package、纯浏览器半区;新增 spec `openspec/specs/session-links/spec.md`。