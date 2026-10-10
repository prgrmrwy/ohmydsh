# dsh-session-links

[English](README.md) · 简体中文

<!-- problem -->
在很长的 Agent 对话里，你要找的合并请求、部署页面、工单或制品链接早已淹没在上文，Agent 写出的文件同样不好找。这个插件把它们收集到当前会话的一个侧边面板里，按类别分组，一点就能打开。

![示意图：长对话中的链接被收集到一个按类别分组的「文档/资料」面板](docs/overview.png)

**安装。** 通过 `dsh.yaml` 管理（条目 `session-links`，`source: local`）：设为 `enabled: true`，运行 `dsh build`，然后重启 DSH。它依赖第三方 `better-sidebar` 插件（`dsh-better-sidebar`，peer `>=0.16.0`，可选）：没有它时本插件完全不激活。设计见 OpenSpec change `session-links-panel`。

## 行为

面板是 `better-sidebar` 的工作台 tab，id 为 `session-links`，界面上的名称是**文档/资料**。它是单实例，跟随当前会话，并把找到的内容分成：

- **链接**，固定顺序：MR、部署、工作项、产物制品、其他。组内按出现时间倒序，同一时间 assistant 来源的链接优先于其他来源。每条显示可读标题（host 加路径摘要）、相对时间和重复次数；点击在新标签页打开 URL，不注入任何脚本。
- **本次产出**：会话中成功写入或编辑的文件。读取、删除和失败的调用不算，同一文件先写后改只保留一条。点击会在侧边栏编辑器中打开；相对路径按会话的工作目录解析。

采集范围：user、assistant、steering、context 消息。assistant 消息只扫描可见的 text 块，不含 reasoning 和 tool-call 载荷；tool-result、compaction 等节点会跳过。重复的 URL 会合并，保留最近一次出现并计数。

数据怎么来：

- **整份日志基线。** host 半区注册只读的 `/dsh-session-links` Connection RPC 通道（端点 `links`），通过 `sessionPersistence` 读取该会话完整的持久化事件日志，所以被“加载更多”折叠或被 compaction 替换掉的历史链接依然能显示。结果按会话缓存 30 秒。
- **增量。** 基线之后，浏览器半区只处理超过单调 `seq` 水位的新消息，每个会话最多完整扫描一次。重复应用基线不会重复计数。
- **规则。** 分类集中在一张有序规则表里，即 `src/shared/links.ts` 的 `CATEGORY_RULES`（先匹配者生效；不匹配的 URL 进“其他”，绝不丢弃）。它识别公开平台（`gitlab`、`github`、`bitbucket`、`gitee` 域名），以及部署和制品链接的 host、路径、查询特征。扩展规则就是改这张表并同步测试。

## 配置

组织专属的域名属于配置，不属于源码。写在插件行的 `config` 里，通常经由私有 overlay 的 patch 覆盖本插件行：

```yaml
- id: session-links
  name: dsh-session-links
  config:
    reviewHosts: [git.corp.example]      # 额外的 MR/PR 域名（含子域名）
    trackerHosts: [tracker.corp.example] # 归入“工作项”的域名（含子域名）
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `reviewHosts` | `[]` | 公开平台之外额外的代码评审域名 |
| `trackerHosts` | `[]` | 其链接归为工作项的域名；未配置时“工作项”分组为空 |

条目会转成小写、去空白并按主机名格式校验，非法条目被丢弃。host 把这些规则连同基线一起下发给浏览器，两边分类一致。

## 边界与安全

- 只读且纯本地。不向外发网络请求，不用 CDN，不读写凭据。唯一的流量是浏览器到 host 的 Connection RPC，该通道仍处于仅限 loopback 的 Connection 围栏之内。
- 不持久化任何内容。刷新后会为当前会话重建一次集合。面板展示的是当前快照与日志里有的内容，而不是 host 侧的查询历史。
- 快照结构变化、host 缺失或没有当前会话时，安全降级为空态；host 基线失败时，面板仍显示实时快照里可见的链接。其他 tab 不受影响。
- 采集过程不修改官方会话数据，只保留提取出的条目，不保留消息正文。

## 开发

在仓库根目录运行：

```sh
npm install
npm run typecheck --workspace dsh-session-links   # tsc host + client
npm test --workspace dsh-session-links            # vitest：links / collector / extraction
npm run build --workspace dsh-session-links       # host (tsc) + client (tsdown) -> lib/
```
