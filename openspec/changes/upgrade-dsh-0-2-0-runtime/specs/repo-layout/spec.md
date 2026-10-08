## MODIFIED Requirements

### Requirement: 生成文件带标记且按序合并
sync 生成的文件（含 patch 层）必须（SHALL）带有生成标记头，声明仓库为真相源。多个启用定制贡献的 patch 行必须按 manifest 顺序合并。

sync SHALL 在 profile patch（`profiles/<profile>/cordis.patch.yml`）中只替换自身生成标记圈定的区段，MUST NOT 整文件独占运行时配置。区段末尾 SHALL 带空 insert 锚行，使运行时追加的新行落在区段外。除下述显式所有键维护与空序列规范化外，区段外内容 SHALL 原样保留；MUST NOT 删除或覆盖用户设置。不得仅因运行体提供更高优先级的 home 层就把可编辑配置迁到该层，从而使 config-editor 拒绝用户保存。

在 0.2+ 运行体上，`mergeConfig: true` 片段的 config SHALL 维护在区段外最后一条同 id 的运行时所有行中；缺席时播种，存在时只更新片段声明的键，其余运行时键、注释与 `!!js` 表达式 SHALL 保留。配置表单编辑与再次 sync 后两类键同时生效仍是实际候选验收 gate，不能以文档对齐或单测代替。

运行时 ConfigEditor 与 sync 的 patch 读改写 SHALL 使用同一 profile `package.json` 文件锁，锁须覆盖读取、组合、验证、备份与原子发布，不能只锁最终写入。patch、备份与所有权账本 SHALL 为 owner-only。sync SHALL 记录逐 row/key 的所有权与原值；片段禁用、删除或移除键时，仅当当前值仍等于自身最后写入值时恢复原值/删除自身引入键。用户后改的值 SHALL 保留并报告未解决退休；多片段同键以最后启用声明为准。未知旧所有权不得推断删除。patch/账本发布中断 SHALL 可通过持久化事务恢复；当前 patch 与事务前后快照均不匹配时 SHALL fail closed，不覆盖运行时后改。

官方新 profile 的空序列（含注释的 `[]`）不是用户配置条目。sync MAY 仅移除该空序列的括号、保留注释，使其可与生成的 block sequence 合成同一文档。sync MUST 在覆盖 patch 与备份前以运行体 YAML 方言验证完整组合为单一序列；无法安全组合时 SHALL 拒绝写入，不得报告 no changes 或丢弃非空用户条目。

覆盖类片段（以既有行 `id` 重新接线、不新增 loader 行）只允许（SHALL）声明它要改变的 config 键；sync 必须（SHALL）把这些键合并进该行在下层已有的 config。覆盖片段不得（SHALL NOT）因合并语义缺失，丢弃运行体或用户在下层写入的其他 config 键。

#### Scenario: 两个启用 patch 定制
- **WHEN** 两个 patch 定制被启用
- **THEN** 生成的 patch 层在生成标记头下按 manifest 顺序包含两个片段

#### Scenario: remote 覆盖片段生效
- **WHEN** 某 `remote` 定制存在对应的 `patches/<id>.yml` 覆盖片段，且两者都启用
- **THEN** 覆盖片段按 manifest 顺序合入生成的 patch 层，并作用于该 `remote` 定制的配置行

#### Scenario: 运行体写入的设置在重复 sync 后保留
- **WHEN** 运行体已把用户在设置页的修改写入 profile patch，随后连续运行 sync 两次
- **THEN** 两次 sync 后该修改仍在 profile patch 中且仍然生效，第二次 sync 报告无变化

#### Scenario: 覆盖片段只合并自身声明的键
- **WHEN** 某覆盖片段为 `id: X` 声明了 config 键 `a`，而下层已有该行 config 键 `b`（例如由运行体从旧 settings 导入）
- **THEN** 生效配置同时包含 `a` 与 `b`；sync MUST NOT 因覆盖片段而丢失 `b`

#### Scenario: 旧运行体上不破坏 profile patch 的其他内容
- **WHEN** 所 pin 的运行体不提供 profile 之上的独立 patch 层，而 profile patch 中存在生成标记区段以外的内容
- **THEN** sync 只替换生成标记区段，区段外内容逐字节保留

#### Scenario: 官方空 profile 首次物化
- **WHEN** 官方 scaffold 创建了带注释的空序列 patch，随后连续运行 sync 两次
- **THEN** 完整 patch SHALL 可被官方 CLI 解析，注释保留，第二次不产生变化

#### Scenario: 组合失败保留原配置与备份
- **WHEN** 生成片段与区段外内容无法合成合法的单一 YAML 序列
- **THEN** sync SHALL 失败并保留既有 patch 与 `.bak`，MUST NOT 覆盖它们或丢弃非空运行时配置

## ADDED Requirements

### Requirement: preset 定制按运行体支持的承载方式物化

`preset` 类定制必须（SHALL）按所 pin 运行体实际加载 preset 的方式物化。运行体从目录加载 preset 时，复制到该目录；运行体只接受在 profile 配置中声明 preset 时，必须（SHALL）把 preset 渲染成生成 patch 层中的声明行。系统不得（SHALL NOT）在运行体不再读取的目录里物化 preset，并把此当作「preset 已部署」。

运行体切换后，sync 必须（SHALL）清理旧承载方式下由自身物化的产物，且只清理自身账本记录过的产物。

#### Scenario: 运行体只接受声明式 preset
- **WHEN** 所 pin 运行体不再从 preset 目录加载，而某 preset 定制启用
- **THEN** sync 在生成 patch 层中写入该 preset 的声明行，运行体 roster 可挂载该 preset；sync MUST NOT 只复制到旧目录就报告成功

#### Scenario: 切换承载方式后清理旧产物
- **WHEN** 运行体升级导致 preset 承载方式从目录改为声明
- **THEN** sync 删除自身账本记录的旧目录产物，不触碰其他来源的同名文件

### Requirement: sync 不把运行时安装的插件纳入自身管理

当运行体自带插件管理能力，可在 sync 之外向 profile 安装插件（如 Web 插件页、Agent 插件管理工具）时，sync 必须（SHALL）区分三类插件：运行体出厂 bundle、manifest 声明的定制、运行时自行安装的插件。

sync 不得（SHALL NOT）把运行时自行安装的插件记录为出厂 bundle。sync 必须（SHALL）在输出中报告这类漂移，并且不得静默删除它们。

sync 写入 profile 的 `package.json` 时，必须（SHALL）与运行体的插件管理使用同一把文件锁或等价的互斥机制，避免并发写入互相覆盖。

#### Scenario: 运行时安装的插件被识别为漂移
- **WHEN** 用户经 Web 插件页安装了一个 manifest 未声明的插件，随后运行 sync
- **THEN** sync 报告该插件不在 manifest 中，保留它，且 MUST NOT 把它写入出厂 bundle 记录

#### Scenario: 与运行时插件管理并发写入
- **WHEN** sync 写入 profile 的 `package.json` 时，运行体的插件管理也在写入同一文件
- **THEN** 两者经同一互斥机制串行化，最终文件包含双方的结果，不出现半写或互相覆盖
