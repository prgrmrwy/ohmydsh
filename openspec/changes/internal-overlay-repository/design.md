## Context

`local-manifest-overlay`(已归档)让不可公开的定制条目离开公开 `dsh.yaml`,但条目引用的
**源码**仍被 sync 固定到公开仓库根解析。当前所有 local 路径都以 `REPO` 为前缀:

| 位置 | 用途 |
|---|---|
| `scripts/sync.mjs` `npmNameOf` | 读 `packages/<id>/package.json` 取包名 |
| `scripts/sync.mjs` `localBuildInputHash` | `buildInputs` 以 `REPO` 为根 |
| `scripts/sync.mjs` `runLocalBuild` | `npm run build --workspace <name>`,cwd = `REPO` |
| `scripts/sync.mjs` `syncPackages` | 路径修复的期望 spec 与 `localDir` |
| `scripts/sync.mjs` `syncDirs` | preset / skill 源目录 |
| `scripts/sync.mjs` `syncPatches` | `patches/<id>.yml` |
| `scripts/plugin-list.mjs` | local 包名解析 |

`scripts/lib/plugin-updates.mjs` 只处理 remote 条目,不需要所属根,但只用一个默认
registry 查询,私有 scope 包会永久「registry 查询失败」(见 D8);`scripts/plugin-update.mjs`
只会改写公开 `dsh.yaml`,遇到 overlay 行会抛错(见 D8)。`scripts/lib/dsh-host-runtime.mjs`
的运行体围栏只接受 id 为 `dsh-pet` 的 local package,而 overlay 不能使用公开 id,故不需要
改动。

此外,`syncPatches` / `syncDirs` 在源码缺失时记录失败后继续物化其余条目,sync 非零退出
但部署面已变(见 D7)。

把源码放进公开仓库再 gitignore 行不通:根 `package.json` 的 `workspaces: ["packages/*"]`
不看 `.gitignore`,私有包会进入公开 `package-lock.json`,在无内网 registry 的机器上
`npm ci` 失败。

## Goals / Non-Goals

**Goals:**
- 一个私有仓库与 ohmydsh 目录同构,承载不可公开定制的源码与条目;`dsh build` 仍是唯一入口。
- 公开仓库的文件(含 lockfile)不因私有仓库存在而变化。
- 私有包安装所需的内部 registry 在缺失时尽早、明确地失败,而不是在 pnpm 中途失败。
- 换机器只需:克隆私有仓库、在私有仓库安装依赖、在 `.env.local` 写一行路径、配置 profile npm scope。

**Non-Goals:**
- 多个 overlay 或 overlay 链;sync 拉取/更新私有仓库;sync 写 registry 配置。
- 私有仓库内容本身(条目迁移、私有 package 实现)。
- 改变 `hostRuntimeCompatibility` 的归属或 patch 生成格式。

## Decisions

### D0. 信任模型:overlay 根与公开仓库同等可信

私有仓库由同一个使用者维护,与公开仓库处于同一信任级别。本 change 的越界与预检检查
针对**配置错误**(路径写错、私有仓库没克隆、切错分支),而不是恶意 overlay。据此:
入口路径做 realpath 越界检查;源码目录内部嵌套的符号链接不检查(公开仓库也从未检查)。
「只追加」边界(不覆盖公开条目、不顶替公开包名)仍然保留:它防的是误操作把公开定制
悄悄替换掉,而不是防攻击者。

### D1. overlay 根 = overlay 文件经 realpath 后的目录

不新增环境变量。`DSH_LOCAL_MANIFEST` 已经指向私有仓库里的文件,文件所在目录天然就是
私有仓库根;默认路径下该目录就是公开仓库根,现有行为不变。先 `realpath` 再取目录,
这样把公开仓库根的 `dsh.yaml.local` 软链到私有仓库也能工作。

备选 A:新增 `DSH_LOCAL_ROOT`。拒绝:两个变量可以互相矛盾(文件在 X,根在 Y),
多一种配置错误,却不增加表达能力。
备选 B:条目内声明 `path:` 指向任意目录。拒绝:每条都要写绝对路径,违背「同构」;
而且把任意文件系统位置变成可由 manifest 控制的输入。

### D2. 所属根作为 sync 内部字段,由加载器推导,禁止条目自行声明

`manifest-overlay.mjs` 给 overlay 条目附加 `sourceRoot`(与现有 `overlaySource` 并列),
`loadManifest` 给公开条目附加 `REPO`。所有路径拼接改为读 `item.sourceRoot`。两个字段
都是保留字段:原始 YAML 中出现即报错,避免公开 manifest 条目声明 `sourceRoot` 把源码
重定向到任意目录。

备选:按 `overlaySource !== undefined` 在每个消费点分支。拒绝:分支分散在七处,漏一处就
退回公开根,正是本 change 要消除的那类不一致。

### D3. overlay 根的 local build 以 overlay 根为 cwd

`runLocalBuild` 的 cwd 改为 `item.sourceRoot`,命令不变(`npm run build --workspace <name>`)。
私有仓库因此需要自己的 `package.json`(含 `workspaces`)和 lockfile,构建依赖在私有仓库
内安装。公开根 lockfile 不受影响,这是对「仓库依赖锁采用根级单一来源」的一致延伸:
**每个根**一个 lockfile。

备选:在 package 目录内执行 `npm run build`(不走 workspace)。拒绝:与公开包的构建语义
不同,会让同一个 package 在两个仓库之间迁移时行为不同,违背同构目标。

### D4. `npmScopes`:只校验不写入,在一切物化之前

条目声明所需 scope;sync 在 `main()` 中 `ensureProfileScaffold` 之后、
`syncAgentInstructions` / `syncDependencies` / `syncPackages` 之前运行 scope 预检
(源码预检更早,见 D7),
对每个启用条目的每个 scope 以 profile 目录为 cwd 执行一次
`npm config get <scope>:registry`,结果为空或 `undefined` 即报错并结束,不进入任何物化步骤。
按 scope 去重,只查询一次。

顺序上的取舍:profile 骨架必须先存在,profile `.npmrc` 才可能存在并参与解析,所以 scope
预检只能排在 `ensureProfileScaffold` 之后。因此规格允许「scope 缺失而失败」时 profile
骨架已被创建——骨架是 DSH 自身的 `--dump-default-config` 初始化,不含任何定制,
也是之后正确配置 scope 的前提(用户需要在该目录下写 `.npmrc`)。源码预检没有这个依赖,
所以更严格:它在 `$DSH_HOME` 的任何写入之前运行。

备选:scope 预检改为在用户级配置(不指定 cwd)上解析,放到骨架之前。拒绝:profile 级
`.npmrc` 是本仓库已在用的配置位置(本机已有 scope 就配置在那里),忽略它会误报。

用 `npm config get` 而不是解析 `.npmrc`,是为了与实际安装时 npm 的配置解析一致:
用户级 `~/.npmrc`、profile `.npmrc`、环境变量 `npm_config_*` 都算。`bin/dsh` 的
`with_repo_registry` 只注入**默认** registry,不影响 scope 解析。

备选:overlay 声明 scope→registry 映射,由 sync 写入 profile `.npmrc`。用户已选择不做:
这会让 overlay 第一次拥有修改部署环境的能力,扩大信任面。

### D5. npm 包名唯一性:加载阶段只做无源码检查,读源码的部分在预检之后

现有规则只防 id 冲突。overlay 可以用不同 id、相同 `name` 的 remote 条目,在 profile
`package.json` 中替换公开 package 的依赖 spec,这是「只追加」边界上的一个漏洞。
分两段:

1. `loadManifest`(不读源码):npm registry spec 的 remote 条目若声明 `name`,必须等于从
   `spec` 解析出的包名——`npmNameOf` 优先信任 `name`,而安装用的是 `spec`,两者不一致时
   唯一性检查会被一个假名字绕过。
2. `resolvePackageNames(items)`(读源码,位于源码预检之后、`$DSH_HOME` 写入之前):求出全部
   package 条目的包名。禁用的 local 条目不在预检范围内,因此单独处理:`package.json` 缺失时
   跳过,不报错;存在时先做与预检相同的 realpath 越界检查再读取,越界即报错,与顶层
   `dependencies` 以及所有 `compatDependencies[].name` 一起检查唯一性(三者共享 profile
   `package.json` 的 `dependencies` 键空间)。现有 `syncPackages` 内的 compat 唯一性检查
   保留作为防御。

禁用的 local 条目源码缺失时视为不在 manifest 中:`syncPackages` 的「从 manifest 删除」
分支依据状态账本 `managedPackages` 中的旧包名移除它,无需读源码。这保证私有仓库暂时
缺席时,禁用私有插件仍能完成清理。

`hostRuntimeCompatibility`:`declaredHostRuntimeFromManifest` 现在在加载阶段检查
`build-launcher.cjs` 存在性,会让 `--reset` 因源码缺失失败。拆为两段:声明校验
(归属、kind、版本)留在 `declaredHostRuntimeFromManifest`,构建器存在性检查移到新导出的
`assertHostRuntimeSources(runtime)`;sync 在 `preflightSources` 中调用它,Host 启动路径
(`loadDeclaredHostRuntime`)保持在返回前调用它,启动时的行为不变。

`--reset` 分支不做源码预检、不解析包名(顺序见 D7);`doReset` 现有实现只读 profile
`package.json` 与状态账本,满足要求。

禁用条目也纳入检查:禁用的公开条目与启用的 overlay 条目同名时,sync 的「移除禁用包」
逻辑会与安装冲突。

### D6. 测试隔离放在 `npm test` 入口

`package.json` 的 `test` 改为 `DSH_LOCAL_MANIFEST=/nonexistent/... node --test ...`
(具体值指向一个保证不存在的路径)。已有显式设置 `DSH_LOCAL_MANIFEST: ''` 的测试需要
复查:空字符串会退回默认路径,即公开仓库根的 `dsh.yaml.local`,对以临时仓库为 repo 的
fixture 无影响,对以 `REPO` 为 repo 的测试有影响。

备选:修改每个测试的 env。拒绝:当前约 20 个测试文件以 `...process.env` 继承环境,逐个
修改容易遗漏,而且新测试会重犯。

### D7. 源码预检:缺失或越界时一次都不物化

现状:`syncPatches` 缺片段时记一条 failure 然后继续,用剩余片段重写 `cordis.patch.yml`;
`syncDirs` 缺文件时跳过该条目但继续复制其他条目。sync 最终非零退出,但部署面已经变了。
引入外部 overlay 根之后,「私有仓库没 clone / 切到了别的分支」会变成常见状况,这种
「失败但已改动」会悄悄把私有 patch 从 profile 中剥掉。

改为在 `main()` 中、`loadManifest()` 之后紧接着(在 `mkdir(PROFILE_DIR)`、
`migrateLegacyState`、`ensureProfileScaffold` 这些 `$DSH_HOME` 写入之前)对所有启用条目运行
`preflightSources(items)`:解析每条的源码路径(package → `packages/<id>/package.json`
及每个 `compatDependencies[].path/package.json`,preset → `agent.cordis.yml`,
skill → `SKILL.md`,patch → `<id>.yml`,加上 `buildInputs`),检查存在性,再对路径和所属根
分别 `realpath`,用 `path.relative` 判断是否越界(与 `syncAgentInstructions` 现有的
越界检查同一写法)。收集全部错误后一次性报出并退出。公开条目同样受益,这是有意的行为
收紧:此前公开条目缺源码时同样会出现部分物化。

`--reset` 不预检:reset 只依据状态账本移除受管部署,源码缺失不应阻止撤销。

`main()` 中的顺序因此是:
- `--reset`:与现状相同,`loadManifest` → `mkdir(PROFILE_DIR)` → `migrateLegacyState` →
  `ensureProfileScaffold` → `doReset`,不插入任何预检。
- 常规 sync:`loadManifest` → `preflightSources` → `resolvePackageNames` →
  `mkdir(PROFILE_DIR)` → `ensureProfileScaffold` → `preflightScopes` → `migrateLegacyState` →
  各物化步骤。`migrateLegacyState` 从现在的位置(scaffold 之前)后移到
scope 预检之后,使「scope 缺失」时 `$DSH_HOME` 除 profile 骨架外不变。迁移只搬动账本文件,
不依赖 scaffold,后移不改变其语义。

各物化函数内既有的存在性检查保留(防御 TOCTOU),但正常路径下不再触发。

### D8. 升级检查按 scope 走 npm 客户端;自动升级不碰 overlay

- `detectRemotePluginUpdates`:对 scoped 包,先以 profile 目录为 cwd 用
  `npm config get <scope>:registry` 判断该 scope 是否配置了 registry(按 scope 缓存)。已配置时
  用 `npm view <name> dist-tags versions time peerDependencies deprecated --json`
  (cwd = profile 目录)取元数据,npm 自己处理 registry 与 `_authToken`;未配置时保持现有
  `fetch` 默认 registry 的路径。无 scope 的包不变。
  备选:解析 `.npmrc` 中的 `//host/:_authToken` 自己拼请求头。拒绝:重新实现 npm 的配置
  解析(环境变量插值、多层 `.npmrc`、多种认证方式),容易与安装时的实际行为不一致。
- `detectRemotePluginUpdates`:每一行(含 skipped)增加布尔字段 `fromOverlay`,取自合并后
  条目的 `overlaySource !== undefined`;`check-plugin-updates.mjs` 的输出可顺带标注。
- `plugin-update.mjs`:从 `ready` 中分出 `fromOverlay` 为真的行,打印
  「需在 overlay 中手动升级」后排除;只对公开行做改写、sync、commit。只剩 overlay 行时
  与「全部已是最新」同样以 0 退出。

备选:由 `plugin-update` 改写 overlay 文件。拒绝:overlay 在私有仓库中,改写后 commit 的
归属、仓库都不同;自动提交到另一个仓库的范围超出本 change。

### D9. `DSH_LOCAL_MANIFEST` 必须是绝对路径

现状 `path.resolve(override)` 接受相对路径,解析结果依赖调用者 cwd;路径错过文件时按「缺失是
常态」静默跳过。overlay 根现在决定源码位置,静默错指的代价更高。

`resolveOverlayPath` 对非空白非绝对值抛错。各消费方的处理与各自已有的失败语义一致:
- sync、升级检查、自动升级:strict 加载,错误向上传播,非零退出。
- 启动清单(`plugin-list.mjs`):已有的「overlay 绝不阻塞清单」语义不变——捕获错误,
  不列 overlay 条目,但**新增**向 stderr 打印该错误(现状是静默吞掉)。清单在 DSH 启动路径上,
  让它失败会把配置错误升级成启动失败。注意 `bin/dsh` 启动时以 `2>/dev/null` 调用清单,这条 stderr 在启动
  路径上不可见;可见的报错面是 `dsh build`(sync 非零退出),而启动总以 build 为前置。

### D10. 生成标记头改为泛指

`GENERATED_HEADER` 目前写「Source of truth: <REPO>/dsh.yaml and patches/」。外部 overlay
根的片段也会进入该文件。改为「Source of truth: <REPO>/dsh.yaml (plus the local manifest
overlay, if any)」,不写出 overlay 路径,避免 profile 文件泄露私有仓库位置。

## Risks / Trade-offs

- [私有仓库路径变化后,已部署 spec 仍指向旧路径] → 复用 `syncPackages` 现有的路径修复
  逻辑,它以期望 spec 为准重写;期望 spec 改为 `file:<sourceRoot>/packages/<id>`。
- [worktree 中默认看不到私有 overlay] → 私有 overlay 通过 `.env.local` 中的
  `DSH_LOCAL_MANIFEST` 绝对路径接入,不依赖 gitignored 文件被复制;在文档中写明。
- [`npm config get` 每个 scope 都要启动一个子进程] → 仅对启用且声明 `npmScopes` 的条目
  执行,按 scope 去重;未声明时零开销。
- [私有仓库的 build 依赖未安装] → 构建失败走现有 local build 失败路径(替换已部署包前
  停止);错误信息附加所属根,提示在该根执行 `npm ci`。
- [`sourceRoot` 进入部署状态文件] → 不写入。状态以 id / 包名为键,不记录所属根。

## Migration Plan

1. 本 change 落地后,现有默认路径 overlay(仓库根 `dsh.yaml.local`)行为不变,无需迁移。
2. 建私有仓库:`dsh.yaml.local` + `packages/` 等 + `package.json`(`workspaces`)+ lockfile。
3. 在公开仓库 `.env.local` 设置 `DSH_LOCAL_MANIFEST=<私有仓库>/dsh.yaml.local`,删除旧的
   仓库根 `dsh.yaml.local`(或改为软链)。
4. 运行 `dsh build`,再运行一次确认无变化。

回滚:删除 `.env.local` 中的那一行;下一次 sync 将 overlay 条目视为「从 manifest 删除」
并按现有逻辑卸载。

## Open Questions

- 私有仓库是否需要自己的测试入口(例如直接复用公开仓库的 sync 测试夹具)?本 change 不
  提供,由私有仓库自行决定。
