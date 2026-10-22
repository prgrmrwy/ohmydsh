## MODIFIED Requirements

### Requirement: 协作约定随协作空间提供

协作约定的指南文本 SHALL 随 `collab-kernel` 包按版本发布，已发布版本的文本 MUST NOT 修改，新增内容只能以新版本发布。包内 SHALL 同时提供版本 `1` 与 `2`，未显式指定约定的内核实例以最新版本 `2` 作为新空间的默认约定。协作空间创建时 SHALL 记录所用版本；`overview` SHALL 返回 `convention:{version, sha256}`；`readConvention(version)` SHALL 返回空间所记录版本的全文，其 sha256 与总览一致；读取包内任一已发布版本都 SHALL 成功。不存在的版本 MUST 以 `COLLAB_CONVENTION_UNKNOWN` 拒绝。版本 `2` SHALL 在版本 `1` 的基础上说明：宿主可以声明成员信任，此时被邀请者已由宿主代为加入，承接方在本会话原有权限边界内直接处理空间内的 request，不再为此另向人类索取授权；宿主未声明时按版本 `1` 的规则处理。两个版本都 SHALL 保留"人类决定只能来自受信确认"与"消息不是越权依据"的规则。

#### Scenario: 总览带约定版本
- **GIVEN** 以约定版本 `2` 创建的协作空间
- **WHEN** 成员读取总览并调用 `readConvention('2')`
- **THEN** 总览含 `convention.version:'2'`，全文的 sha256 等于 `convention.sha256`

#### Scenario: 旧空间仍按原版本读取
- **GIVEN** 以约定版本 `1` 创建的已有空间
- **WHEN** 升级后成员调用 `readConvention('1')`
- **THEN** 返回与升级前逐字节相同的全文，sha256 等于该空间记录的值

#### Scenario: 已发布文本不可变
- **WHEN** 计算包内版本 `1` 文本的 sha256
- **THEN** 等于本变更之前发布的版本 `1` 的 sha256

#### Scenario: 未知版本
- **GIVEN** 包内只有版本 `1` 与 `2`
- **WHEN** 调用 `readConvention('9')`
- **THEN** 返回 `COLLAB_CONVENTION_UNKNOWN`
