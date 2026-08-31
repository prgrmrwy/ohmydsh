## Context

`dsh-traex-bridge`(`dsh.yaml` 第 173-180 行)是仓库里第一个"内部专属"定制:bnpm 私有 registry、内网鉴权、内网推理端点。仓库本身托管在公开 GitHub(`git@github.com:prgrmrwy/ohmydsh.git`),`enabled: true` 是把一个只对特定机器有意义的行为焊死成全仓库默认值。

仓库已经有一个结构完全相同的先例:`web.lan`(manifest 默认值,布尔)与 `DSH_LAN`(同名环境变量,`.env.local` 或行内均可,优先级更高)——`scripts/sync.mjs:27-56` 的 `LAN_TRUE`/`LAN_FALSE`/`resolveWebLan()`。区别只在于 `web.lan` 是**唯一的顶层开关**,而这次要覆盖的是**customizations 列表里某一项**的 `enabled`,需要能按 `id` 区分、不影响其他定制。

## Goals / Non-Goals

**Goals:**
- `dsh-traex-bridge` 默认(仓库 `dsh.yaml` 原样,任何人 clone 后直接 `dsh build`)不安装、不启用,对无 bnpm 访问权限的机器零副作用。
- 在有权限的机器上,通过环境变量(`.env.local` 或行内)即可打开,不需要碰 `dsh.yaml`、不产生 git diff。
- 复用 `web.lan`/`DSH_LAN` 已验证的真值/假值判定与优先级模型,而不是发明一套新语义。
- 该机制对 manifest 里**任意**定制项通用,不是只服务 `dsh-traex-bridge` 的特判——未来同类"内部/风险/机器专属"定制可直接复用,不需要再改 `scripts/sync.mjs`。

**Non-Goals:**
- 不改变 `enabled` 字段本身的既有语义(手写布尔、默认值 `true`)。
- 不引入"多个环境变量组合判定"或"环境变量值即插件配置"这类更复杂的语义——`enabledEnv` 只做启用/禁用的布尔覆盖。
- 不处理 remote 定制的凭据/密钥管理(那是运行时插件自己的职责,`dsh-traex-bridge` 已有 `~/.dsh/traex-bridge/auth.json`)。
- 不改 `bin/dsh` 启动器:`.env.local` 的 source 与向 `sync.mjs` 子进程传递环境早已存在(`resolveWebLan` 已证明这条路径可用),新字段不需要新的传递通道。

## Decisions

### D1:折算发生在 `loadManifest()` 内,把结果写回 `item.enabled`

`scripts/sync.mjs` 的 customization 校验(`items = doc.customizations.map(...)`)已经在同一处对 `source`/`buildInputs`/`compatDependencies` 做归一化并写回新对象(`return { ...item, source, enabled: item.enabled !== false, ... }`)。`enabledEnv` 的覆盖折算加在同一行:如果该项声明了 `enabledEnv` 且环境变量给出可识别的真/假值,`enabled` 字段直接取覆盖结果;否则保持现有的 `item.enabled !== false`。

好处:`syncPackages`/`syncDirs`/`syncPatches` 以及测试里对 `item.enabled` 的读取**零改动**——它们看到的已经是"有效启用状态",不需要知道这个值是手写的还是被环境变量覆盖的。这与 `resolveWebLan()` 的模式不同(那是顶层单一开关,调用点只有 `syncPatches` 一处,值得单独一个函数);但对 per-item 覆盖来说,提前折算能避免在三个 sync 函数里重复"先查 enabledEnv 再查 enabled"的逻辑。

- **备选:在每个 `sync*` 函数内部现查 `process.env[item.enabledEnv]`** — 被否。三处重复判定逻辑,且 `syncPackages` 内部还有"disabled owner 一次性连带清理 compatDependencies"等分支,分散判定容易漏改。

### D2:真值/假值词表提取为共享 helper,与 `DSH_LAN` 完全一致

新增 `resolveEnabledOverride(envValue)`,复用现有的 `LAN_TRUE`/`LAN_FALSE`(`Set(['1','true','yes','on'])` / `Set(['0','false','no','off'])`),返回 `true`/`false`/`undefined`(`undefined` = 未设置或无法识别,调用方回退)。`resolveWebLan()` 改为调用该 helper,消除重复,同时保证两套覆盖机制的用户心智模型一致(同样的拼写在两处含义相同)。

- **备选:两套独立词表** — 被否,纯粹增加认知负担,且日后其中一套改了容易漏改另一套。

### D3:`enabledEnv` 值必须匹配 `^DSH_[A-Z0-9_]+$`,否则 fail closed

`web.lan`/`DSH_LAN` 是仓库写死的唯二拼写,不需要校验。但 `enabledEnv` 是**手写字符串**,校验缺失会带来一个隐蔽陷阱:如果用户写错大小写或漏了 `DSH_` 前缀(如 `enabledEnv: TRAEX_BRIDGE`),这个环境变量实际上永远不会被外部设置成"看起来对"的名字,`resolveEnabledOverride` 会一直返回 `undefined` 静默回退到 `enabled` 字段——表现为"这个开关好像不生效",且没有任何报错线索。因此在加载 manifest 阶段就校验格式并 fail closed,把错误尽早暴露给编辑 `dsh.yaml` 的人,而不是留到运行时观察一个"不工作的开关"。

格式选择 `DSH_` 前缀 + 大写下划线,与仓库 README/`.env.local.example` 中全部既有环境变量(`DSH_LAN`、`DSH_OPEN_APP`、`DSH_HOME`、`DSH_PROFILE`、`DSH_SKIP_UPDATE`、`DSH_UPDATE_CHANNEL`……)的命名约定完全一致,不引入新的前缀空间。

- **备选:不校验,允许任意字符串** — 被否,如上,静默失效是比拒绝启动更差的失败模式。
- **备选:校验但只警告不中止** — 被否,manifest 加载阶段的错误必须 fail closed(仓库既有约定:`agentInstructions`/`web.lan` 等字段的非法值都是直接 throw,中止整个 sync),警告容易被终端输出淹没。

### D4:`dsh-traex-bridge` 改为 `enabled: false` + `enabledEnv: DSH_TRAEX_BRIDGE`

变量名沿用条目 id(`dsh-traex-bridge` → `DSH_TRAEX_BRIDGE`),可读性最好。本机(当前 ByteDance 内部环境)需要在 `.env.local`(gitignored)追加 `DSH_TRAEX_BRIDGE=1`,否则下次 `dsh build`/`dsh restart` 会把已部署的插件当作禁用移除——这是本变更唯一的运行时副作用,已在 proposal 的 Impact 段落写明,任务清单里会包含"本机验证前先设置该变量"这一步,避免验证过程本身把插件移除后又要重装。

- **备选:保持 `enabled: true`,只在 README 里警告"公开仓库场景请手动改成 false"** — 被否,不解决"clone 即默认开启"的根本问题,且违反"仓库对外可分享"的定位。

## Risks / Trade-offs

- **[通用机制 vs 一次性特判的取舍]** 为一个当前只有一个使用者(`dsh-traex-bridge`)的需求引入 manifest 新字段,略微增加 schema 复杂度。缓解:实现成本与"在 `syncPackages` 里为这一个 id 硬编码 if 分支"基本相当(共享 helper 复用 `web.lan` 已有代码,净增量约 20-30 行),但换来的是后续任何同类内部/风险定制都能零代码复用;且完全遵循仓库 `repo-layout` 已确立的"定制可独立启用/禁用"原则与 `web.lan`/`DSH_LAN` 先例,不是新发明一套模式。
- **[本机已部署的 `dsh-traex-bridge` 在下次 sync 时被移除]** 见 D4。缓解:validation/tasks 顺序上先在本机 `.env.local` 设置 `DSH_TRAEX_BRIDGE=1` 再跑验证性的 `dsh build`,确保端到端验证的是"环境变量打开"路径而不是意外先经历一次移除。
- **[环境变量名与 manifest id 不同步]** 如果日后 `dsh-traex-bridge` 改名而 `enabledEnv` 忘记跟着改,不会报错(id 与 enabledEnv 之间没有强制关联)。缓解:这与 `deps`/`compatDependencies` 等字段的可维护性风险同级,不属于本变更需要额外加固的范围;`note` 字段的审查记录约定已经足够覆盖这类人工疏漏。

## Migration Plan

1. 实施后本机 `.env.local` 追加 `DSH_TRAEX_BRIDGE=1`(不提交,gitignored)。
2. `dsh build` 验证:插件仍在部署面(bundles 列表、`cordis.patch.yml` 含 `llm-traex-bridge` 片段),连续第二次 `dsh build` 报 no changes。
3. 回滚:`git revert` 本变更集中的 commit 即可——manifest 恢复 `enabled: true`,`scripts/sync.mjs` 恢复无 `enabledEnv` 支持,无持久化状态迁移。
