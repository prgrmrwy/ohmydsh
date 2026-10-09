## Context

`dsh-memex` 每次工具调用与每次设置页取样都会走同一条解析：`npm root -g` → `realpath <root>/@touchskyer/memex` → 校验 `package.json` 版本等于生成物里的 `KERNEL_VERSION`（`packages/dsh-memex/src/run/installation.ts`）。任一环失败都会被 `run/kernel.ts` 统一包成 `KernelError('missing')`，通道把失败码原样交给页面，页面在 `!sync.known` 分支只渲染「远端=不可用 / 详情=<code>」。

内核只存在于**全局 npm root**：`dsh build` 物化 profile 依赖时不会装它，`dsh-sync` 的同步清单（`~/.local/bin/dsh-sync`）只覆盖仓库与个人配置（含 `~/.dsh-memex` 库目录），记忆库里也没有它。因此它的缺失在所有「环境重建」路径上都会复现：换机器、第二个 unix 账号、fresh DSH home、库目录恢复。恢复成本极高而动作极简单（一条 `npm install -g`），差别只在「有没有人记得」。

仓库已有的相邻机制给了直接先例：`startup-autoupdate` 让 `bin/dsh` 在启动/构建/重启前访问 registry 并可能改写 manifest；`dsh-runtime-provisioning` 让启动器 provision DSH 自身运行体，且明确要求「有界、失败可诊断、不静默回退」。本 change 把同一条纪律用在**定制自己的**机器本地前提上。

## Goals / Non-Goals

**Goals**

- 环境重建后**无需人工记忆**：下次 `dsh` 启动即把内核补回声明版本。
- 「这台机器需要什么」写在 `dsh.yaml`，且随定制的 `enabled` / `enabledEnv` 一起开关。
- 健康时不产生任何 npm 子进程、不改动已装包；不健康时**只装声明的那一个精确版本**。
- 失败一律不阻塞启动，且留下可操作的诊断与启动日志记录。
- 页面在失败时给出人能据以行动的理由，而不是内部错误码。

**Non-Goals**

- 不做运行时热修复：页面/工具调用 MUST NOT 触发安装（只用只读事实 + 文案）。安装的触发点只有启动器闸口与显式 `dsh doctor`。
- 不自动升级内核版本：manifest 钉住哪个版本就装哪个版本；升级内核仍是人改 manifest 的动作。
- 不接管存储内核自身的同步语义、不触碰卡片与库内 `.sync.json`。
- 不把 `bin/dsh` 变成通用包管理器：首版只支持 `kind: npm-global`，且只处理**声明过**的前提。
- 不给模型面增加任何安装/配置动作（`dsh-memex-integration` 的「模型面无运维动作」不放松）。

## Decisions

### D1 前提声明放 manifest，不放包内

`dsh.yaml` 是本仓库「这台机器要跑什么」的唯一开关面，且 `enabled: false` / `enabledEnv` 已经表达「这条定制在这台机器上不生效」。把前提写在条目上，禁用定制即自动停止自愈，删除定制即删除需求；写在 `packages/dsh-memex/package.json` 里则会让一条机器级需求藏在包内，并被 profile 物化流程（而非机器）决定是否执行。

代价：`sync.mjs` 多一段校验。收益：与既有 `npmScopes`（同为「manifest 声明 npm 侧需求」的先例）形态一致。

### D2 健康判据只看「版本精确相等」

判定 = 全局 root 下可 `realpath` 到包目录，且其 `package.json.version === 声明版本`。

判据与插件 resolver **同源但不复制其全部校验**：插件额外要求 `bin.memex` 存在、`skills/` 不是符号链接、路径不逃出包根——这些属于「安装产物是否被篡改」的完整性检查，由插件自己 fail-closed 并在页面上说明（D7）。若把它们复制进 provisioner，两处会随内核版本各自漂移；而「装没装、版本对不对」是 provisioner 唯一能独立证明的事实。

版本不符按**不健康**处理并安装声明版本：`npm install -g pkg@0.4.1` 对已存在的 0.4.0 是幂等覆盖，不会留下两个版本；把它当「已满足」才会让插件永远解析失败。

### D3 自愈在启动器，不在 Host/插件进程内

三个候选位置里只有启动器合适：

- 插件/Host 进程内自愈会把「机器级安装」塞进长驻进程，且发生在只读事实通道旁边——正是 spec 禁止的副作用扩散。
- 工具调用内自愈会让一次召回隐式触发全局安装，模型面出现安装动作。
- 启动器本来就是「本机状态的就绪者」（autoUpdate、运行体 provision 都在这里），且它失败只影响本次启动提示，不影响已运行实例。

### D4 有界 + 不阻塞 + 逃生门

安装走既有 `runBoundedProvision`（独立进程组、超时后 TERM/KILL 整棵树、超时=124），默认 180s。启动路径上任何失败（含校验失败、超时、npm 非零）都只打印警告 + 写 `dsh-startup.log`，然后继续启动；`dsh doctor` 才把失败反映为退出码 1。

逃生门 `DSH_SKIP_HOST_PREREQUISITES`（`1/true/yes/on`）用于离线或排障时跳过；跳过也要说一句，避免「以为治过了」。

### D5 registry 解析顺序与启动器既有语义一致，但必须显式传参

顺序：条目 `registry` > 调用方 `npm_config_registry`/`NPM_CONFIG_REGISTRY` > 仓库 `.npmrc` > npm 默认。

启动器已有 `with_repo_registry`（用户显式覆盖优先，仓库 registry 仅按次注入、不 export）。自愈脚本沿用同一优先级，但**把值显式写进 `--registry=`**：全局安装会忽略 cwd 的 `.npmrc`，而内网/私有镜像的用户级配置落后于 npmjs 正是当初 `@touchskyer/memex@0.4.1` 装不上的原因（README 已记录）。

### D6 `enabled`/`enabledEnv` 判定抽出共享实现

sync 与新脚本必须对「这条定制是否启用」给出同一个答案，否则会出现「sync 装了它、自愈不治它」这类只有现场才发现的错配。把 `ENV_BOOL_*` 与 `resolveEnabledOverride` 抽到 `scripts/lib/manifest-enabled.mjs`，sync 改为 import；新脚本调 `loadManifestWithOverlay` + `applyEnvLocal` 后使用同一函数。既有 `sync-customization-enabled-env.test.mjs` 覆盖 sync 侧不回归，新测试覆盖自愈侧。

### D7 页面把内部失败码翻成人话

通道契约不变（仍回失败码——它是诊断线索，测试与日志需要）。页面在 `!sync.known` 分支把失败码映射为可读原因，并用同一次取样里的 `kernel.expected` / `kernel.version` 补出「需要哪个版本、现在是什么状态」。

映射：`missing`（含版本不符，二者同码）→ 「内核未就绪：需要 `@touchskyer/memex@<expected>`，当前<未检测到|检测到 <version>>；启动器会在下次 `dsh` 启动时自动安装」；`timeout` → 「内核无响应（超时）」；其余码保持原样显示（未知码不猜）。

MUST NOT 在页面上提供安装按钮：安装是机器级动作，页面只解释与指向 `dsh doctor`。

## Risks / Trade-offs

- **启动变慢**：仅在缺前提时才会真的安装（约 40s）；健康路径只多一次 `npm root -g`（数百毫秒），且没有声明时零子进程。可接受。
- **启动器为一条定制破例访问 registry**：与 autoUpdate 同类（后者也联网、也可能改写 manifest）。差别是自愈不改仓库文件，只在机器上装包。
- **`npm root -g` 依赖 PATH 上的 node**：与插件的解析同源，因此「自愈看到的全局 root」与「插件看到的」一致；若用户切换 node 版本，两边一起变，不会各说各话。
- **不做热修复**：内核在 Host 运行期间被删掉时，页面只会说明原因，需 `dsh doctor` 或重启。这是刻意的：把安装副作用限制在两个显式触发点。
