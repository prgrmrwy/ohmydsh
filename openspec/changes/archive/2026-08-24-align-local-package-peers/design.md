## Context

运行体升级由 autoUpdate 自动完成:改 `dsh.yaml` 的 `dshVersion`、联动改写同族 pin、重跑 sync、自动 commit。该联动的作用域由 `startup-autoupdate` spec 明确限定为 `dsh.yaml` 内的条目(顶层 `dependencies` 的 spec、`package` 条目的 `spec`/`version`),**不含** `packages/*/package.json` 的 `peerDependencies`。

于是每次升级都会让自研 package 的 peer 声明落后一个版本族,且没有任何环节会报错。实测现状(运行体 `0.1.1-rc.2`):

| package | 运行体 peer 声明 | 严格 semver 满足? |
|---|---|---|
| `dsh-worktree-session` | 9 × `^0.1.0-rc.7` + 2 × 精确 `0.1.0-rc.7` | 否 |
| `dsh-sidebar-session-provider-icon` | 4 × `^0.1.0-rc.7` | 否 |
| `dsh-subscriptions-sandbox-shim` | 1 × `^0.1.0-rc.5` | 否 |

预发布版本的匹配规则是关键:`0.1.1-rc.2` 只能满足在 `0.1.1` 这个 tuple 上带预发布比较符的范围,因此 `^0.1.0-rc.7`、`^0.1.0-rc.5` 乃至 `*` 都不满足它。上游自身的写法印证了应对方式——`dsh-base@0.1.1-rc.2` 对兄弟包声明 `^0.1.1-rc.2`,即**每次发布把 caret 挂在当前 tuple 上**。

约束:当前没有实际故障(安装树中运行体包均为单一 `0.1.1-rc.2`,无重复副本,11 个 bundle 正常加载),因此这是一次**在故障发生前**修正声明,不是救火。

## Goals / Non-Goals

**Goals:**

- 消除两条精确硬 pin 这一真实隐患(可能解析出第二份同名包)。
- 让声明与实际解析结果一致,使 peer 声明重新具备"能发现不兼容"的价值。
- 让下一次漂移在测试里立刻暴露,而不是等到某次干净安装才炸。

**Non-Goals:**

- 不扩展 autoUpdate 去自动改写自研 package 源码(理由见决策 2)。
- 不改变任何运行时行为、sync 物化语义或 `dsh.yaml` 契约。
- 不为非运行体依赖(`react` / `cordis` / `schemastery`)引入版本策略。
- 不处理第三方插件自身的 peer 声明(不在本仓库控制范围内)。

## Decisions

**1. 采用上游写法 `^<当前运行体版本>`,而不是更宽松的范围。**

上游全部包都用这个形式,跟随它意味着我们的声明与运行体保持同一语义,升级时的判断规则也一致。更宽的写法(如 `>=0.1.0-rc.7`)在预发布语义下并不会变得更宽——预发布只匹配同 tuple,放宽反而制造"看起来兼容"的假象。
*备选*:改用 `*` 或删除 peer 声明。否决——`*` 同样不满足预发布版本(实测),而删除声明会连"运行体不兼容"这个信号一起丢掉。

**2. 不让 autoUpdate 自动改写自研 package 的 peer,改为检查 + 人工对齐。**

两个理由。其一,`startup-autoupdate` spec 规定自动提交的前提是"工作区相对改写前**仅含 `dsh.yaml` 一处改动**";把 package 源码纳入自动改写就必须放宽这条约束,而它正是该功能的安全边界。其二,运行体跨版本族升级可能伴随 API 变化,机械改写 peer 会产出"声明兼容、实际不兼容"的结果——比漂移更危险,因为它消除了本该出现的报错。让检查失败、由人确认代码是否仍然适配后再改声明,保留了这个判断点。
*备选*:autoUpdate 一并改写 packages 并放宽自动提交约束。否决,理由如上。

**3. 检查放在 `tests/` 而非启动路径。**

漂移不该阻塞启动——运行体已经升级完成、服务正常,此时中断启动是过度反应。放在 `npm test` 里则会在下一次开发动作时暴露,时机恰当。实现上读 `dsh.yaml` 的 `dshVersion` 与各 `packages/*/package.json`,只校验 `@deepseek-ai/dsh-*` 前缀的 peer。
*备选*:做成独立的 `npm run check:peers`。否决——仓库已有 `check:artifacts` 承担"策略检查"角色,但 peer 对齐更接近单元断言,放进既有测试套件无需新增入口。

**4. devDependencies 与 peer 一并对齐,而非只改 peer。**

两个 local package 的 `devDependencies` 里另有 18 条 `@deepseek-ai/dsh-*` 同样钉在 `0.1.0-rc.7`(含一条精确 pin),它们才是 typecheck 与 build 实际解析的版本。只改 peer 会让"构建通过"这一验证失去意义——它会拿 rc.7 的类型去校验,无论 `0.1.1-rc.2` 是否有 API 破坏都会通过,恰好复制决策 2 所反对的"声明兼容、实际不兼容"。一并对齐后,构建是否通过才真正成为兼容性证据;若上游确有破坏,此时暴露正是我们想要的结果。
*备选*:只对齐 peer,devDeps 另开一轮。否决——会留下一次没有验证价值的验收,且两轮改动作用于同一批条目,拆开徒增状态。

**5. 部署残留用官方 plugin CLI 定点移除,不手改部署目录,也不走 manifest 往返。**

`subagent-codex` / `sdk-protocol` 的声明残留在 `$DSH_HOME/profiles/web/package.json`,而当前账本并不认领它们,sync 不会主动清理(这正是 fail-safe 的表现)。

原设计选的是"临时加回 `dsh.yaml` 让 sync 重新认领,再删除条目触发卸载"。实施时发现该路径并非只动声明:`syncDependencies` 在 `installedVersion(name) === undefined` 时走的是 **install** 分支,会真的把 `0.1.0-rc.6` 的包装进当前 `0.1.1-rc.2` 的 profile,再卸载;而 remove 分支带 `if (installedVersion(name) !== undefined)` 守卫——这正是这两条声明得以长期滞留的原因。在运行中的部署上引入一次跨版本族安装,风险不成比例。

改为对这两个名字各执行一次 `dsh plugin --profile web remove <name>`:这与 sync 内部使用的是同一条命令,只是绕过它那个针对未安装项的守卫。外科式、不安装任何旧包、不重装其他定制、不触碰运行中的部署。
*备选一*:`dsh reset` + `dsh build`。可行且是官方可逆路径(`doReset` 会移除 profile dependencies 中所有非 shipped 项),但会卸载重装全部 9 个定制,对一处惰性声明而言代价过大。
*备选二*:直接编辑部署副本的 `package.json` 与 lockfile。否决——违反"手改一律回写本仓库"的约定,且绕过 sync 会让账本与现实再次不一致。

## Risks / Trade-offs

- **每次运行体升级都需要人工跟一次 peer 对齐** → 缓解:检查会明确指出待改条目,改动是机械的;这点摩擦换来的是升级时对 API 兼容性的一次显式确认。
- **检查可能在运行体升级后、对齐前使 `npm test` 变红** → 接受:这正是设计意图,让漂移可见;autoUpdate 的自动提交不受影响(它不跑测试)。
- **manifest 往返会产生两次 sync 与两次 manifest 改动** → 缓解:属一次性清理,过程中 manifest 的中间状态不提交,只提交最终结果。
- **对齐后若运行体实际有 API 破坏,问题会从"静默"变成"构建/类型报错"** → 这是收益而非风险,但工作量不可预估:实施时若暴露真实类型错误,需要修改 local package 源码以适配 `0.1.1-rc.2`,该部分不在本 change 的原始估算内。
- **devDeps 对齐会改动根 `package-lock.json`** → 缓解:变动限于 workspace 依赖解析,不触及第三方包版本;提交前核对 diff 只含 `@deepseek-ai/dsh-*` 条目。
