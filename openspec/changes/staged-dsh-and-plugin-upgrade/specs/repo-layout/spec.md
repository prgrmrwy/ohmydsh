## MODIFIED Requirements

### Requirement: 自研 package 的运行体 peer 声明跟随 manifest 版本族
仓库内 local package 对运行体包(`@deepseek-ai/dsh-*`)的 `peerDependencies` 声明必须(SHALL)与 `dsh.yaml` 所 pin 的 `dshVersion` 属于同一版本族,并采用与上游自身一致的范围写法。此类 peer 不得(SHALL NOT)使用精确版本 pin:精确 pin 在运行体升级后可能解析出第二份同名包,造成同一模块的双实例。仓库必须(SHALL)提供一项自动检查,在任一 local package 的运行体 peer 声明偏离当前 `dshVersion` 版本族时失败,并指出具体的 package、依赖名与实际声明。非运行体依赖(如 `react`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`)不受本要求约束。

`dshVersion` 与各 local package 的运行体 peer 声明必须(SHALL)作为**同一批次**变更:二者构成一个必须一致的整体,因此运行体升级不得(SHALL NOT)在未同步更新 peer 声明的情况下被视为完成。该检查在版本族迁移期间失败是**预期的前置门槛**,而非缺陷——它标示本批次尚未完成,不得(SHALL NOT)通过放宽检查、豁免个别 package 或临时跳过来"修复"。

当上游在新版本族中**移除或拆分**了某个运行体包时,对该包的 peer 声明不得(SHALL NOT)被机械改写为新版本族的同名声明。此种情形必须(SHALL)被识别为接口面迁移:该 peer 必须(SHALL)改为声明其在新版本族中的实际承接包,或在该 local package 不再依赖该接口面时移除。

#### Scenario: 运行体升级后声明未跟进
- **WHEN** `dshVersion` 升级到新版本族,而某 local package 的 `@deepseek-ai/dsh-*` peer 仍声明旧版本族
- **THEN** 仓库检查失败,并指出该 package、依赖名与实际声明

#### Scenario: 拒绝精确 pin
- **WHEN** 某 local package 以精确版本(而非范围)声明运行体包 peer
- **THEN** 仓库检查失败,要求改为跟随版本族的范围写法

#### Scenario: 声明已对齐
- **WHEN** 全部 local package 的运行体 peer 均处于当前 `dshVersion` 版本族且均为范围写法
- **THEN** 仓库检查通过,且不对非运行体依赖提出要求

#### Scenario: 版本族迁移期间的失败不得被绕过
- **WHEN** `dshVersion` 已升级到新版本族,而部分 local package 的 peer 声明尚未同步,检查因此失败
- **THEN** 该失败 SHALL 被视为本批次未完成的前置门槛,MUST NOT 通过放宽检查、豁免个别 package 或跳过该检查来消除

#### Scenario: 上游移除的运行体包不得被机械改写
- **WHEN** 某运行体包在新版本族中已被移除或拆分,而某 local package 仍对其声明 peer
- **THEN** 该声明 SHALL 改为其在新版本族中的实际承接包,或在不再依赖该接口面时移除,MUST NOT 被改写为该包在新版本族下的同名声明
