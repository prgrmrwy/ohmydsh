## MODIFIED Requirements

### Requirement: 内置结构性规则，且路径规则不得硬编码

除派生词条外，守门 SHALL 内置结构性规则：内网 IP 段、内部代码托管 host 上的仓库 remote 形态、内部域名（含子域名），
以及**指向内部 scope 工作区的绝对路径**。这些规则 SHALL 始终生效，MUST NOT 提供关闭开关。

内部代码托管 host 与内部域名 SHALL 由部署配置提供（插件行 `config` 的 `internalHosts`、`internalDomains`），
MUST NOT 硬编码在源码中：公开源码无从知道哪些域名属于某个组织，硬编码既泄漏组织信息，又对其他组织是永不命中的空规则。
配置中无法识别为 host 名的条目 SHALL 被丢弃并记录日志，MUST NOT 被猜测或部分匹配。

工作区路径规则 MUST NOT 硬编码某个固定目录前缀：系统 SHALL 由已知内部 scope 的实际工作区
路径派生该规则。硬编码前缀在实际布局与其不符时会成为**永不命中的空规则**，使一条声称不可
关闭的安全规则实际失效。

当某条规则缺少输入——内部 scope 的工作区路径集为空，或未配置任何内部 host 与内部域名——
系统 SHALL 在返回中显式告警该规则未生效，MUST NOT 静默按通过处理。

#### Scenario: 内网域名触发拒绝
- **WHEN** 部署配置了内部域名 `corp.example`，待写入卡片正文含 `wiki.corp.example`
- **THEN** 守门拒绝该条写入

#### Scenario: 内部 remote 触发拒绝
- **WHEN** 部署配置了内部 host `git.corp.example`，待写入卡片正文含该 host 上的 scp、ssh 或 https 形态 remote
- **THEN** 守门拒绝该条写入

#### Scenario: 域名按标签边界匹配
- **WHEN** 内部域名为 `intra.example`，待写入卡片正文仅含 `notintra.example`
- **THEN** 该文本 MUST NOT 命中内部域名规则

#### Scenario: 未配置内部 host 时规则告警不生效
- **WHEN** 部署未配置任何内部 host 与内部域名
- **THEN** 内部 remote/域名规则不拒绝任何写入，且返回告警 `structural:internal-host-rule-inactive`

#### Scenario: 工作区绝对路径触发拒绝
- **WHEN** 待写入卡片正文含某内部 scope 工作区的绝对路径
- **THEN** 守门拒绝该条写入

#### Scenario: 路径规则随实际工作区派生
- **WHEN** 内部 scope 的工作区位于任意目录布局下
- **THEN** 该布局的路径形态即进入结构性规则，不依赖任何预设的固定前缀

#### Scenario: 路径证据为空时告警
- **WHEN** 某内部 scope 的工作区路径集为空
- **THEN** 系统告警该规则对其未生效，而不是静默放行
