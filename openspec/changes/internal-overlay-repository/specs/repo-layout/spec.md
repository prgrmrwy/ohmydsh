## MODIFIED Requirements

### Requirement: manifest 支持本地与远端两种定制来源
每项定制必须(SHALL)通过 `source` 字段声明来源:`local`(自研,源码位于该条目**所属根**下的 `packages/<id>/`)或 `remote`(第三方插件)。公开 manifest 条目的所属根是公开仓库根;overlay 条目的所属根是 overlay 根(见「本地 manifest overlay 追加不可公开定制」)。`remote` 定制必须包含 `spec`(npm 或 git 地址,含精确版本 pin),仓库不得 vendor 其源码;对 `remote` 定制的个人配置覆盖必须存放在所属根的 `patches/<id>.yml`。

#### Scenario: 声明 remote 定制
- **WHEN** manifest 中某定制 `source: remote`
- **THEN** 其 `spec` 包含精确版本 pin,且仓库中不存在其源码拷贝

#### Scenario: 声明 local 定制
- **WHEN** 公开 manifest 中某定制 `source: local`
- **THEN** 其源码位于公开仓库的 `packages/<id>/`,按社区 bundle 标准维护

#### Scenario: 公开条目不从 overlay 根取源码
- **GIVEN** overlay 根与公开仓库根不同,且 overlay 根下存在 `packages/<id>/`,而公开 manifest 中存在同 `<id>` 的 local package 条目
- **WHEN** 运行 sync
- **THEN** 该公开条目以公开仓库的 `packages/<id>/` 安装,profile `package.json` 中其依赖 spec 为 `file:<公开仓库根>/packages/<id>`

### Requirement: 本地 manifest overlay 追加不可公开定制

仓库可(MAY)存在一个**本地 manifest overlay**:默认路径为仓库根 `dsh.yaml.local`,或由环境变量 `DSH_LOCAL_MANIFEST` 指定的绝对路径(该变量非空白时**取代**默认路径,而非叠加;非空白但不是绝对路径时,不得按当前工作目录解析:sync、插件升级检查与插件自动升级必须(SHALL)报错并以非零退出码结束;启动清单必须(SHALL)不列出任何 overlay 条目并在标准错误输出指明该变量必须是绝对路径,但不得因此失败,因为清单不得阻塞启动)。该文件必须(SHALL)被版本控制忽略,用于承载不可公开的定制(内网包、内网采集器、含本机绝对路径的片段)。

overlay 文件解析符号链接后所在的目录称为 **overlay 根**。overlay 根可以(MAY)是一个与本仓库目录同构的私有仓库,在自己的 `packages/`、`skills/`、`presets/`、`patches/` 下承载 overlay 条目的源码。overlay 条目的一切本地路径必须(SHALL)相对 overlay 根解析:`source: local` package 的 `packages/<id>/`、skill 的 `skills/<id>/`、preset 的 `presets/<id>/`、patch 的 `patches/<id>.yml`,以及 `buildInputs`。overlay 条目不得(SHALL NOT)从公开仓库根读取源码;公开条目也不得(SHALL NOT)从 overlay 根读取源码。overlay 位于公开仓库根时,两者是同一目录,行为与引入 overlay 根之前一致。

overlay 根与公开仓库根具有**同等信任**:两者都由本机使用者维护。下述越界与预检约束用于在执行前拦截配置错误(路径写错、私有仓库未克隆或切错分支),不以防御恶意 overlay 为目标;源码目录内部嵌套的符号链接不在检查范围内。

每条定制解析出的源码路径(上述目录或文件、每个 `buildInputs` 文件,以及 local package 每个 `compatDependencies[].path` 目录)在解析符号链接后必须(SHALL)仍位于其所属根解析符号链接后的目录之内;越界时 sync 必须(SHALL)报错并以非零退出码结束。

sync 必须(SHALL)在对 `$DSH_HOME` 做任何写入(含创建 profile 目录与 profile 骨架、迁移状态账本)之前,对所有启用的定制完成源码预检:local package 的 `package.json`、其每个 `compatDependencies[].path` 下的 `package.json`、preset 的 `agent.cordis.yml`、skill 的 `SKILL.md`、patch 的 `<id>.yml`、每个 `buildInputs` 文件必须存在且满足上述越界约束。预检失败时 sync 必须(SHALL)报错并以非零退出码结束,错误信息包含缺失或越界的绝对路径,且 `$DSH_HOME` 下的文件树不发生任何变化(不存在的 profile 目录仍不存在)。

加载 manifest(含 overlay 合并、逐字段校验、保留字段与 npm spec 包名一致性检查)必须(SHALL)不读取任何定制源码。需要读取源码的步骤(local package 包名解析、npm 包名唯一性检查)必须(SHALL)在源码预检通过之后、`$DSH_HOME` 写入之前执行。禁用的 local package 若其 `package.json` 不存在,sync 不得(SHALL NOT)因此报错,该条目视为不在 manifest 中:若此前已部署,按「从 manifest 删除」的既有逻辑移除;若其 `package.json` 存在,sync 必须(SHALL)先确认该文件解析符号链接后位于所属根之内再读取,越界时在任何 `$DSH_HOME` 写入之前报错并以非零退出码结束。`hostRuntimeCompatibility` 的声明校验(归属、kind、版本与 `dshVersion` 一致)属于加载阶段且不读取源码;运行体构建器等源码文件的存在性检查属于常规 sync 的源码预检。`--reset` 只依据部署状态与 profile 现状移除受管部署,必须(SHALL)不执行源码预检、不解析 local 包名,定制源码缺失不得(SHALL NOT)阻止 reset。

overlay 的内容结构必须(SHALL)与 `dsh.yaml` 的 `customizations` **同构**:顶层为映射,其 `customizations` 为定制条目列表,每个条目的字段语义、校验规则与公开 manifest 完全一致(含 `note`、`brief`、`enabledEnv`、`npmScopes`、`hostRuntimeCompatibility` 等)。overlay 条目的审查记录随条目留在该文件内,公开 manifest 不得(SHALL NOT)为其保留任何占位、计数或存在性声明。

overlay 的权限边界必须(SHALL)是**只追加定制条目**:

- overlay 不得(SHALL NOT)声明 `dshVersion`、`autoUpdate`、`web`、`agentInstructions`、`dependencies` 或除 `customizations` 之外的任何顶层字段;出现此类字段时 sync 必须(SHALL)在加载阶段报错并以非零退出码结束,不产生任何物化动作。
- overlay 条目的 `id` 与公开 manifest 中任一条目的 `id` 相同时,sync 必须(SHALL)报错并以非零退出码结束;overlay 不得(SHALL NOT)覆盖、改写或禁用公开 manifest 中的条目。
- overlay 条目之间的 `id` 重复同样必须(SHALL)报错。
- 条目的所属根只能由 sync 根据条目来自哪个文件推导;任一 manifest(公开或 overlay)的条目自行声明 sync 用于记录来源或所属根的内部字段(`overlaySource`、`sourceRoot`)时,sync 必须(SHALL)在加载阶段报错并以非零退出码结束。
- remote package 的 `spec` 是 npm registry spec(`<name>@<version>`)且同时声明 `name` 时,`name` 必须(SHALL)等于从 `spec` 解析出的包名,否则 sync 在加载阶段报错并以非零退出码结束;包名唯一性检查使用安装时实际生效的包名。
- 合并后任意两个 package 条目(含可解析包名的禁用条目)解析出相同的 npm 包名,或某个 package 条目的 npm 包名、顶层 `dependencies` 中的包名与任一 local package 的 `compatDependencies[].name` 三者之间出现重复时,sync 必须(SHALL)在任何 `$DSH_HOME` 写入之前报错并以非零退出码结束,指明冲突的包名与涉及的条目 id、`dependencies` 或 `compatDependencies`;overlay 不得(SHALL NOT)以不同 id、相同包名的方式替换公开 package 或受管支撑依赖。

overlay 条目必须(SHALL)走与公开条目**完全相同**的校验与安全路径,不得(SHALL NOT)因来源是本地文件而放宽:逐字段类型与命名校验、`source: remote` 的精确版本 pin 要求、`deps` 引用完整性,以及 `hostRuntimeCompatibility` 的运行体版本围栏。该围栏必须(SHALL)在任何 profile 或部署面操作之前完成校验。

overlay 根下 local package 的构建必须(SHALL)以 overlay 根为工作目录,按 overlay 根自己的 npm workspaces 执行;构建失败时的行为与公开 local package 相同(在替换已部署 package 前报错停止)。公开仓库的根 `package.json`、`package-lock.json` 与 `.npmrc` 不得(SHALL NOT)因 overlay 根的存在或其构建而改变。

合并结果必须(SHALL)是所有消费方的唯一事实来源:物化(sync)、启动清单、插件升级检查与运行体版本围栏必须(SHALL)看到同一份合并后的定制列表,并按同一所属根解析 local 条目,不得(SHALL)出现「已物化但清单不可见」或「已物化但升级检查不覆盖」的分裂状态。

插件升级检查对 scoped 包:若该 scope 在 profile 目录的 npm 配置中配置了 registry,元数据查询必须(SHALL)经由以 profile 目录为工作目录的 npm 客户端完成,从而使用与安装相同的 registry 与认证配置;否则沿用默认 registry 查询。升级检查输出的每一行(含 skipped 行)必须(SHALL)携带该条目是否来自 overlay 的来源标记。插件自动升级(改写 manifest 并提交)只改写公开 `dsh.yaml`,因此必须(SHALL)依据该来源标记把 overlay 条目排除在自动改写之外,在输出中标明该条目需在 overlay 中手动升级,且不得(SHALL NOT)因 overlay 条目 upgrade-ready 而改写公开 `dsh.yaml` 或报错退出。

overlay 缺失是**常态而非错误**:文件不存在时 sync 必须(SHALL)静默按公开 manifest 运行,行为与未引入本能力时完全一致。文件存在但无法读取或解析时,必须(SHALL)报错并以非零退出码结束,不得静默跳过。

#### Scenario: overlay 缺失时行为不变
- **WHEN** 仓库不存在 `dsh.yaml.local` 且未设置 `DSH_LOCAL_MANIFEST`
- **THEN** sync 仅按 `dsh.yaml` 物化,不报错、不产生额外输出,结果与未引入 overlay 能力时一致

#### Scenario: overlay 条目被追加物化
- **WHEN** overlay 声明一条启用的定制,其 id 不与公开 manifest 冲突
- **THEN** 该定制按其类型被物化(package 安装 / patch 行合并 / preset·skill 复制),与写在公开 manifest 中的同一条目物化结果不可区分

#### Scenario: overlay 条目出现在启动清单与升级检查
- **WHEN** overlay 声明了一条启用的 remote package 定制
- **THEN** 启动清单列出该定制,且插件升级检查覆盖该定制的版本 pin

#### Scenario: id 与公开 manifest 冲突时拒绝运行
- **WHEN** overlay 条目的 `id` 与 `dsh.yaml` 中某条目的 `id` 相同
- **THEN** sync 在加载阶段报错并以非零退出码结束,指明冲突的 id,不物化任何变更

#### Scenario: overlay 声明顶层字段时拒绝运行
- **WHEN** overlay 声明了 `dshVersion`、`autoUpdate`、`web`、`agentInstructions`、`dependencies` 或其他非 `customizations` 的顶层字段
- **THEN** sync 在加载阶段报错并以非零退出码结束,指明越权字段,不物化任何变更

#### Scenario: overlay 条目不因来源而放宽校验
- **WHEN** overlay 条目缺少必填字段、`source: remote` 缺少精确版本 pin,或其 `hostRuntimeCompatibility` 与当前 `dshVersion` 不符
- **THEN** sync 以与公开 manifest 中同类错误相同的方式报错并以非零退出码结束,且在任何 profile 操作之前发生

#### Scenario: overlay 存在但不可解析时拒绝运行
- **WHEN** overlay 文件存在但无法读取,或不是合法 YAML 映射
- **THEN** sync 报错并以非零退出码结束,不静默跳过该层

#### Scenario: 环境变量指定 overlay 路径
- **WHEN** 设置 `DSH_LOCAL_MANIFEST` 为一个存在的 overlay 绝对路径
- **THEN** sync 读取该路径作为 overlay,且不再读取仓库根的 `dsh.yaml.local`

#### Scenario: 公开 manifest 不承载不可公开定制的痕迹
- **WHEN** 某定制因不可公开而由 overlay 承载
- **THEN** 公开 `dsh.yaml` 中不存在该定制的条目、包名、内部地址或存在性声明

#### Scenario: 含 overlay 时 sync 仍幂等
- **WHEN** 存在 overlay 且仓库与 overlay 均无变更,连续运行 sync 两次
- **THEN** 第二次运行报告无任何变化

#### Scenario: 外部 overlay 根的 patch 与 skill 从该根物化
- **GIVEN** `DSH_LOCAL_MANIFEST` 指向公开仓库之外的目录 `<R>/dsh.yaml.local`,其中声明启用的 patch `p` 与 skill `s`;`<R>/patches/p.yml` 与 `<R>/skills/s/` 存在,公开仓库中不存在 `patches/p.yml` 与 `skills/s/`
- **WHEN** 运行 sync
- **THEN** sync 以退出码 0 结束,生成的 `cordis.patch.yml` 含 `fragment: p` 及 `<R>/patches/p.yml` 的内容,且 `$DSH_HOME/skills/s/` 的内容与 `<R>/skills/s/` 一致

#### Scenario: 外部 overlay 根缺少条目源码时在物化前拒绝运行
- **GIVEN** 外部 overlay 根 `<R>` 中声明启用的 patch `p`,上一次 sync 已生成含 `fragment: p` 的 `cordis.patch.yml`;随后 `<R>/patches/p.yml` 被删除,而公开仓库中存在 `patches/p.yml`
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息包含 `<R>/patches/p.yml`,且 `cordis.patch.yml` 与运行前逐字节相同(仍含 `fragment: p`)

#### Scenario: 公开条目缺少源码时同样在物化前拒绝运行
- **GIVEN** 公开 manifest 中启用的 skill `s` 缺少 `skills/s/SKILL.md`,另一启用 patch 的片段内容相对上次 sync 已变化
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息包含缺失的 `SKILL.md` 路径,且 `cordis.patch.yml` 与运行前逐字节相同

#### Scenario: 源码经符号链接越出所属根时拒绝运行
- **GIVEN** 外部 overlay 根 `<R>` 的 `patches/p.yml` 是指向 `<R>` 之外文件的符号链接,overlay 声明启用的 patch `p`
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息指明 `p` 的源码越出 `<R>`,`cordis.patch.yml` 与运行前逐字节相同

#### Scenario: compat 依赖目录缺失或越界时在物化前拒绝运行
- **GIVEN** overlay 中启用的 local package `q` 声明 `compatDependencies: [{ name: C, path: vendor/c }]`,`<R>/packages/q/vendor/c/package.json` 不存在(或 `vendor/c` 是指向 `<R>` 之外的符号链接),且公开 manifest 顶层 `dependencies` 新增了一个尚未安装的包
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息包含 `vendor/c` 的绝对路径,profile `package.json` 与运行前逐字节相同

#### Scenario: 全新环境预检失败时不创建 profile
- **GIVEN** `$DSH_HOME` 为空目录,overlay 中启用的 patch `p` 缺少 `<R>/patches/p.yml`
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,`$DSH_HOME` 仍为空目录

#### Scenario: DSH_LOCAL_MANIFEST 为相对路径时拒绝运行
- **GIVEN** `DSH_LOCAL_MANIFEST=private/dsh.yaml.local`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息指明该变量必须是绝对路径,profile `package.json` 不变

#### Scenario: DSH_LOCAL_MANIFEST 为相对路径时启动清单降级
- **GIVEN** `DSH_LOCAL_MANIFEST=private/dsh.yaml.local`,profile 中已安装公开 manifest 的 package
- **WHEN** 运行启动清单
- **THEN** 清单以退出码 0 结束并列出公开 package,不列出任何 overlay 条目,标准错误输出包含 `DSH_LOCAL_MANIFEST` 与「绝对路径」

#### Scenario: 外部 overlay 根的 local package 在该根内构建并安装
- **GIVEN** 外部 overlay 根 `<R>` 是含 `workspaces: ["packages/*"]` 的 npm 项目,overlay 声明启用的 local package `q`,`<R>/packages/q/package.json` 声明 `build` 脚本
- **WHEN** 运行 sync
- **THEN** 构建命令以 `<R>` 为工作目录执行,profile `package.json` 中该包的依赖 spec 为 `file:<R>/packages/q`,且公开仓库的 `package.json` 与 `package-lock.json` 内容与运行前逐字节相同

#### Scenario: 外部 overlay 根的 local package 构建失败
- **GIVEN** 外部 overlay 根 `<R>` 中启用的 local package `q` 运行产物缺失,其 `build` 脚本以非零状态退出
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息指明 `q` 构建失败,且不对 `q` 执行安装或移除

#### Scenario: buildInputs 越出 overlay 根时拒绝运行
- **GIVEN** overlay 条目的 `buildInputs` 含 `../outside.txt`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,不产生任何 profile 变更

#### Scenario: overlay 经符号链接置于仓库根
- **GIVEN** 公开仓库根的 `dsh.yaml.local` 是指向 `<R>/dsh.yaml.local` 的符号链接,未设置 `DSH_LOCAL_MANIFEST`,overlay 声明的 patch `p` 仅存在于 `<R>/patches/p.yml`
- **WHEN** 运行 sync
- **THEN** sync 以退出码 0 结束,生成的 `cordis.patch.yml` 含 `fragment: p`

#### Scenario: overlay 以相同 npm 包名顶替公开 package 时拒绝运行
- **GIVEN** 公开 manifest 含 package 条目 `a`(npm 包名 `N`),overlay 含 id 为 `b`、显式 `name: N` 的 remote package 条目
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息包含 `N`、`a` 与 `b`,profile `package.json` 不变

#### Scenario: overlay package 与顶层 dependencies 同名时拒绝运行
- **GIVEN** 公开 manifest 顶层 `dependencies` 含 `D@1.0.0`,overlay 含显式 `name: D` 的 remote package 条目 `b`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息包含 `D` 与 `b`,profile `package.json` 不变

#### Scenario: overlay package 与 compat 依赖同名时拒绝运行
- **GIVEN** 公开 manifest 中 local package `a` 声明 `compatDependencies: [{ name: C, ... }]`,overlay 含显式 `name: C` 的 remote package 条目 `b`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息包含 `C`、`a` 与 `b`,profile `package.json` 不变

#### Scenario: 自动升级不改写 overlay 条目
- **GIVEN** overlay 含 remote package 条目 `b`,升级检查判定其为 upgrade-ready,公开 manifest 无 upgrade-ready 条目
- **WHEN** 以 `--yes` 运行插件自动升级
- **THEN** 命令以退出码 0 结束,输出标明 `b` 需在 overlay 中手动升级,公开 `dsh.yaml` 与运行前逐字节相同,且不产生 git 提交

#### Scenario: 升级检查的每一行携带来源标记
- **GIVEN** 公开 manifest 含 remote package `a`,overlay 含 remote package `b` 与非 npm spec 的 remote package `g`
- **WHEN** 调用升级检查
- **THEN** `a` 的行标记为非 overlay,`b` 与 `g`(skipped)的行都标记为来自 overlay

#### Scenario: 升级检查按 scope 解析 registry
- **GIVEN** overlay 含 remote package 条目,包名为 `@example/q`,profile 目录 npm 配置中 `@example:registry` 指向一个测试 registry
- **WHEN** 运行升级检查
- **THEN** 对 `@example/q` 的元数据查询经由 npm 客户端发往该测试 registry,且请求携带 profile npm 配置中为该 registry 设置的认证令牌

#### Scenario: npm spec 与 name 不一致时拒绝运行
- **GIVEN** overlay 含 remote package 条目 `b`,`spec: dsh-example@1.0.0`,`name: other-name`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息包含 `dsh-example`、`other-name` 与 `b`,profile `package.json` 不变

#### Scenario: 禁用的 overlay local package 缺少源码不阻止 sync
- **GIVEN** overlay 中 local package `q` 为 `enabled: false`,`<R>/packages/q/` 不存在;上一次 sync 曾在 `q` 启用时部署了它
- **WHEN** 运行 sync
- **THEN** sync 以退出码 0 结束,profile `package.json` 的 `dependencies` 中不再含 `q` 的包名

#### Scenario: overlay 源码缺失不阻止 reset
- **GIVEN** overlay 中启用的 local package `q` 与 patch `p` 此前已部署,随后 `<R>/packages/q/` 与 `<R>/patches/p.yml` 被删除
- **WHEN** 运行 `sync --reset`
- **THEN** 命令以退出码 0 结束,profile `package.json` 的 `dependencies` 中不再含 `q` 的包名,`cordis.patch.yml` 不含 `fragment: p`

#### Scenario: 运行体兼容源码缺失不阻止 reset
- **GIVEN** 公开 manifest 中启用的 `dsh-pet` 声明 `hostRuntimeCompatibility`,其运行体构建器文件不存在,profile 已部署受管 package
- **WHEN** 运行 `sync --reset`
- **THEN** 命令以退出码 0 结束,profile `package.json` 的 `dependencies` 中不再含受管 package;同样条件下运行常规 sync 则以非零退出码结束且 `$DSH_HOME` 不变

#### Scenario: 禁用 local package 的 package.json 越出所属根时拒绝运行
- **GIVEN** overlay 中 local package `q` 为 `enabled: false`,`<R>/packages/q/package.json` 是指向 `<R>` 之外文件的符号链接
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息指明 `q` 的 `package.json` 越出 `<R>`,`$DSH_HOME` 不变

#### Scenario: 条目自行声明所属根时拒绝运行
- **GIVEN** 公开 manifest 或 overlay 的某条目声明 `sourceRoot: /tmp/elsewhere` 或 `overlaySource: x`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息指明该字段为保留字段,profile `package.json` 不变

#### Scenario: 启动清单列出外部 overlay 根的 local package
- **GIVEN** 外部 overlay 根 `<R>` 中启用的 local package `q` 的 `package.json` 名为 `@example/q`,且 profile 中已安装该包
- **WHEN** 运行启动清单
- **THEN** 清单中 `@example/q` 一行带有来自 manifest 的说明,而非仅有包自身 `description`

## ADDED Requirements

### Requirement: 定制可声明所需 npm scope 且 sync 在变更前校验
package 定制可(MAY)声明 `npmScopes`:npm scope 名(形如 `@example`)的列表,表示安装该定制需要这些 scope 已配置 registry。sync 必须(SHALL)在加载阶段校验该字段为 scope 名列表,且只出现在 `type: package` 的条目上。对每个启用且声明了 `npmScopes` 的 package 条目,sync 必须(SHALL)在确保 profile 骨架存在之后、任何定制物化动作(agent instructions、顶层 dependencies、package、preset、skill、patch)之前,以 profile 目录为工作目录解析 npm 配置中的 `<scope>:registry`;任一 scope 未配置时,sync 必须(SHALL)报错并以非零退出码结束,错误信息指明缺失的 scope、声明它的条目 id 与 profile 目录,且除 profile 目录与 profile 骨架的创建(DSH 自身的初始化,不属于定制物化)之外,`$DSH_HOME` 不发生任何变化(含部署状态账本的迁移)。sync 不得(SHALL NOT)写入或修改任何 npm registry 配置。禁用条目的 `npmScopes` 不参与校验。

#### Scenario: 所需 scope 已配置
- **GIVEN** 启用的 package 条目声明 `npmScopes: ['@example']`,且 profile 目录的 npm 配置含 `@example:registry`
- **WHEN** 运行 sync
- **THEN** scope 校验通过,sync 继续执行 package 物化,profile 目录中的 `.npmrc` 内容与运行前逐字节相同

#### Scenario: 所需 scope 缺失时在变更前拒绝运行
- **GIVEN** 启用的 package 条目 `q` 声明 `npmScopes: ['@example']`,profile 目录的 npm 配置中不存在 `@example:registry`;profile 已部署其他 package,且公开 manifest 顶层 `dependencies` 新增了一个尚未安装的包
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息包含 `@example`、`q` 与 profile 目录,profile `package.json` 与运行前逐字节相同(新增的顶层依赖也未写入)

#### Scenario: 全新环境所需 scope 缺失
- **GIVEN** `$DSH_HOME` 下尚无 profile,启用的 package 条目 `q` 声明 `npmScopes: ['@example']`,用户级与 profile 级 npm 配置中都不存在 `@example:registry`
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,错误信息包含 `@example`;profile 骨架可以已被创建,但 profile `package.json` 的 `dependencies` 中不含任何 manifest 定制或顶层依赖

#### Scenario: npmScopes 格式非法时拒绝运行
- **GIVEN** package 条目声明 `npmScopes: ['example']`(缺少 `@`)或非列表值
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息指明该条目的 `npmScopes`

#### Scenario: 非 package 条目声明 npmScopes 时拒绝运行
- **GIVEN** patch 条目声明 `npmScopes: ['@example']`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段报错并以非零退出码结束,错误信息指明该条目的 `npmScopes`

#### Scenario: scope 缺失时不迁移旧状态账本
- **GIVEN** `$DSH_HOME` 下只存在旧名称的部署状态账本、不存在当前名称的账本,启用的 package 条目声明的 scope 未配置
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束,旧账本文件仍在原位,当前名称的账本文件不存在

#### Scenario: 禁用条目不参与 scope 校验
- **GIVEN** 禁用的 package 条目声明 `npmScopes: ['@example']`,profile 目录的 npm 配置中不存在 `@example:registry`
- **WHEN** 运行 sync
- **THEN** sync 不因该 scope 报错

### Requirement: 仓库测试与本机 overlay 隔离
仓库测试(`npm test`)必须(SHALL)在不读取运行者本机 overlay 的环境下运行:无论运行者的 shell 是否导出 `DSH_LOCAL_MANIFEST`,也无论公开仓库根是否存在 `dsh.yaml.local`,测试进程继承的 `DSH_LOCAL_MANIFEST` 必须(SHALL)指向一个不存在的路径。需要 overlay 的测试必须(SHALL)显式设置自己的 `DSH_LOCAL_MANIFEST`。

#### Scenario: npm test 屏蔽 shell 中的 overlay
- **GIVEN** 运行者 shell 导出 `DSH_LOCAL_MANIFEST` 指向一个存在的 overlay 文件
- **WHEN** 执行 `npm test`
- **THEN** 测试进程观察到的 `DSH_LOCAL_MANIFEST` 指向的路径不存在

#### Scenario: 测试运行中不读取公开仓库根的 overlay
- **GIVEN** 公开仓库根存在一个声明非法顶层字段的 `dsh.yaml.local`
- **WHEN** 执行 `npm test`
- **THEN** 以公开仓库根为 repo 运行的清单与 sync 类测试不因该文件报错
