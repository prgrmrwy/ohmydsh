## ADDED Requirements

### Requirement: 定制项可声明环境变量覆盖有效启用状态

manifest 中每项定制可(MAY)声明可选字符串字段 `enabledEnv`,取值必须(SHALL)匹配大写 `DSH_` 前缀环境变量命名约定(`^DSH_[A-Z0-9_]+$`),否则 sync 必须(SHALL)在加载阶段报错并以非零退出码结束,不产生任何物化动作。

声明了 `enabledEnv` 的定制,其**有效启用状态**必须(SHALL)按以下规则计算:同名环境变量存在且非空白时,按真值(`1`/`true`/`yes`/`on`,大小写不敏感)与假值(`0`/`false`/`no`/`off`,大小写不敏感)判定,命中即以该判定结果作为有效启用状态;环境变量未设置、为空白,或取值无法归入真假两类中任一类时,必须(SHALL)完全回退到该定制自身的 `enabled` 字段(未声明 `enabled` 时按 `true`)。未声明 `enabledEnv` 的定制不受本要求影响,行为与既有 `enabled` 语义完全一致。

该覆盖只影响 sync 计算出的有效启用状态,不得(SHALL NOT)改写仓库中 manifest `enabled` 字段的记录值,也不改变"禁用不删除仓库内容"的既有可逆语义。下游物化(package 安装/移除、preset/skill 复制/清理、patch 片段合并)必须(SHALL)统一使用折算后的有效状态,其结果与手写对应 `enabled` 值产生的物化结果不可区分。

#### Scenario: 环境变量命中真值覆盖仓库默认关闭
- **WHEN** 某定制在 manifest 中 `enabled: false` 且声明 `enabledEnv: DSH_XXX`,运行 sync 时环境变量 `DSH_XXX=1`
- **THEN** 该定制被当作启用物化,与手写 `enabled: true` 的物化结果一致

#### Scenario: 环境变量命中假值覆盖仓库默认开启
- **WHEN** 某定制 `enabled: true` 且声明 `enabledEnv: DSH_XXX`,运行 sync 时环境变量 `DSH_XXX=0`
- **THEN** 该定制被当作禁用从部署面移除,仓库中该定制的源码目录与 manifest 条目保持不变

#### Scenario: 环境变量未设置时回退到 manifest
- **WHEN** 某定制声明了 `enabledEnv`,但对应环境变量未设置、为空白,或取值无法识别为真值或假值
- **THEN** sync 按该定制自身的 `enabled` 字段决定有效启用状态,不因声明了 `enabledEnv` 而改变结果

#### Scenario: 非法环境变量名拒绝运行
- **WHEN** 某定制的 `enabledEnv` 取值不匹配大写 `DSH_` 前缀命名约定
- **THEN** sync 在加载 manifest 阶段即报错并以非零退出码结束,不物化任何定制的变更

#### Scenario: 未声明 enabledEnv 行为不变
- **WHEN** 某定制未声明 `enabledEnv`
- **THEN** 其有效启用状态完全由 manifest 的 `enabled` 字段决定,sync 不读取任何环境变量参与该定制的启用判定
