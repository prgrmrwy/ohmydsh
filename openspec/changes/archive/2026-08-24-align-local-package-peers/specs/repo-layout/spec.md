## ADDED Requirements

### Requirement: 自研 package 的运行体 peer 声明跟随 manifest 版本族
仓库内 local package 对运行体包(`@deepseek-ai/dsh-*`)的 `peerDependencies` 声明必须(SHALL)与 `dsh.yaml` 所 pin 的 `dshVersion` 属于同一版本族,并采用与上游自身一致的范围写法。此类 peer 不得(SHALL NOT)使用精确版本 pin:精确 pin 在运行体升级后可能解析出第二份同名包,造成同一模块的双实例。仓库必须(SHALL)提供一项自动检查,在任一 local package 的运行体 peer 声明偏离当前 `dshVersion` 版本族时失败,并指出具体的 package、依赖名与实际声明。非运行体依赖(如 `react`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`)不受本要求约束。

#### Scenario: 运行体升级后声明未跟进
- **WHEN** `dshVersion` 升级到新版本族,而某 local package 的 `@deepseek-ai/dsh-*` peer 仍声明旧版本族
- **THEN** 仓库检查失败,并指出该 package、依赖名与实际声明

#### Scenario: 拒绝精确 pin
- **WHEN** 某 local package 以精确版本(而非范围)声明运行体包 peer
- **THEN** 仓库检查失败,要求改为跟随版本族的范围写法

#### Scenario: 声明已对齐
- **WHEN** 全部 local package 的运行体 peer 均处于当前 `dshVersion` 版本族且均为范围写法
- **THEN** 仓库检查通过,且不对非运行体依赖提出要求
