# repo-layout Specification

## Purpose
定义 ohmydsh 仓库的目录结构、总配置 manifest 契约,以及将启用的定制和环境级指令物化到 DSH 部署环境的 sync 行为。

## Requirements

### Requirement: 总配置 manifest 声明 DSH 版本与定制列表
仓库根必须(SHALL)包含 `dsh.yaml` manifest。manifest 必须声明锁定的 DSH 版本与定制列表,其中每项必须包含 `id`、`type`、`enabled`,且 `package` 与 `preset` 类型必须包含 `version`。manifest 可(MAY)声明顶层 `dependencies` 列表:无 bundle 的支撑包(如 remote 定制缺失的 peer),每项为含精确版本的 npm spec;定制条目可(MAY)通过 `deps` 引用其中的包名声明归属,被引用的包名必须存在于顶层 `dependencies`,否则 sync 报错。

#### Scenario: 读取 manifest
- **WHEN** 用户读取 `dsh.yaml`
- **THEN** 每项定制的 id、类型、版本(按需)与启用状态均显式可见

#### Scenario: 声明支撑依赖
- **WHEN** 某定制需要运行体未携带的 npm 支撑包
- **THEN** 该支撑包以含精确版本的 spec 列入顶层 `dependencies`,依赖它的定制条目通过 `deps` 引用其包名;引用不存在的包名时 sync 报错

#### Scenario: manifest 缺失
- **WHEN** sync 运行时 `dsh.yaml` 不存在
- **THEN** sync 以错误退出,并指明缺失的 manifest 及其创建方式

### Requirement: 定制单元遵循社区 bundle 标准
`package` 类定制必须(SHALL)是自包含目录,其 `package.json` 必须声明 `dsh.bundle` manifest,其 composition 行必须位于自带 `cordis.patch.yml` 中,从而可通过 `dsh plugin add` 安装。`preset` 类定制必须(SHALL)是包含 `agent.cordis.yml` 的目录。`patch` 类定制必须是 YAML patch-list 片段。`skill` 类定制必须在自身目录下提供 skill 定义。

#### Scenario: 新增 package 定制
- **WHEN** 在 `packages/<name>/` 下新增一个 package 定制
- **THEN** 该目录包含带 `dsh.bundle` 的 `package.json` 与 `cordis.patch.yml`,且 `dsh plugin add` 安装成功

#### Scenario: 新增 preset 定制
- **WHEN** 在 `presets/<id>/` 下新增一个 preset 定制
- **THEN** 该目录包含 `agent.cordis.yml`,且该 preset 可被 DSH roster 挂载

### Requirement: manifest 支持本地与远端两种定制来源
每项定制必须(SHALL)通过 `source` 字段声明来源:`local`(仓库自研,源码位于 `packages/<id>/`)或 `remote`(第三方插件)。`remote` 定制必须包含 `spec`(npm 或 git 地址,含精确版本 pin),仓库不得 vendor 其源码;对 `remote` 定制的个人配置覆盖必须存放在 `patches/<id>.yml`。

#### Scenario: 声明 remote 定制
- **WHEN** manifest 中某定制 `source: remote`
- **THEN** 其 `spec` 包含精确版本 pin,且仓库中不存在其源码拷贝

#### Scenario: 声明 local 定制
- **WHEN** manifest 中某定制 `source: local`
- **THEN** 其源码位于 `packages/<id>/`,按社区 bundle 标准维护

### Requirement: sync 幂等地物化启用定制
sync 工具必须(SHALL)把每项启用定制物化到 DSH 部署环境(`~/.dsh`),且必须幂等:在仓库未变更时连续运行两次,第二次不得产生任何变化。

#### Scenario: 重复运行 sync 为空操作
- **WHEN** 仓库无变更时连续运行 sync 两次
- **THEN** 第二次运行报告无任何变化

#### Scenario: 禁用定制不出现在部署面
- **WHEN** 某定制 `enabled: false`
- **THEN** sync 不在部署面留下该定制的任何痕迹

#### Scenario: 启用定制被物化
- **WHEN** 某定制 `enabled: true`
- **THEN** 按其类型,其包被安装、其 patch 行被合并、或其 preset/skill 被复制

### Requirement: sync 自行确保目标 profile 骨架存在

sync 必须(SHALL)在物化任何 package 类定制或执行 reset 之前,确保目标 profile 目录下存在可用的 profile manifest。当该 manifest 不存在时,sync 必须(SHALL)自行将其物化,不得(SHALL NOT)要求用户先以其他方式启动过 DSH,也不得把该前置的缺失表述为 package 物化失败。

profile 骨架的内容必须(SHALL)以所 pin 的 DSH 运行体自身的 profile 模板为真相源。仓库不得(SHALL NOT)保存一份独立的 profile 模板副本,以免运行体升级后二者产生偏差。

该步骤必须(SHALL)幂等:manifest 已存在时不得触碰任何既有文件,不得改写既有 bundle 列表、依赖或用户 patch 层,且必须使该次运行在部署面上表现为空操作。

该步骤必须(SHALL)fail closed:骨架无法物化时,sync 必须报告该失败本身并以非零退出码结束,使首因可见;不得(SHALL NOT)在骨架缺失的情况下继续以"逐个 package 安装失败"的形式暴露次生错误。

#### Scenario: 全新环境首次物化
- **WHEN** 用户在不存在 `$DSH_HOME` profile 骨架的机器上首次运行 sync
- **THEN** sync 按运行体模板物化该 profile 骨架,并在同一次运行内完成 manifest 中全部启用定制的物化,不报告 profile manifest 缺失

#### Scenario: 骨架物化先于 package 安装
- **WHEN** sync 在同一次运行中既需要物化 profile 骨架,又需要安装 package 定制
- **THEN** 骨架物化先于任何 package 安装动作发生,使这些安装在已就绪的 profile 上执行

#### Scenario: 骨架已存在时为空操作
- **WHEN** 目标 profile manifest 已存在且部署面与 manifest 一致
- **THEN** sync 不重新初始化该骨架,不修改其内容,并报告无任何变化

#### Scenario: 全新环境执行 reset
- **WHEN** 用户在不存在 profile 骨架的机器上执行 sync 的 reset 动作
- **THEN** sync 先物化骨架再执行 reset,不报告 profile manifest 缺失

#### Scenario: 骨架无法物化
- **WHEN** profile manifest 缺失且 sync 无法物化骨架(如目标版本运行体不可用)
- **THEN** sync 报告骨架初始化失败并以非零退出码结束,错误信息指明目标 profile 与其目录

### Requirement: sync 按 manifest 承诺核验已部署 package 的完整性

判断某个 package 是否需要重新物化时,sync 不得(SHALL NOT)仅依据元数据(已部署 `package.json` 的 version、源码内容哈希、记录的 install spec)或安装命令的退出码。安装命令的退出码只证明安装动作**执行过**,不证明产物**已到位**。sync 必须(SHALL)核验该 package 的 manifest 所承诺的运行时文件确实存在于部署面,并在缺失时重新物化。该核验必须(SHALL)同等适用于 `local` 与 `remote` 来源,以及首次安装与后续运行。

所核验的文件集合必须(SHALL)由 manifest 自身推导(`main`、`exports`、`dsh.bundle.patch`),并必须(SHALL)保守取值:条件映射按运行时实际选用的条件**首个匹配**解析,不得取所有分支的并集;通配符子路径、`null` 目标、目录目标与 fallback 数组不得产生具体文件要求;类型声明(`types`/`typings`)不属于运行时文件。健康的 package 不得(SHALL NOT)被误判为残缺。

修复必须(SHALL)保证失败后的部署面不劣于修复前:sync 不得(SHALL NOT)在重装成功之前删除既有部署副本,使"残缺"退化为"缺失";若修复过程中需要移除既有副本,必须(SHALL)在失败时将其复原,且不得遗留中间目录。

当某 package 的来源本身无法满足其 manifest(如发布物残缺)时,重装无法收敛。sync 必须(SHALL)以非零退出码报告该情况,并且不得(SHALL NOT)在后续每次运行中重复执行注定失败的安装;当该 package 的身份(版本或 spec)发生变化时,必须(SHALL)重新尝试。

#### Scenario: 部署副本缺失入口文件
- **WHEN** 某已部署 package 的 `package.json` 完好,但其 manifest 承诺的运行时文件缺失(如安装被中断)
- **THEN** sync 报告该部署残缺并重新物化,使缺失文件恢复;而不是报告 `up-to-date`

#### Scenario: 自愈后保持幂等
- **WHEN** 残缺部署已被修复且此后无任何变更
- **THEN** 后续 sync 报告无变化,且不再发起安装

#### Scenario: 健康部署不被误判
- **WHEN** 部署面完整,其中包含仅声明类型条件、通配符子路径或 ESM 专用而仍声明 `require` 分支的 package
- **THEN** sync 不将其判定为残缺,该次运行在部署面上为空操作

#### Scenario: 修复失败不劣化部署面
- **WHEN** 针对残缺 package 的重装因外部原因(如网络中断)失败
- **THEN** sync 以非零退出码报告失败,原有部署副本保持原样而非被删除,且不遗留中间目录

#### Scenario: 来源自身残缺
- **WHEN** 某 package 的来源无法满足其 manifest,重装后仍缺少承诺的文件
- **THEN** sync 以非零退出码报告该 package 无法通过重装修复;在其身份未变化前,后续运行不再重复安装

### Requirement: 部署账本跨仓库更名持久存续
sync 必须(SHALL)将部署所有权记录(每项已物化产物的来源与部署内容哈希)持久化到 `$DSH_HOME` 下的单一账本文件。该账本的文件名必须(SHALL)与仓库名称无关,不得(SHALL NOT)包含仓库名或随仓库更名而变化。sync 必须(SHALL)在读取任何状态之前迁移历史命名的账本:当当前账本不存在而存在一个或多个历史命名账本时,必须采用其中最新世代并将其**移动**(而非复制)到当前文件名,从而延续对既有部署产物的所有权;更旧世代的账本必须(SHALL)被报告为已被取代,且不得(SHALL NOT)被删除。账本缺失不得(SHALL NOT)被当作"目标未托管"的证据用于放宽任何 fail-closed 判定。

#### Scenario: 仓库更名后首次 sync
- **WHEN** 仓库更名导致账本仅存在于历史文件名下,而已部署产物保持不变
- **THEN** sync 采用该账本并将其移动到与仓库名无关的当前文件名,保留全部所有权记录;既有产物按托管路径正常更新,不报"未托管"错误

#### Scenario: 多个历史世代并存
- **WHEN** `$DSH_HOME` 下同时存在多个历史命名的账本
- **THEN** sync 采用最新世代完成迁移,并将更旧世代报告为已被取代且保留其文件

#### Scenario: 迁移后保持幂等
- **WHEN** 迁移完成后在部署与 manifest 均未变化的情况下再次运行 sync
- **THEN** sync 为空操作,不再执行迁移,也不产生新的变更

#### Scenario: 账本确实缺失时保持 fail closed
- **WHEN** 不存在任何当前或历史命名的账本,而 fail-closed 目标已存在且内容与期望不同
- **THEN** sync 报错并保留原文件,不得因账本缺失而覆盖

### Requirement: 环境级 agent instructions 单例安全物化
manifest 可(MAY)声明顶层 `agentInstructions` 映射,包含布尔 `enabled` 与仓库内相对文件 `source`;该配置不是 customization type。启用时 sync 必须(SHALL)将源内容加 GENERATED/provenance 头后原子物化为 `$DSH_HOME/AGENTS.md`,并记录 `source` 与部署内容哈希。绝对路径、`..` 逃逸及解析到仓库外的源必须被拒绝。

#### Scenario: 首次部署与重复 sync
- **WHEN** `agentInstructions` 启用且目标不存在
- **THEN** sync 生成 `$DSH_HOME/AGENTS.md` 并记录所有权状态;仓库与目标未变时再次 sync 为空操作

#### Scenario: 未托管目标冲突
- **WHEN** 目标已存在、内容不同且没有本仓库的部署状态
- **THEN** sync 报错并保留原文件,不得覆盖

#### Scenario: 托管目标发生漂移
- **WHEN** 目标内容不再匹配状态中的上次部署哈希
- **THEN** sync 报错并保留目标与所有权状态,不得用新源覆盖

#### Scenario: 安全撤销
- **WHEN** 配置被禁用、字段被删除或执行 reset
- **THEN** 仅当目标仍匹配上次部署哈希时删除目标并清除状态;目标不存在时清除陈旧状态;内容漂移时保留目标与状态并报错

### Requirement: sync 按来源分发物化
sync 必须(SHALL)按 `source` 分发物化动作：`local` 在安装前根据源码和构建输入生成或复用当前 checkout 的运行产物，再用仓库路径安装；`remote` 用其 `spec` 从原址安装。local 构建失败时必须在替换已部署 package 前报错停止，不得安装缺失或陈旧的 checkout 产物；两种来源必须共享相同的开关、幂等与生成标记语义。

#### Scenario: 混合清单一次 sync
- **WHEN** manifest 同时包含已启用的 `local` 与 `remote` 条目，且 local package 构建依赖已由根安装准备
- **THEN** 一次 sync 运行生成必要的 local 运行产物，并使两类定制全部就位

#### Scenario: 未变源码重复 sync
- **WHEN** local package 的源码、构建配置和依赖均未变化，且运行产物存在并与构建输入匹配
- **THEN** 后续 sync 复用该运行产物，部署面不发生变化

#### Scenario: local 构建失败
- **WHEN** 已启用 local package 的运行产物缺失或过期，且其构建命令失败
- **THEN** sync 以明确错误退出，并保留此前已部署的可用 package，不执行该 package 的 remove/reinstall

#### Scenario: remote 版本 pin 复现
- **WHEN** 同一 manifest 在全新环境运行 sync
- **THEN** 安装的 `remote` 定制版本与 manifest 中的 pin 一致

### Requirement: 开关可逆且不删除仓库内容
修改定制的 `enabled` 值并重跑 sync,必须(SHALL)将其从部署面添加或移除,同时其文件保留在仓库中。

#### Scenario: 禁用后再启用
- **WHEN** 某定制被禁用随后又被启用,且每次变更后都运行 sync
- **THEN** 部署面先失去后重新获得该定制,仓库副本全程不变

### Requirement: 生成文件带标记且按序合并
sync 生成的文件(含 profile patch 层)必须(SHALL)带有生成标记头,声明仓库为真相源;多个启用定制贡献的 patch 行必须按 manifest 顺序合并。

#### Scenario: 两个启用 patch 定制
- **WHEN** 两个 patch 定制被启用
- **THEN** 生成的 patch 层在生成标记头下按 manifest 顺序包含两个片段

#### Scenario: remote 覆盖片段生效
- **WHEN** 某 `remote` 定制存在对应的 `patches/<id>.yml` 覆盖片段且两者启用
- **THEN** 覆盖片段按 manifest 顺序合入生成的 patch 层,并作用于该 `remote` 定制的配置行

### Requirement: 定制携带独立版本
每个 `package` 定制必须(SHALL)在 `package.json` 中有 `version`,每个 `preset` 定制必须有 `VERSION` 文件,使 manifest 能独立引用各定制。

#### Scenario: 单个定制版本升级
- **WHEN** 某定制版本升级且 manifest 同步更新
- **THEN** 其他定制的版本不受影响

### Requirement: TypeScript local package 以源码为版本控制真相源
使用 TypeScript 构建的 `local` package 必须(SHALL)提交源码、构建配置和 package manifest，但不得提交标准构建可重建的 `lib/` JavaScript、declaration 或 source map。其 package exports 与 CLI 可继续指向本地生成的 `lib/`。

#### Scenario: 提交 TypeScript local package
- **WHEN** 开发者完成一个 TypeScript local package 的源码变更
- **THEN** Git 变更包含 `src/` 与必要配置，不包含构建生成的 `lib/` 文件

#### Scenario: 全新 checkout 物化 local package
- **WHEN** 用户按仓库初始化流程安装根依赖后，在没有任何预提交 `lib/` 的全新 checkout 运行 sync
- **THEN** sync 生成该 package 所需的运行产物并成功安装可加载的 package

### Requirement: 仓库依赖锁采用根级单一来源
仓库必须(SHALL)仅提交根 `package-lock.json`，并由该 lockfile 覆盖根工具与仓库内 local package 的开发、构建和测试依赖。`packages/*/package-lock.json` 不得进入版本控制。根 lockfile 必须继续作为 `npm ci` 与 Worktree Session lean dependency cache 的依赖指纹来源。

#### Scenario: 从根安装可复现依赖
- **WHEN** 用户在全新 checkout 根据根 `package-lock.json` 执行仓库初始化或 `npm ci`
- **THEN** 根工具和所有纳入管理的 local package 获得完成构建与测试所需的锁定依赖

#### Scenario: local package 依赖发生变化
- **WHEN** 开发者修改 local package 的 dependency 或 devDependency
- **THEN** 仅根 `package-lock.json` 随之更新，package 目录中不产生需提交的独立 lockfile

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

### Requirement: 仓库初始化按最低版本准则校验 Node/npm 工具链
仓库初始化脚本必须(SHALL)按**最低版本准则**校验 Node 与 npm:仅当实际版本低于声明的最低版本时拒绝初始化并给出升级指引;不低于最低版本时必须放行,不得因版本与推荐值不同而失败。最低版本必须(SHALL)在根 `package.json` 的 `engines` 中以范围形式声明,并与初始化脚本内的阈值保持一致。`.nvmrc` 必须(SHALL)作为**推荐版本**的单一来源被初始化脚本读取;实际版本与推荐值不同时,脚本必须仅提示并继续执行。版本比较必须(SHALL)在 bash 内自包含实现,不得依赖 `sort -V`、semver 或其他非 POSIX 通用工具,以保持 macOS / Linux / WSL / Git Bash 通用。仓库不得(SHALL NOT)通过 `packageManager` 等字段在 `engines` 之外再声明一个精确的包管理器版本。依赖的可复现性由根 `package-lock.json` 保证,不由工具链版本相等保证。

#### Scenario: 高于最低版本但不等于推荐版本
- **WHEN** 用户在 Node/npm 版本满足最低要求、但与 `.nvmrc` 推荐值不同的环境执行仓库初始化
- **THEN** 初始化继续执行并完成依赖安装,输出中包含推荐版本提示,退出码为 0

#### Scenario: 低于最低版本
- **WHEN** 用户在 Node 或 npm 版本低于声明最低版本的环境执行仓库初始化
- **THEN** 初始化以非零退出码失败,错误信息同时给出实际版本、最低版本要求与升级方式,且不执行依赖安装

#### Scenario: 工具链缺失
- **WHEN** 执行仓库初始化时 `node` 或 `npm` 不存在于 PATH
- **THEN** 初始化以非零退出码失败,并给出最低版本要求与安装方式

#### Scenario: 最低版本声明保持单一准则
- **WHEN** 开发者查阅根 `package.json` 的 `engines`、初始化脚本阈值与 README 前置要求
- **THEN** 三者描述同一组最低版本,且仓库中不存在与之冲突的精确包管理器版本声明

### Requirement: 长期仓库仅保存必要且可维护的派生资产
仓库必须(SHALL)忽略可重建构建输出、OpenSpec checking 的 raw session/history baseline 与批量截图，以及同一架构图的重复重量级导出。长期保留的 checking 内容必须是轻量报告、trail、gate 或复现脚本；仓库架构图必须保留一种可直接展示的轻量格式与其可编辑真相源。若原始验收证据仍需审计，报告必须指向 Git 之外的 artifact 位置或说明其留存方式。

#### Scenario: 完成 OpenSpec 验收
- **WHEN** 验收产生 raw JSON、会话历史和一组截图
- **THEN** Git 仅保留可复核的轻量摘要与复现信息，raw evidence 不进入版本控制

#### Scenario: 更新仓库架构图
- **WHEN** 架构变化需要重新生成图形
- **THEN** 开发者更新可编辑图源和唯一的仓库展示格式，不提交同图的 PNG、SVG 与交互 HTML 多套重复导出
