# staged-upgrade-execution Specification

## Purpose
定义 DSH 运行体与插件升级的编排契约:阶段如何按依赖方向切分、每个阶段的准入与验收条件、升级前后能力基线如何固定与比对、失败如何回滚,以及"接线迁移类升级必须原子完成"这一不变量。

## Requirements

### Requirement: 升级按可独立验证的阶段推进
升级必须(SHALL)切分为若干阶段,每个阶段的准入条件是其**前置阶段已通过验收**,而不是时间顺序或便利性。阶段切分必须(SHALL)依据**升级项之间的真实依赖方向**:不依赖运行体升级的插件升级必须(SHALL)排在依赖运行体升级的项目之前,使前者的收益不被后者的风险阻塞。

每个阶段必须(SHALL)可独立验收、独立回滚,且不得(SHALL NOT)在同一阶段内混入互不相关的失败源。一次阶段执行失败时,回滚必须(SHALL)只需撤销该阶段自身的变更,不得(SHALL NOT)要求连带回滚已验收通过的先前阶段。

运行体原子批 MUST 同时包含精确 `dshVersion`、全部 local runtime 声明与代码适配、目标版本 Host compatibility runtime，以及实测证明无法在目标运行体装载或激活的现有定制之兼容升级、修订或显式禁用。声明兼容但可独立前置验收的插件升级 SHALL 保持在单独前置阶段；没有兼容版本且未通过隔离放行闸的插件 MUST NOT 随运行体候选进入生产组合。

#### Scenario: 依赖运行体升级的项目被排到后置阶段
- **WHEN** 某插件的目标版本声明了当前运行体无法满足、但目标运行体可满足的 peer 范围，或依赖只有目标运行体提供的服务
- **THEN** 该插件的 pin/启用决策 SHALL 纳入运行体原子批，但其组合验证 SHALL 排在裸目标运行体 gate 之后；系统 MUST NOT 把它拆成生产运行体切换后的可选补做步骤

#### Scenario: 前置阶段未验收时不得推进
- **WHEN** 某阶段的前置阶段尚未通过其验收条件
- **THEN** 系统 SHALL NOT 开始该阶段,即使其变更本身与前置阶段无直接冲突

#### Scenario: 单阶段失败不波及已验收阶段
- **WHEN** 某阶段执行后验收失败并需要回滚
- **THEN** 回滚 SHALL 只撤销该阶段自身的变更,先前已验收阶段的成果 MUST NOT 被要求一并撤销

#### Scenario: 无兼容版本的插件未通过隔离闸
- **WHEN** 已启用插件没有目标版本兼容发布物，且其现有 pin 未通过 loader 可执行与实际功能激活验证
- **THEN** 运行体原子批 SHALL 显式禁用该插件或停止推进，MUST NOT 以安装成功或无日志错误放行

### Requirement: 接线迁移类升级必须原子完成
当某个远端包的新版本**自带了本仓库此前以手写 patch 承担的接线**时,升级该 pin 与移除对应手写 patch 条目必须(SHALL)在同一阶段内原子完成,不得(SHALL NOT)拆成两次分别执行。

理由:DSH 的 loader patch 按 `applyEntryPatches` 语义处理,无 `id` 的 `insert` 行一律追加。包自带 bundle patch 与仓库手写 patch 同时存在时,会插入**两条同 id 的 loader 行**,而不是彼此覆盖或去重。

升级后,该插件必须(SHALL)仍出现在启动清单中且**恰好出现一次**;其来源标注必须(SHALL)从 patch 接线变为 bundle 承载,以此证明接线确已移交而非重复。

#### Scenario: 自带接线的版本升级同时回收手写 patch
- **WHEN** 某远端包的新版本自带与仓库手写 patch 等价的 bundle patch
- **THEN** 该 pin 升级与手写 patch 条目的移除 SHALL 在同一阶段完成,升级后启动清单中该插件 SHALL 恰好出现一次且标注为 bundle 承载

#### Scenario: 拒绝只升 pin 而保留手写接线
- **WHEN** 仅升级该 pin 而未移除对应手写 patch 条目
- **THEN** 该阶段 SHALL 判定为未通过验收,理由为同一插件产生重复 loader 行

### Requirement: 运行体升级前必须固定可复跑的能力基线
运行体(`dshVersion`)升级前,必须(SHALL)先固定一份**可复跑的能力基线**,并在升级后以同一基线复跑比对,用以证明升级前后能力稳定。基线必须(SHALL)在升级前的运行体上先跑通一次并记录结果,否则无法区分"升级导致的失败"与"升级前即已存在的失败"。

基线必须(SHALL)覆盖既有自动化测试,并且必须(SHALL)显式列出**已知无自动化覆盖的行为**,对其给出可执行的人工验收步骤。已知覆盖缺口不得(SHALL NOT)因其无自动化覆盖而被静默排除在基线之外。

升级后某项基线项失败时,必须(SHALL)先判定该项在升级前是否通过,再据此归因;不得(SHALL NOT)在未比对升级前结果的情况下断言其为升级导致。

#### Scenario: 基线在升级前先行跑通并记录
- **WHEN** 准备升级运行体
- **THEN** 系统 SHALL 先在当前运行体上完整跑一次基线并记录结果,该记录 SHALL 作为升级后比对的唯一依据

#### Scenario: 无自动化覆盖的行为进入基线
- **WHEN** 某项行为已知无自动化测试覆盖,但属于升级影响面
- **THEN** 基线 SHALL 显式列出该项并给出人工验收步骤,MUST NOT 因其无自动化覆盖而省略

#### Scenario: 升级后失败必须先行归因
- **WHEN** 升级后某基线项失败
- **THEN** 系统 SHALL 先比对该项在升级前基线中的结果再归因,MUST NOT 未经比对即断言为升级导致

### Requirement: 升级验收以实际运行证据为准
每个阶段的验收必须(SHALL)以**实际运行产生的证据**为准:安装解析成功、依赖树无冲突等静态信号不构成(SHALL NOT constitute)插件已生效的证据。

对于纯客户端插件,验收必须(SHALL)确认其在运行体中**确实被加载并可用**。当某插件的新版本依赖运行体未提供的服务时,其失败形态可能是**静默不激活**——装得上、无报错、功能消失。因此"无报错"不得(SHALL NOT)被当作验收通过的依据。

运行体候选 SHALL 在独立 `DSH_HOME` 和非生产端口按最小分组逐步组合；每组 MUST 记录目标版本、实际启动清单、bundle loader 可执行结果、用户可见功能证据与相对旧版基线的差异。不得启动替代 server 并把其结果冒充现有 GUI 已更新；正式部署后 SHALL 刷新并验证既有 GUI URL。

#### Scenario: 安装成功不等于验收通过
- **WHEN** 某插件升级后依赖解析成功且无安装错误
- **THEN** 该阶段 SHALL NOT 仅据此判定通过,SHALL 另行确认该插件在运行体中实际加载并可用

#### Scenario: 静默不激活必须被识别为失败
- **WHEN** 某插件升级后既无报错也无预期功能出现
- **THEN** 系统 SHALL 判定该项验收失败,MUST NOT 因缺少错误信息而判定通过

#### Scenario: 隔离候选分组引入失败
- **WHEN** 新增一组 local 或 remote 定制后候选实例首次出现 loader、功能或数据迁移失败
- **THEN** 系统 SHALL 将失败归因到该组并停止扩组合，先前已通过的最小组证据 SHALL 保留

#### Scenario: 正式部署验证现有 GUI
- **WHEN** 操作者在 devbox gate 通过后自行将运行体批次物化到任一生产 DSH home
- **THEN** 该机器的部署验收 SHALL 刷新并验证其既有 Web URL 的完整组合，MUST NOT 以 devbox 备用端口实例替代该机器的正式验收；本 change 未操作的 host/lumevm MUST NOT 被标记为已验收

#### Scenario: devbox 主干候选验收
- **WHEN** 候选实现已形成可复核 Git commit 并准备执行清洁构建与远端场景矩阵
- **THEN** 系统 SHALL 通过 SSH 在 devbox checkout 该精确 commit，以隔离依赖、`DSH_HOME`、端口和构建目录完成验收，MUST NOT 使用本地工作树、依赖、构建产物或生产 DSH home 代替

#### Scenario: devbox 网络准备失败
- **WHEN** SSH 登录后 `set_sh_devbox_proxy` 失败或后续 Git/package-manager 网络操作无法完成
- **THEN** devbox 阶段 SHALL fail closed 并保留诊断，MUST NOT 转而在本地现有 GUI 或生产 DSH home 执行候选验收

### Requirement: 升级期间 manifest 保持单一真相源与可回滚性
升级过程中,所有 pin、启用状态与接线变更必须(SHALL)只通过仓库 manifest 与 `patches/` 表达,不得(SHALL NOT)直接修改部署目录来达成升级结果。每个阶段完成后,重新物化必须(SHALL)保持幂等。

临时性的 pin 形态(如为携带上游未发布补丁而指向 fork commit 的 tarball)在其上游变更已发布后,必须(SHALL)回收为常规 registry pin,并移除相应的临时说明。

#### Scenario: 升级只经由 manifest 表达
- **WHEN** 执行任一阶段的版本或接线变更
- **THEN** 变更 SHALL 只写入仓库 manifest 与 `patches/`,部署目录 MUST NOT 被直接手工修改

#### Scenario: 阶段完成后物化保持幂等
- **WHEN** 某阶段变更已物化并通过验收
- **THEN** 再次物化 SHALL 不产生新的变更

#### Scenario: 上游发布后回收临时 fork pin
- **WHEN** 某条目为携带上游未发布补丁而临时指向 fork commit,且该补丁已随上游正式版本发布
- **THEN** 该条目 SHALL 回收为常规 registry pin,其临时性说明 SHALL 一并移除

### Requirement: 数据迁移阶段必须先备份并可回滚
凡运行体或插件升级会首次打开、迁移或写入现有持久数据，阶段开始前 MUST 创建经完整性校验的备份，并记录恢复所需的旧版本精确 pin、manifest、兼容运行体及停止写入顺序。候选版本一旦写入不可由旧版安全读取的新格式，回滚 SHALL 先停止所有 writer、恢复备份，再恢复旧 manifest/runtime；不得让新旧 writer 并发访问同一生产介质。

#### Scenario: 候选运行体首次写入新 Session 格式
- **WHEN** 隔离验证完成后准备让目标运行体首次写入生产 Session 或 Pet 数据
- **THEN** 系统 SHALL 先完成备份和完整性检查，并证明回滚步骤可执行

#### Scenario: 正式迁移后验收失败
- **WHEN** 目标运行体写入新格式后出现必须回滚的验收失败
- **THEN** 系统 SHALL 停止 writer、恢复迁移前备份及旧精确运行体，再恢复服务，不得直接用旧版继续读取已迁移介质

### Requirement: 启动清单必须报出 patch 层的两种接线形态

启动清单是操作者判断「某个定制到底有没有被加载」的首要入口。patch 层接线有**两种**形态,两者都证明 patch 层参与了这个包的加载或接线,因此都必须(SHALL)出现在清单中:

- **`insert` 行** —— 往 loader 表里新增行;
- **覆盖式行** —— 顶层 `{id, name}` 且无 `insert`,按行 id 重新接线一个已存在的 loader 行。

只识别其中一种会让 patch 层对清单**完全隐身**:清单看起来"什么都没接",而那一行可能正是某项能力的**唯一**接线来源(0.1.5 的 Connection RPC channel 注册就是这种情况)。因此清单的省略行为 MUST NOT 被当作"该 patch 片段没做事"的证据。

#### Scenario: 覆盖式接线不得隐身
- **WHEN** 某定制的接线完全由一条覆盖式 patch 行承担(该行不新增任何 loader 行)
- **THEN** 该定制 SHALL 出现在启动清单中并标注为来自 patch 层,MUST NOT 因"它不新增 loader 行"而被省略

#### Scenario: 停用的覆盖式行不贡献加载
- **WHEN** 某覆盖式行声明 `disabled` 为真
- **THEN** 启动清单 SHALL NOT 报出该行,因为其语义是丢掉该 id 对应的行,不加载任何东西

#### Scenario: 覆盖式行与已加载包同名时不重复
- **WHEN** 某覆盖式行的 `name` 已由 bundle 层加载
- **THEN** 启动清单 SHALL 只报出该包一次,MUST NOT 因覆盖式重新接线而产生重复条目

#### Scenario: 清单工具本身必须真的产出清单
- **WHEN** 启动清单由某个脚本产出,而该脚本被以任意合法路径调用(包括经**符号链接**访问的 checkout)
- **THEN** 该脚本 SHALL 正常产出清单,MUST NOT 因入口判定失效而不执行主体逻辑;调用方 MUST NOT 把"无输出"与"没有插件"合并成同一种可观测结果而无法区分
- **AND** 对该脚本的测试 MUST 至少覆盖一次"以子进程运行"的路径,MUST NOT 只通过 `import` 调用其函数——否则入口判定本身永远不被执行,缺陷无法被发现
