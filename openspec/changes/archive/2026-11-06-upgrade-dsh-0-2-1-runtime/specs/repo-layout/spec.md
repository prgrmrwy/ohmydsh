## MODIFIED Requirements

### Requirement: 自研 package 的运行体 peer 声明跟随 manifest 版本族
仓库内 local package 的运行体兼容声明必须(SHALL)是一个显式区间,而不是跟随 `dshVersion` 的 caret 范围。凡声明了任一 `@deepseek-ai/dsh-*` peer 的 local package,必须(SHALL)同时声明 `engines.dsh`,形如 `>=<下界> <<major>.<minor+1>.0-0`;它的每个 `@deepseek-ai/dsh-*` peer 必须(SHALL)恰好是 `<engines.dsh> || ^<dshVersion>`,且必须(SHALL)有同名 devDependency。

peer 的 `|| ^<dshVersion>` 尾段是当前 pin 的子集,在 DSH 含预发布的匹配语义下不改变判定结果;它存在只是因为 npm 按标准 semver 校验 workspace peer,否则 npm 会拒绝把预发布运行体 hoist 到仓库根,在各 package 下嵌套重复副本,而嵌套副本会越过 worktree 解析到外层 checkout 的旧版本。缺少同名 devDependency 的 peer 会被 npm 按标准语义自动安装,可能装成旧运行体。区间本身需满足:

- 下界必须(SHALL)是该 package 已有实测证据可运行的最低 DSH 版本,且不高于 `dsh.yaml` 的 `dshVersion`;
- 上界必须(SHALL)是下一个 minor 的 `-0` 形式(例如 `<0.3.0-0`)。DSH 按含预发布的语义匹配范围,`<0.3.0` 会接纳 `0.3.0-rc.*`,因此不得(SHALL NOT)使用;也不得(SHALL NOT)省略上界;
- 当前 `dshVersion` 必须(SHALL)在含预发布语义下满足该范围。

两字段必须语义一致,是因为 DSH 0.2.1 起声明了 `engines.dsh` 时只看它,0.2.0 只看 peer;两者不一致会让同一个包在不同运行体上得到不同的兼容结论。

local package 的 `@deepseek-ai/dsh-*` devDependencies 必须(SHALL)等于 `^<dshVersion>`,保证按当前 pin 构建与类型检查。任何运行体依赖都不得(SHALL NOT)使用精确版本 pin:精确 pin 在运行体升级后可能解析出第二份同名包,造成同一模块的双实例。

仓库必须(SHALL)提供一项自动检查,在任一 local package 违反上述任一条时失败,并指出具体的 package、字段、依赖名与实际声明。非运行体依赖(如 `react`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`)不受本要求约束。

`dshVersion` 升级与 devDependencies、兼容区间的复核必须(SHALL)作为**同一批次**变更。新 `dshVersion` 超出某 package 的区间时,检查失败是**预期的前置门槛**,不得(SHALL NOT)通过放宽检查、豁免个别 package 或临时跳过来"修复";要么以实测证据扩大区间,要么推迟升级。

当上游在新版本族中**移除或拆分**了某个运行体包时,对该包的 peer 声明不得(SHALL NOT)被机械改写为新版本族的同名声明。此种情形必须(SHALL)被识别为接口面迁移:该 peer 必须(SHALL)改为声明其在新版本族中的实际承接包,或在该 local package 不再依赖该接口面时移除。

#### Scenario: 运行体升级后声明未跟进
- **WHEN** `dshVersion` 升级到某 local package 兼容区间之外的版本
- **THEN** 仓库检查失败,并指出该 package、字段与实际声明

#### Scenario: 声明已对齐
- **WHEN** 全部 local package 的 `engines.dsh` 与 dsh peer 同值、区间合法且包含当前 `dshVersion`,devDependencies 等于 `^<dshVersion>`
- **THEN** 仓库检查通过,且不对非运行体依赖提出要求

#### Scenario: 运行体升级仍在兼容区间内
- **WHEN** `dshVersion` 从 `0.2.0-rc.2` 升到 `0.2.1-rc.5`,某 package 的 `engines.dsh` 为 `>=0.2.0-rc.2 <0.3.0-0`,devDependencies 与 peer 尾段已随 pin 改为 `^0.2.1-rc.5`
- **THEN** 该 package 的检查通过,`engines.dsh` 与兼容下界无需改写

#### Scenario: engines.dsh 与 peer 不一致
- **WHEN** 某 local package 的某个 `@deepseek-ai/dsh-*` peer 不等于 `<engines.dsh> || ^<dshVersion>`,或声明了 dsh peer 却没有 `engines.dsh`,或某个 dsh peer 没有同名 devDependency
- **THEN** 仓库检查失败

#### Scenario: 上界写成会接纳下一 minor 预发布的形式
- **WHEN** 某 local package 的区间上界为 `<0.3.0` 或没有上界
- **THEN** 仓库检查失败,要求改为 `<0.3.0-0`

#### Scenario: 拒绝精确 pin
- **WHEN** 某 local package 以精确版本声明运行体包的 peer、devDependency 或 dependency
- **THEN** 仓库检查失败

#### Scenario: 版本族迁移期间的失败不得被绕过
- **WHEN** `dshVersion` 已升级,而某 local package 的 `@deepseek-ai/dsh-*` devDependency 仍为旧的 `^<旧版本>`,或新版本超出其兼容区间,检查因此失败
- **THEN** 该失败 SHALL 被视为本批次未完成的前置门槛,MUST NOT 通过放宽检查、豁免个别 package 或跳过该检查来消除;扩大区间必须有实测证据

#### Scenario: 上游移除的运行体包不得被机械改写
- **WHEN** 某运行体包在新版本族中已被移除或拆分,而某 local package 仍对其声明 peer
- **THEN** 该声明 SHALL 改为其在新版本族中的实际承接包,或在不再依赖该接口面时移除,MUST NOT 被改写为该包在新版本族下的同名声明
