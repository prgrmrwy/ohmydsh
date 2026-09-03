# session-links-panel Tasks

## 1. 包脚手架与 manifest

- [x] 1.1 创建 `packages/session-links/`(npm 名 `dsh-session-links`),复制本仓 local package 范式:tsdown 双半区构建、`tsconfig.json` + `tsconfig.client.json`、`vitest.config.ts`、`cordis.patch.yml`、LICENSE/README 骨架
- [x] 1.2 `package.json`:`dsh.client.platform: web`、`dsh.client.inject` 含 `betterSidebar`(cordis 服务注入门禁——宿主缺失时插件整体不激活,参照 `dsh-sidebar-qa` 同款范式)、exports(`./client`)、peer 依赖(`dsh-better-sidebar ^0.16.0`、`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/cordis`、`react`),devDependencies 补 types/vitest/tsdown
- [x] 1.3 `cordis.patch.yml` 把 client bundle 插入 profile bundle 栈(参照 `sidebar-session-provider-icon/cordis.patch.yml` 的接线方式)
- [x] 1.4 `dsh.yaml` 增加 local 条目 `session-links`(brief/note 含宿主依赖与 DSH 版本兼容说明),`node scripts/sync.mjs` 物化,连续二次运行确认幂等

## 2. 链接提取与分类器(纯函数 + 单测)

- [x] 2.1 实现 `extractUrlsFromText(text): string[]`(URL 正则,含 http/https,处理 markdown 链接括号场景与行尾标点),单测覆盖常规链接/链接文本/带括号 URL/多链接一行
- [x] 2.2 实现 `classifyUrl(url): 'mr' | 'deploy' | 'meego' | 'artifact' | 'other'` 与集中规则表(域名白名单 + MR/PR/merge_request、deploy、artifact 等路径/查询特征;meego 域名;未知进 other 不丢弃),单测逐类别 + 未知名平台用例
- [x] 2.3 实现 `collectLinks(messageNodes): LinkEntry[]`(仅消费 text 块:user/steering/context 全 text,assistant 仅 `kind:'text'` 排除 reasoning/tool-call;同 URL 去重保留最近一次,记出现次数),单测覆盖助手文本/推理排除/工具调用排除/去重

## 3. 会话数据订阅与采集器

- [x] 3.1 实现面板数据层:per-session `LinkStore`(`Map<sessionId, LinkEntry[]>`,内存态),按消息 `seq` 水位增量追尾,每会话至多一次全量扫描,不持有消息全文
- [x] 3.2 订阅当前会话 conversation snapshot(经官方 runtime 面 `ctx.sessions`/hook),解析 user/assistant/steering/context 节点喂给 `collectLinks`;新消息到达即增量更新,渲染更新防抖合并
- [x] 3.3 会话切换联动:切换时停止旧会话订阅、清空旧链接集并重建当前会话;组件卸载移除全部订阅与 DOM 残留
- [x] 3.4 单测:增量不重扫历史、切换会话清空重建、防抖合并、空会话空态

## 4. 面板 UI(registerTab)

- [x] 4.1 注册 `ctx.betterSidebar.registerTab`:`id: 'session-links'`、标题「会话链接」、`single: true`、`order` 置于「+」菜单合理位置;组件用 `TabComponentProps`(ctx/scope)连接采集器
- [x] 4.2 渲染:按类别分组(mr/deploy/meego/artifact/other 中文标签),组内按时间倒序且同时间 assistant 优先,条目展示 host+路径摘要、相对时间、出现次数;无链接显示空态
- [x] 4.3 打开行为:点击链接 `target="_blank"` 新标签打开,不注入脚本;入站无任何网络请求
- [x] 4.4 徽标:已实现并经实机验证;2026-09-03 用户决定暂不展示(badge 不随 store 变化主动刷新,见 8.x),从 registerTab 移除 `badge` 字段,`countOf` 保留供将来复启

## 5. 结构健壮性与降级

- [x] 5.1 官方数据/类型缺失或结构变化时安全降级为空态/不渲染,不抛未捕获异常、不影响其余 tabs(参照 `session-title-copy` 的降级范式)
- [x] 5.2 better-sidebar 宿主缺失(D-1 依赖不可用)时注册整体跳过,插件其余行为无副作用

## 6. 构建与验收

- [x] 6.1 `npm run typecheck` / `npm test` / `npm run build`(packages/session-links 内)全绿,输出 `lib/` 不入库
- [x] 6.2 仓库级 `npm test` + `node scripts/sync.mjs` + `npm run check:artifacts` 通过
- [x] 6.3 实机验证:重启 DSH 后「+」菜单出现会话链接 tab;构造含 MR/部署/meego/制品/未知链接的会话,逐条核对分类、排序、去重、badge、切换会话清空重建、关闭 tab 无残留
- [x] 6.4 按验收结果回读 spec(openspec/specs/session-links/spec.md),确认行为一致后归档 change
## 7. 完整会话基线(host 全量日志,H2 实测反馈)

- [x] 7.1 `links.ts` 迁移至 `src/shared/`(host/client 共用);`contract.ts` 定义 `/dsh-session-links` `links` 端点契约
- [x] 7.2 host 半区:经 `SessionPersistence.readFrom(id, 0)` 完整日志折出基线(共享纯函数 `extractLinksFromEvents`,user/assistant text 仅顶层、reasoning/tool 排除、去重计数、seq/time/role),注册 loopback RPC + 30s TTL 缓存,业务失败一律 RpcResult 不抛
- [x] 7.3 client `SessionLinksState.applyBaseline`:基线幂等、水位跳转、与快照增量合并(计数续接);失败静默降级窗口语义
- [x] 7.4 Panel 打开/切会话时异步拉取基线,RPC 失败或组件已卸载时无副作用
- [x] 7.5 单测:events→entries(角色/时间/seq/去重/排除)、基线幂等与水位合并、release 后基线 no-op;共 41 用例全绿;typecheck + build 通过;部署验证 profile 与 packages 一致

## 8. 产物展示与 badge 按用户反馈修订(2026-09-03)

- [x] 8.1 `src/client/produces.ts`:从 `ToolResultNode.callView` 按官方 deliverables 同款判定(diff 卡 / generic kind=edit 的 locations)提取产出文件,失败与 read/delete/search 类排除;`compareProduced` 排序
- [x] 8.2 collector 收集产物:ingest 时对 tool-result 节点按路径首次出现去重,稳定投影 `producedOf`
- [x] 8.3 Panel:新增「本次产出」分组(置顶),文件名 + 时间,点击经 `onOpenFile` 在 better-sidebar 工作台打开;宿主无打开面时降级纯文本
- [x] 8.4 移除 tab badge(用户决定暂不展示);`countOf` 保留
- [x] 8.5 单测:producedFromNode 判定矩阵 + collector first-seen 去重;46 用例全绿;typecheck + build + 部署验证通过

## 9. host 产物基线(2026-09-03,用户实测 6→24 条反馈驱动)

- [x] 9.1 shared/produced.ts:ProducedFile 统一类型 + PresentCall 桥接面 + compareProduced
- [x] 9.2 host extract 重构为 extractSession(一次遍历折链接+产物):产物经 ctx.tools.get(name).presentCall(args) 复刻官方 render-intent 判定(diff 卡 / generic kind=edit 的 locations、diffs 兜底),失败结果按 callId 撤销,presenter 抛错软落;链接逻辑不变
- [x] 9.3 contract/host RPC 响应增加 produced 数组;client applyBaseline 同步合并(first-seen 保留,窗口快照增量续接)
- [x] 9.4 单测:extractSession produced 判定矩阵(失败撤销/首次保留/presenter 软落)、baseline produced 合并;53 用例全绿;typecheck + build + 部署一致 + sync 幂等
