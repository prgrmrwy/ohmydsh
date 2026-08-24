## ADDED Requirements

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
