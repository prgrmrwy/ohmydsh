# repo-layout Specification

## Purpose
定义 zydsh 仓库的目录结构、总配置 manifest 契约,以及将启用的定制物化到 DSH 部署环境的 sync 行为。

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
`package` 类定制必须(SHALL)是自包含目录,其 `package.json` 必须声明 `dsh.bundle` manifest,其 composition 行必须位于自带 `cordis.patch.yml` 中,从而可通过 `dsh plugin add` 安装。`preset` 类定制必须(SHALL)是包含 `cordis.yml` 的目录。`patch` 类定制必须是 YAML patch-list 片段。`skill` 类定制必须在自身目录下提供 skill 定义。

#### Scenario: 新增 package 定制
- **WHEN** 在 `packages/<name>/` 下新增一个 package 定制
- **THEN** 该目录包含带 `dsh.bundle` 的 `package.json` 与 `cordis.patch.yml`,且 `dsh plugin add` 安装成功

#### Scenario: 新增 preset 定制
- **WHEN** 在 `presets/<id>/` 下新增一个 preset 定制
- **THEN** 该目录包含 `cordis.yml`,且该 preset 可被 DSH roster 挂载

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
- **THEN** 按其类型,其包被安装、其 patch 行被合并、或其 preset 被链接

### Requirement: sync 按来源分发物化
sync 必须(SHALL)按 `source` 分发物化动作:`local` 用仓库路径安装,`remote` 用其 `spec` 从原址安装;两者必须共享相同的开关、幂等与生成标记语义。

#### Scenario: 混合清单一次 sync
- **WHEN** manifest 同时包含已启用的 `local` 与 `remote` 条目
- **THEN** 一次 sync 运行后两类定制全部就位

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
