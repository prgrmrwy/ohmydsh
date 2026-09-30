## MODIFIED Requirements

### Requirement: 链接按类别归组
系统 SHALL 将采集到的链接归入以下类别:MR(合并请求链接,含 git 平台 MR/PR 与 merge_request 特征)、部署(部署/发布平台链接)、工作项(部署配置的工作项平台域名)、产物制品(制品/包/下载物平台链接)、其他(未命中以上特征的链接)。无法归入前四类的链接必须进入「其他」,不得丢弃。规则判定基于 URL 的 host 与路径/查询特征,并 SHALL 集中维护、可扩展。

公开源码 SHALL 只内置公开平台的特征。组织专属的评审域名与工作项域名 SHALL 来自插件行 `config`(`reviewHosts`、`trackerHosts`,均含子域名),MUST NOT 硬编码在源码中;无法识别为 host 名的条目 SHALL 被丢弃。host 端 SHALL 在全量基线中下发这份规则;浏览器端 SHALL 校验后采用,用于实时增量,并重分类在基线到达前已采集的链接,使两端分类一致。

#### Scenario: MR 特征命中
- **WHEN** 链接 host/路径/查询含 MR、PR 或 merge_request 特征,且 host 为公开评审平台或配置的评审域名
- **THEN** 链接归入「MR」类别

#### Scenario: 工作项命中
- **WHEN** 部署配置工作项域名 `tracker.corp.example`,链接 host 为该域名或其子域名
- **THEN** 链接归入「工作项」类别

#### Scenario: 未配置时不认识组织域名
- **WHEN** 部署未配置任何组织域名,链接指向 `tracker.corp.example`
- **THEN** 链接归入「其他」类别并正常展示

#### Scenario: 基线规则重分类已采集链接
- **WHEN** 浏览器端已按公开默认把某链接归入「其他」,随后收到的基线规则把其 host 列为工作项域名
- **THEN** 该链接改归「工作项」,之后的增量也按该规则分类

#### Scenario: 未知名平台落入其他
- **WHEN** 链接 host 与路径不匹配任何已知类别特征
- **THEN** 链接归入「其他」类别并正常展示
