## Context

- profile 的 `pnpm-workspace.yaml` 由 DSH 运行体的 `initProfile` 生成（`packages`、`nodeLinker: hoisted`、`autoInstallPeers: false`），由 sync 的 `ensureProfileScaffold` 触发（`scripts/sync.mjs:717`）。之后 sync 再也不碰这个文件。
- 失败的插件安装会由 DSH 插件管理器还原 `package.json` 与锁文件，但不还原 `pnpm-workspace.yaml`。因此 pnpm 写下的占位符会一直留在文件里，导致后续每次安装都失败。
- sync 的所有插件动作都经 `dshCli(['plugin', ...])` 发起（`scripts/sync.mjs:683`，共 15 处调用）。失败只记一条 `fail()`，然后继续处理下一个，结尾汇总。这对网络之类的独立失败是对的，但 IGNORED_BUILDS 会让之后的每一次安装都必然失败。
- 预检顺序已有先例：`preflightScopes` 排在骨架之后、账本迁移与任何定制物化之前（`scripts/sync.mjs:2030`）。

## Goals / Non-Goals

**Goals：** 让构建脚本授权回到 `dsh.yaml`；新机器首次 build 不再需要手改部署目录；未决定的条目只报一次首因。

**Non-Goals：**
- 不检查或限制 pnpm 版本，也不处理锁文件缺 `integrity` 的问题（记入 BACKLOG）。
- 不自动审查依赖的安装脚本，也不给出 true/false 建议。
- overlay 不支持 `pnpmAllowBuilds`。

## Decisions

### D1 顶层字段 `pnpmAllowBuilds`，不挂在单个定制上

构建脚本授权针对的是传递依赖（例如 `@google/genai` 来自 `@earendil-works/pi-ai`，同时被多个插件共享），不属于某一个定制。挂在定制条目上会出现"两个条目对同一依赖给出相反决定"的冲突。备选：每个定制声明自己需要的授权，再由 sync 合并。这需要额外的冲突规则，而且用户在报错时也不知道该去改哪个条目，因此不采用。

### D2 写入时机：账本迁移之后、`syncDependencies` 之前

写文件属于 `$DSH_HOME` 变更，必须排在 `preflightScopes` 之后，以保持 npm scope 预检"变更前拒绝"的承诺。账本迁移要先做，D3 的所有权记录需要读账本。之后才是第一个插件安装动作（`syncDependencies`）。整个步骤持有 profile 写锁（`withProfileLock`，以 `pnpm-workspace.yaml` 为锁对象），与 package.json 的写者互斥方式保持一致。

### D3 用 `yaml` 的 Document API 局部修改

只增删改 `allowBuilds` 下的键，保留注释、键序和其它顶层字段。先比较目标值和部署值，没有差异就不写文件，从而满足"逐字节相同"。新增的键追加到末尾。值是占位符的已声明键直接替换。

### D4 账本字段 `pnpmAllowBuilds: { <dep>: <bool> }`

记录 sync 最后一次写入的值。撤销规则见 spec：部署值仍等于记录值才删除，否则报漂移并保留。`--reset` 走同一条撤销路径：撤销全部已记录、且部署值未被改动的条目。

### D5 预检未决定条目：在 D2 写入之后立刻扫描

扫描在任何安装之前进行。任何非布尔值都算未决定（不硬编码 pnpm 的占位文案，以适应 pnpm 改文案）。抛出的错误由 `main` 的 catch 输出，并以非零退出码结束。

### D6 安装失败后的首因判定：包装 `dshCli` 的 plugin 调用

新增 `pluginCli(args, opts)`，替换 15 处 `dshCli(['plugin', …])`。失败时重新扫描 `allowBuilds`，若出现了运行前不存在的未决定键，就抛出与 D5 同形的错误，中断整次运行。其它失败的处理与现状相同（返回 false，交给调用方 `fail()`）。备选：在结尾汇总时再提示。但那时几十个次生失败已经刷屏，首因被淹没，不采用。

## Risks / Trade-offs

- [pnpm 未来改变 `allowBuilds` 的键格式（例如 `name@version`）] → 键按字符串原样写入，不做格式推断；声明的键与 pnpm 写入的键必须字面相同，错误信息会原样列出 pnpm 写入的键，供用户照抄。
- [中断整次运行，导致与此无关的后续定制这一轮没有物化] → 这些安装本来也必然失败。中断后部署面与运行前相同，修正 manifest 后重跑即可收敛。
- [用户手改的值被 manifest 覆盖] → manifest 是唯一真相源，这符合仓库原则。覆盖会作为 change 输出，可见。

## Migration Plan

已部署的机器首次运行：主力机现有的三条与声明一致，表现为空操作，只在账本中补记所有权（不算部署变化）。pvedev 已经手改为 false 的两条同样一致。回滚：删除 `pnpmAllowBuilds` 字段并重跑 sync，由 D4 撤销 sync 写过的条目。
