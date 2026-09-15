## Purpose

定义跨库写入的守门能力：只在一个方向、一个时机生效——业务 scope 向 `personal` 库写入
之前。泄漏方向是不对称的（业务内容进入推往 GitHub 的个人库不可逆；反之基本无害），
本能力只拦不可逆的那一侧。

本能力同时明确自身的**能力边界**：它拦的是可模式化的标识与结构，拦不住语义层面的业务
信息。守门的定位是**减少误写**，不是保证不泄漏；真正的保证来自跨库卡片必须去业务化
重写，以及人对 personal 库的定期复核。

## ADDED Requirements

### Requirement: 守门只作用于写 personal 之前

`CrossWriteGuard` SHALL 仅在 `memory_retro` 处理 `alsoPersonal` 时生效。当前 scope 的
主卡写入 MUST NOT 经过守门，business scope 之间的写入 MUST NOT 存在（因此无需守门）。
守门的输入 SHALL 为待写入卡片的 slug、title 与 body 全文。

#### Scenario: 主卡不受守门影响
- **WHEN** 在 nexus 会话中写入一张正文含 `byted` 字样的主卡
- **THEN** 主卡正常写入 nexus 库，不被拒绝

#### Scenario: 守门扫描全文
- **WHEN** 业务标识只出现在 `alsoPersonal` 的 body 而非 title
- **THEN** 守门仍然命中并拒绝

### Requirement: 拒绝词默认由 scope 名自动派生

`denyTerms` SHALL 默认由已配置的 scope 名自动派生——存在 `nexus` scope 时 `nexus`
自动进入拒绝词。系统 MUST NOT 要求人工维护第二份与 scope 表平行的清单。配置 SHALL
提供 `allowTerms` 用于显式豁免恰好也是通用技术名词的词条。

#### Scenario: 新增业务 scope 自动获得拒绝词
- **WHEN** 配置中新增 scope `foo`
- **THEN** `foo` 自动成为拒绝词，无需额外配置

#### Scenario: allowTerms 豁免
- **WHEN** 某个自动派生的词条被列入 `allowTerms`
- **THEN** 该词条不再触发拒绝

### Requirement: 内置结构性泄漏规则

除派生词条外，守门 SHALL 内置结构性规则：内网域名与内网 IP 段、公司仓库 remote 形态
（如 `code.byted.org:*`）、含 `~/corp/` 的工作区绝对路径。这些规则 SHALL 不可被
`allowTerms` 关闭。

#### Scenario: 内网域名触发拒绝
- **WHEN** `alsoPersonal` 正文含公司内网域名
- **THEN** 守门拒绝该条写入

#### Scenario: 工作区绝对路径触发拒绝
- **WHEN** `alsoPersonal` 正文含 `~/corp/nexus/...` 形式的路径
- **THEN** 守门拒绝该条写入

### Requirement: 凭据防护沿用上游实现

系统 SHALL 沿用上游 memex 的 `sensitive-input` 承担凭据类防护（明文密钥拒绝、URL
内嵌凭据 redact、`Authorization` 头屏蔽、凭据文件路径识别），MUST NOT 重复实现一套
等价的正则。本能力只补上游不具备的业务标识与结构规则。

#### Scenario: 凭据由上游拦截
- **WHEN** `alsoPersonal` 正文含高置信度明文密钥
- **THEN** 由 memex CLI 拒绝或 redact，本插件不重复实现该规则

### Requirement: 拒绝时保留主卡并说明原因

守门拒绝时系统 SHALL 保留已写入的主卡，MUST NOT 回滚——主卡写在业务库中本身是正确
且安全的，回滚只会丢失有效记忆。返回结果 SHALL 明确给出被拒的跨库条目、命中的规则，
使模型能在同一轮内重写重试。

#### Scenario: 拒绝返回命中规则
- **WHEN** `alsoPersonal` 命中派生词条 `nexus`
- **THEN** 返回结果标明该条目被拒、命中规则为 `nexus`，主卡已写入

#### Scenario: 模型可当轮重试
- **WHEN** 模型收到拒绝原因后改写为去业务化表述并重新调用
- **THEN** 新条目通过守门并写入 personal 库

### Requirement: 守门 fail closed

任何不确定状态 SHALL 导致拒绝，而不是放行：守门规则文件损坏、scope 解析失败、规则
加载异常，均 SHALL 拒绝 `alsoPersonal` 的写入。系统 MUST NOT 在无法判定时默认放行。

#### Scenario: 规则损坏时拒绝
- **WHEN** 守门规则配置无法加载
- **THEN** `alsoPersonal` 写入被拒绝，主卡仍正常保存

### Requirement: 审计记录不含正文

守门每次拒绝 SHALL 写入一条本地审计记录，包含时间、scope、slug 与命中规则。审计记录
MUST NOT 包含卡片正文、title 全文或任何被判定为敏感的内容——记录正文等同于把敏感
内容又落到 personal 侧。

#### Scenario: 审计不含正文
- **WHEN** 一次 `alsoPersonal` 被拒绝
- **THEN** 审计记录含时间、scope、slug、命中规则，不含 title 与 body

### Requirement: 能力边界须明确声明

本能力的规格与对外文档 SHALL 明确声明：守门拦的是可模式化的标识与结构，**不能拦截
语义层面的业务信息**（例如不含任何关键词的内部系统故障模式）。因此守门 SHALL 被表述
为「减少误写」，MUST NOT 被表述为「保证不泄漏」。与之配套的保证 SHALL 是：跨库卡片
必须去业务化重写，且人对 personal 库新增卡片定期复核。

#### Scenario: 文档不作过度承诺
- **WHEN** 阅读本能力规格或插件说明
- **THEN** 其中明确写明守门不保证不泄漏，并指出去业务化重写与人工复核是配套保证
