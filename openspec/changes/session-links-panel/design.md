# session-links-panel Design

## Context

需求动机见 proposal.md「Why」;行为契约见 specs/session-links/spec.md。本仓已装 `dsh-better-sidebar@0.16.0`(右侧/底部工作台框架,`ctx.betterSidebar.registerTab` 生态面板 API,本机 `profiles/web/node_modules/dsh-better-sidebar/src/client/service.ts` 即源码真相),且已有多个自研 local package(如 `sidebar-session-provider-icon`、`system-clock`)确立包结构范式:tsdown 双半区构建、`cordis.patch.yml` bundle patch、`dsh.yaml` local 条目、openspec change 全流程。

官方左侧栏(`dsh-client-ui-layout` / `dsh-client-ui-sidebar` 的 SlotMap)只有 single 槽(`sidebar` / `sidebar.workspaces` / `sidebar.settings`)与按钮级 `sidebar.footer.action`,**没有** additive 面板座椅——这是选择 better-sidebar 作为宿主的直接原因。

## Goals / Non-Goals

Goals:
- 一个纯浏览器半区的 local package,注册 better-sidebar「会话链接」tab。
- 从官方 conversation snapshot 增量提取 URL,本地分类,分组展示,随会话切换联动,badge 计数。
- 规则与分类逻辑写成可单测的纯函数。

Non-Goals:
- 不持久化链接(刷新页面后对当前会话重新全量扫描一次)。
- 不做跨会话聚合/搜索、不做 host 侧查询、不读 session 存储 sqlite。
- 不改官方 UI、不 patch 官方 sidebar、不加 host 能力。
- 不把链接发送到任何地方(包括不调用 better-sidebar 内嵌浏览器以外的任何网络面)。

## Decisions

### D1: 宿主 = better-sidebar registerTab(而非官方 sidebar seat 或 overlay)
官方左侧栏无 additive 面板座椅;`sidebar.workspaces` 是 single(注册即替换官方会话列表,代价与回归面大);`shell.overlay` 是悬浮层语义。better-sidebar 已装且 API 成熟:TabDescriptor 支持 `single` 去重、`badge` 角标、`TabComponentProps` 直接注入完整 `ctx` 与 `scope`(sessionId/cwd),tab 内可自由订阅官方 runtime。备选:patch 官方 ui-sidebar 加 seat——被否,理由:升级需回归官方包,且与已装生态重复。

### D2: 数据面 = 官方 runtime conversation snapshot(useConversationSession 类 hook 或 ctx.sessions 订阅)
`dsh-client-runtime` 提供 `ConversationSnapshot`(user/assistant/steering/context 节点,text 为 `ContentBlock[]`,assistant 另带 `blocks: AssistantBlock[]`)。采集器 SHALL 只消费 text 块:user/steering/context 全 text,assistant 仅 `kind: 'text'`(排除 reasoning 与 tool-call,避免推理噪音与参数 JSON 误报)。备选:host 侧查 sqlite session 日志——被否:破坏"纯浏览器、零 host 能力"边界,且收益只是 compaction 前历史(见 R1)。

### D3: 采集模型 = host 完整日志基线 + 窗口快照增量追尾,内存态
面板打开时,host 半区经官方 `SessionPersistence.readFrom(id, 0)` 读**完整**事件日志,用共享纯函数折出全量链接集(不可见窗口、compaction 替换都覆盖),经 Connection RPC(`/dsh-session-links`,authority loopback,30s TTL 缓存)交付浏览器侧作为基线;浏览器侧 `Map<sessionId, LinkEntry[]>` 持有,基线幂等应用(不重复计数),水位跳到日志最大 seq,之后窗口快照只增量采集 `seq > 水位` 的新消息。会话切换清空重建;渲染防抖(短 timeout 合并);重活(URL 正则、分类)在共享纯函数中完成,host/client 复用,便于 vitest 单测。host 失败静默降级为窗口语义。

### D4: 分类器 = host/路径特征规则表,纯函数,未知进「其他」
`classifyUrl(url) -> 'mr' | 'deploy' | 'meego' | 'artifact' | 'other'`:规则表 = 域名白名单(如 meego 域名)+ 路径/查询特征(MR/PR/merge_request、deploy、artifact 等),匹配顺序与规则集中在一处常量表。无法归类的 URL 必须保留在「其他」,不允许丢弃(满足 spec「不得丢弃」)。备选:NN/外部 API 分类——被否:不可判定、要出网。

### D5: 去重与排序策略(展示层)
同 URL 去重:保留最近一次出现(时间 + 来源角色),重复次数计入条目计数。组内按出现时间倒序;时间相同时 assistant 来源优先。每条展示 host+路径摘要与相对时间;点击新标签页打开(`target="_blank"` 且不注入脚本)。

### D6: 包结构沿袭本仓 local package 范式
`packages/session-links/`:tsdown client 构建、`cordis.patch.yml` 注册(compose 到 profile bundle 栈)、`dsh.client.platform: web`、peer 依赖 `dsh-better-sidebar ^0.16.0` + `@deepseek-ai/dsh-client-runtime` + cordis + react。manifest 加 local 条目(默认 enabled),`dsh build` 物化。

## Risks / Trade-offs

- [DSH 升级改变 conversation 节点/ContentBlock 结构] → 类型全部走官方 runtime 导出,升级后回归验证采集与渲染;结构变化时面板安全降级为空态,不抛未捕获异常。
- [better-sidebar API 演进(0.16.0 的 features 门控)] → 仅使用 `registerTab` / `badge` / `single` 稳定面;按 `ctx.betterSidebar.features` 门控 badge 等增强能力。
- [compaction 后历史 text 被摘要替换,旧链接从面板消失] → 已消除:基线从完整持久化日志折叠,compaction 只替换模型面,日志仍保留全部事件(2026-09-03 用户实测反馈驱动)。
- [长会话全量扫描一次的开销] → 全量仅一次/会话,增量追尾 + 防抖,采集只保留链接条目不持有全文;host 基线 30s TTL 缓存,面板渐进渲染(先快照后基线),实测见下节。
- [分类误判把链接放进错误类别] → 规则表集中可调;「其他」兜底保证不丢链接;规则函数带单测锁定行为。

## Performance(实测,2026-09-03)

用本机真实会话日志(zstd 解码 + 全量 JSONL parse + 共享纯函数折链接,与 host 基线路径等价)测得**首次基线耗时**:

| 会话规模(zstd → jsonl) | 事件数 | 首次基线总耗时 | 其中折链接 |
|---|---|---|---|
| 0.8MB → 3.8MB(典型会话) | 3,844 | ~30ms | ~10ms |
| 8.4MB → 21.9MB(重型) | 30,955 | ~186ms | ~70ms |
| 29.6MB → 73.2MB(极端长会话) | 114,246 | ~720ms | ~249ms |

结论与设计约束:

- **渐进式渲染**:面板先立即渲染窗口快照,基线异步到达后合并——首开 UI 永远即时响应,大会话只是"稍后补全",不阻塞点击/切换。
- **缓存**:host 侧 30s TTL 缓存(折好的 entries,非 events);命中期间 0 开销,新消息走快照增量;缓存过期后重开需重新全量(极端会话 ~0.7s)。
- **浏览器侧极轻**:最长实测会话仅 84 条链接,渲染微秒级;只持链接条目,不持有消息全文;增量按 seq 水位 + 150ms 防抖。
- **代价边界**:11 万事件级别的极端会话首次基线 ~0.7s,其中 JSON.parse 73MB 会短暂占用 host 主线程 CPU;正常会话(几 MB)30ms 级无感。
- **未来优化方向**(按需,当前不做):host 持久化 entries+watermark 增量折;超大解析移 worker thread;SQLite 存储后端才真正免全文件扫描(zstd/JSONL 后端官方 readFrom 仍全量 parse)。
- **环境注意**:本机日志出现过 `ENOSPC`(磁盘满),会直接影响基线读取稳定性,应先清盘。

## Migration Plan

1. `dsh.yaml` 增加 local 条目(id: session-links)→ `dsh build` 物化 → 重启 DSH 生效。
2. 回滚:manifest 置 `enabled: false`(或删除条目)后 `dsh build`,tab 随 bundle 卸载消失;无数据残留(better-sidebar tab 状态由宿主清理)。

## Open Questions

无(去重/排序/compaction 取舍均已在上文定案,不改变 spec 行为)。