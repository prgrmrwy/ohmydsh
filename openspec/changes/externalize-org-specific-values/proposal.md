## Why

本仓库是公开仓库，但源码与规范里仍硬编码着某个组织的专属值：

- dsh-memex 守门把固定的内网域名与代码托管 host 写死在源码里，scope 派生也用写死的 host 判断「内部库」；
- dsh-session-links 的分类表写死了组织的评审域名与工作项域名，并为此设了一个以产品名命名的分类；
- send-cr skill 依赖组织内部的 MR 读取 CLI，整份 skill 只对该组织有意义。

私有 overlay（change `local-manifest-overlay`、`internal-overlay-repository`）已经能承载不可公开的条目，但上述值埋在公开包内部，overlay 无从替换。结果是：要么公开仓库继续暴露组织信息，要么删掉就丢功能。

## What Changes

- **dsh-memex**：「哪些 host / 域名算内部」改为插件行 `config`（`internalHosts`、`internalDomains`），公开源码不再内置任何组织域名。
  - 未配置时，内部 host/域名规则**无输入**：不拦截，但每次写入显式报告 `structural:internal-host-rule-inactive`，与既有「工作区路径规则无输入」同一处理方式。
  - 私网 IP、拒绝词、工作区路径规则不变。
  - 按 remote 自动派生的库：origin host 在 `internalHosts` 中才派生为内部库，否则为外部。
- **dsh-session-links**：
  - 组织专属的评审域名与工作项域名改为插件行 `config`（`reviewHosts`、`trackerHosts`）。公开默认只认公开平台。
  - 以产品名命名的分类改为中性的「工作项」（`tracker`）。
  - host 在全量基线中下发规则，浏览器端据此分类实时增量，并重分类已采集的链接。
- **send-cr skill** 整体迁出公开仓库（skill、manifest 条目、规范），由私有 overlay 提供，行为不变。
- 私有 overlay 新增一个 patch，按行 id 覆盖上述两个插件行、注入真实值；公开仓库只保留通用逻辑与 `*.example` 占位示例。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-memex-guard`：结构性规则中的内部 host/域名由部署配置提供；未配置时规则显式不生效。
- `dsh-memex-scope`：remote 派生库的发布方向由配置的内部 host 决定。
- `session-links`：分类改为「工作项」，组织域名来自插件配置，规则随基线下发。
- `send-cr-skill`：移出公开仓库（能力整体由私有 overlay 提供）。
- `repo-layout`：公开仓库不得硬编码组织专属的域名、包源、内部工具名；这类值经插件行配置由 overlay 注入。

## Impact

- 代码：`packages/dsh-memex/src/{org.ts,guard,scope,tools,plugin.ts,index.ts}`；`packages/session-links/src/{shared/links.ts,host/extract.ts,contract.ts,client/*,index.ts}`。
- 部署：未接私有 overlay 的机器上，两插件不再识别任何组织域名（memex 会报规则未生效；链接不再出现「工作项」分组）。接了 overlay 的机器行为与之前一致。
- 私有仓库：新增 `patches/org-hosts.yml`、`skills/send-cr/` 与对应 manifest 条目。
- 兼容：session-links 基线新增可选字段 `rules`，旧 host 不带该字段时按公开默认处理。
