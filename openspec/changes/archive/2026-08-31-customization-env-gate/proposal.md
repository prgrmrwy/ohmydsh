## Why

`dsh-traex-bridge` 是仓库里唯一的内部包定制:来自 bnpm(`http://bnpm.byted.org`)、仓库在 `code.byted.org`,鉴权与推理流量都打 ByteDance 内网服务。当前它在 `dsh.yaml` 里 `enabled: true`,意味着**任何**克隆本仓库(公开在 GitHub)的机器执行 `dsh build` 都会尝试安装并启用它——在无内网访问的机器上要么装不上(bnpm 不可达),要么装上了也无法登录使用,且会把默认模型覆盖成 `traex/DeepSeek-V4-Flash`(该 patch 自带的行为),影响一个原本不该受它影响的环境。

需要的是:仓库里默认关闭(对外可分享、对无权限机器安全),但在确有权限的本机(如当前 ByteDance 内部环境)可以不改 `dsh.yaml`、不污染 git 历史地临时/长期打开——用环境变量。这正是 `web.lan`/`DSH_LAN` 已验证过的模式(manifest 默认值 + 同名 env 可逆覆盖,`.env.local` 承载机器专属选择)。与其为 `dsh-traex-bridge` 写一次性特判,不如把这个模式提升为 manifest 对任意定制项都可声明的通用能力,复用同一套真值/假值解析,供未来同类"内部/风险/机器专属"定制复用。

## What Changes

- `repo-layout` 新增一条能力:manifest 中每项定制(`package`/`preset`/`patch`/`skill`,`local`/`remote` 均可)可(MAY)声明可选字段 `enabledEnv: DSH_XXX`(必须是 `DSH_` 前缀的大写环境变量名,与仓库现有环境变量命名约定一致)。声明后,sync 计算该定制**有效启用状态**时优先读取同名环境变量:识别到真值(`1`/`true`/`yes`/`on`)则视为启用,识别到假值(`0`/`false`/`no`/`off`)则视为禁用,未设置/空白/无法识别时回退到该定制自身的 `enabled` 字段(未声明按 `true`)。该覆盖复用与 `enabled` 完全相同的可逆语义:禁用只影响物化,不删除仓库内容。
- `scripts/sync.mjs`:在 manifest 加载阶段(而非分散到各 `sync*` 函数)统一折算每项定制的有效 `enabled`,下游 `syncPackages`/`syncDirs`/`syncPatches` 无需改动即可遵循;非法 `enabledEnv` 取值在加载期即报错并中止,不产生任何物化动作。真值/假值解析复用与 `web.lan`/`DSH_LAN` 完全相同的词表,抽成共享 helper 消除重复。
- `dsh.yaml`:`dsh-traex-bridge` 条目改为 `enabled: false` 并新增 `enabledEnv: DSH_TRAEX_BRIDGE`,manifest 顶部字段约定注释同步补充说明。
- `.env.local.example`:新增一条注释示例,说明该机制与 `DSH_TRAEX_BRIDGE=1` 的具体用法。
- 不需要改动 `bin/dsh`:启动器早已 `source .env.local` 并把普通环境变量透传给 `node scripts/sync.mjs`,新字段读取的是标准 `process.env`,复用既有传递路径。
- **非破坏性,但有一次性运行时影响**:已经把 `dsh-traex-bridge` 部署在本机的用户,升级本仓库后若不设置 `DSH_TRAEX_BRIDGE=1` 就执行 `dsh build`,该插件会被当作禁用移除出部署面(仓库源码/manifest 记录不受影响,可随时用环境变量恢复)。

## Capabilities

### New Capabilities
(无新增独立 capability;本变更扩展既有 `repo-layout` 的 manifest 契约与 sync 行为。)

### Modified Capabilities
- `repo-layout`: 新增一条 Requirement——manifest 定制项可通过声明 `enabledEnv` 让其有效启用状态被同名环境变量覆盖,新增 Requirement 不修改任何既有 Requirement 的文字。

## Impact

- `scripts/sync.mjs`:`loadManifest()` 内的 customization 校验与归一化逻辑;`resolveWebLan()` 的真值/假值解析抽成共享 helper。
- `dsh.yaml`:`dsh-traex-bridge` 条目 `enabled`/`enabledEnv`,字段约定注释。
- `.env.local.example`(仓库内示例模板);本机 gitignored `.env.local` 补 `DSH_TRAEX_BRIDGE=1` 以避免本机功能回退(不进入版本控制)。
- `README.md`:补充该通用机制的文档,与既有 `web.lan`/`DSH_LAN` 说明呼应。
- `tests/`:新增覆盖 manifest 校验、真值/假值覆盖两个方向、回退语义与幂等性的黑盒测试。
- 运行时影响:仅在执行 `dsh build`/`dsh -b`/`dsh restart` 等触发 sync 的入口时生效;已运行的 server 需要重启才能反映插件加载状态的变化(与现有 `enabled` 开关语义一致)。
