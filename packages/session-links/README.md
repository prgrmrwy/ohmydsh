# dsh-session-links · 文档/资料面板

better-sidebar 右侧工作台「文档/资料」tab:自动收集**当前会话**消息中的 URL 与产出的文件,按 **MR / 部署 / Meego / 产物制品 / 其他** 分类展示,随会话切换联动,tab 徽标显示链接计数。

纯浏览器插件:无 host 能力、无网络外呼、不读写凭据、不持久化(刷新后对当前会话重建一次采集)。

## 依赖与安装

- 宿主:`dsh-better-sidebar`(^0.16.0)——client 入口 `inject = ['betterSidebar', ...]`,宿主缺失/禁用时插件整体不激活。
- 数据:`@deepseek-ai/dsh-client-runtime` 的会话列表与 conversation snapshot(`ctx.sessions.binding(id).session`)。
- 安装:`dsh.yaml` 增加 local 条目后 `dsh build`,重启 DSH。

## 行为

- **采集范围**:user / assistant / steering / context 消息;assistant 仅正文 text 块(reasoning 与 tool-call 载荷不采集);tool-result、compaction 等节点跳过。
- **分类规则**:集中维护于 `src/client/links.ts` 的 `CATEGORY_RULES`(域名 + 路径/查询特征);未知 URL 进「其他」,绝不丢弃。
- **增量**:每会话至多一次全量扫描,之后按消息 `seq` 水位只处理新消息;`loadOlder` 追加的旧消息不重复采集。
- **去重与排序**:同 URL 去重保留最近一次出现并计数;组内按最近出现时间倒序,同时间 assistant 优先。
- **展示**:分类分组 + 标题(host + 路径摘要)+ 相对时间 + 重复次数;点击在新标签页打开,不注入脚本。
- **降级**:快照结构变化、宿主缺失、无当前会话均安全降级为空态,不影响其余 tabs。

## 开发

```bash
npm install          # 仓库根,workspaces 装依赖
npm run typecheck    # tsc host + client
npm test             # vitest:links/collector
npm run build        # host(tsc)+ client(tsdown) -> lib/
```

## 设计取舍

- 刷新/重开 tab 后链接集在浏览器内存中按需重建,不持久化(会话数据本体由 DSH 持久化)。
- compaction 后历史消息被摘要替代,面板为「当前快照所见」语义,不引 host 侧日志查询。
- 规则表扩展只需改 `CATEGORY_RULES` 并同步测试。