## Test Plan

All paths are relative to `packages/dsh-memex/`. Run with `npm test -w packages/dsh-memex` (vitest).

State legend:
- 🔴 red: a new or rewritten test that must fail before implementation and pass after it.
- 🟢 existing: the scenario is unchanged and an existing test already guards it. It must stay green; rename it if needed so the name carries the scenario.
- 🟡 pin: a new test that pins an unchanged scenario. It is expected to pass at first run and exists to prevent regressions.

Tests marked 🔴 whose name matches an existing test replace that test's assertions: the old assertion encodes the entry-level write behaviour that this change removes.

### dsh-memex-scope

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 同一个库挂在两个工作区，只关其中一个的记忆 | test/workspace-decisions.test.ts | `a path declaration turns memory off for one workspace of a shared library only` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 同一个库在两个工作区扮演不同角色 | test/workspace-decisions.test.ts | `one library is primary in one workspace and additional in another by declaration` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 声明优先于条目级标记 | test/workspace-decisions.test.ts | `a workspace primary declaration outranks the entry-level primary mark` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 旧配置不迁移也照常生效 | test/workspace-decisions.test.ts | `a section without workspaces resolves exactly as 0.2.0 did` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 声明覆盖其下所有目录，不论怎样路由 | test/workspace-decisions.test.ts | `a declaration governs every directory beneath it across path, remote, derived and local routes` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 认领变化不会打开已关闭的目录 | test/workspace-decisions.test.ts | `adding or removing claims never reopens a directory a declaration closed` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 条目级关闭与声明任一即关 | test/workspace-decisions.test.ts | `memory and fallback are off when either the declaration or the primary entry says off` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 声明不接受「开启」 | test/settings.test.ts | `rejects memory: true or fallback: true in a workspace declaration` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 声明的主入口不是该路径的精确认领者 | test/settings.test.ts | `rejects a declared primary that does not claim that exact path` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 陈旧的主入口声明在解析时拒绝而非回落 | test/workspace-decisions.test.ts | `refuses to resolve a stale declared primary instead of falling back` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 工作区级决定按路径声明，只能关闭，不随库联动 | 声明路径重复或缺失 | test/settings.test.ts | `rejects duplicate or missing workspace declaration paths` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 解析优先级为路径前缀 > remote 模式 > 自动派生 > fallback | 路径匹配优先于自动派生 | test/scope.test.ts | `uses configured paths before remote derivation` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 解析优先级为路径前缀 > remote 模式 > 自动派生 > fallback | 前缀不误命中兄弟目录 | test/scope.test.ts | `matches path segments rather than string prefixes` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 解析优先级为路径前缀 > remote 模式 > 自动派生 > fallback | 外部 worktree 经 remote 命中主仓 | test/scope.test.ts | `records git root and internal publication for configured remote matches` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 解析优先级为路径前缀 > remote 模式 > 自动派生 > fallback | 未认领仓库的仓外副本不保证共库 | test/scope.test.ts | `derives a separate library for an unclaimed repository copy outside the checkout` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 解析优先级为路径前缀 > remote 模式 > 自动派生 > fallback | 同一工作区被多个入口声明 | test/scope.test.ts | `routes a two-entry workspace to its primary and lists the other as reachable` (extended with a declaration-chosen primary) | 🟢 green |
| specs/dsh-memex-scope/spec.md → 解析优先级为路径前缀 > remote 模式 > 自动派生 > fallback | 同级多个命中却没有唯一主入口 | test/scope.test.ts | `refuses a path prefix shared by two scopes without a unique primary` (extended: neither declaration nor unique mark) | 🟢 green |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 项目绑定三库 | test/acceptance.test.ts | `fans out, preserves provenance, reads same slugs independently, and respects bindings` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 无绑定时行为退化 | test/scope.test.ts | `grants the fallback library on an unconfigured scope` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 兜底入口默认开启 | test/scope.test.ts | `keeps the fallback when a binding exists, because bindings only add` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 关闭兜底后两个方向都不可达 | test/scope.test.ts | `removes the fallback from both directions when a declaration or the entry turns it off` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 关闭一个工作区的兜底不影响同库的其它工作区 | test/workspace-decisions.test.ts | `a fallback declaration on one workspace leaves the same library's other workspaces reachable` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 绑定外 scope 不可达 | test/tools.test.ts | `supports an explicit scope list, rejects out-of-binding scopes, and preserves partial results` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 工作区的关联入口无需绑定即可达 | test/scope.test.ts | `routes a two-entry workspace to its primary and lists the other as reachable` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 绑定集合界定会话的读写可达范围 | 附加入口不被默认读取或写入 | test/acceptance.test.ts | `keeps one workspace, two entries: default touches the primary only, an explicit scope writes the sibling` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 一个工作区可关联多个入口，其中恰好一个是主入口 | 一个项目分内部与外部两个库 | test/settings.test.ts | `accepts one workspace split across two libraries when exactly one is primary` | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 一个工作区可关联多个入口，其中恰好一个是主入口 | 缺主入口时拒绝而非猜测 | test/settings.test.ts | `rejects two scopes claiming one workspace with neither a declaration nor a mark` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 一个工作区可关联多个入口，其中恰好一个是主入口 | 重复主入口时拒绝 | test/settings.test.ts | `rejects two scopes claiming one workspace with two marks and no declaration` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 一个工作区可关联多个入口，其中恰好一个是主入口 | 工作区声明解决条目级冲突 | test/settings.test.ts | `accepts a workspace declaration that picks one primary among conflicting marks` | 🟢 green |
| specs/dsh-memex-scope/spec.md → 一个工作区可关联多个入口，其中恰好一个是主入口 | 字面相同的 remote 模式同理 | test/scope.test.ts | `routes a two-entry workspace to its primary and lists the other as reachable` (identical patterns, one marked) | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 一个工作区可关联多个入口，其中恰好一个是主入口 | 运行时命中的多个 remote 模式缺唯一主入口 | test/scope.test.ts | `refuses a remote claimed by two scopes with no primary, instead of taking the first` (distinct patterns) | 🟢 existing |
| specs/dsh-memex-scope/spec.md → 一个工作区可关联多个入口，其中恰好一个是主入口 | 单条目声明无需标注 | test/settings.test.ts | `lets a lone claimer stay unmarked` | 🟢 existing |

### dsh-memex-memory

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-memex-memory/spec.md → 按工作区关闭记忆 | 关闭后不注入任何东西 | test/lifecycle.test.ts | `injects nothing when a path declaration closes memory for the directory or its children` | 🟢 green |
| specs/dsh-memex-memory/spec.md → 按工作区关闭记忆 | 关闭后工具拒绝且不落盘 | test/tools.test.ts | `refuses every tool in a workspace whose memory is switched off` (extended with a declaration-closed case) | 🟢 green |
| specs/dsh-memex-memory/spec.md → 按工作区关闭记忆 | 关闭不影响其他工作区的可达性 | test/tools.test.ts | `a memory-off workspace's primary stays writable as another workspace's fallback target` | 🟢 green |
| specs/dsh-memex-memory/spec.md → 按工作区关闭记忆 | 共用同一个库的两个工作区互不影响 | test/tools.test.ts | `closing memory in one workspace leaves a workspace sharing its primary fully working` | 🟢 green |
| specs/dsh-memex-memory/spec.md → 按工作区关闭记忆 | 入口级写法兼容 | test/scope.test.ts | `reports memory as on by default and off only when the entry says so` | 🟢 existing |
| specs/dsh-memex-memory/spec.md → 按工作区关闭记忆 | 重新打开在下一个会话生效 | test/lifecycle-runtime.test.ts | `reopening memory enables tools immediately but does not inject recall into a started session` | 🟢 green |
| specs/dsh-memex-memory/spec.md → 按工作区关闭记忆 | 会话中途关闭后工具即时拒绝 | test/lifecycle-runtime.test.ts | `closing memory mid-session refuses later tool calls without retracting injected recall` | 🟢 green |

### dsh-memex-settings-ui

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 未配置的工作区也出现，并带默认主入口 | test/page.test.tsx | `lists the host workspaces and gives an undeclared one its derived entry` | 🟢 existing |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 经仓库地址认领的工作区不提供认领动作 | test/page.test.tsx | `a remote-claimed workspace offers no claim or primary action and says why` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 不对应注册表工作区的块只呈现开关状态 | test/settings-model.test.ts | `configuration blocks of every kind carry no switch and say why` (unregistered path, pathless library, degraded registry; replaces `writes both switches on a declared library that claims no path`); page assertion in test/page.test.tsx `shows a configuration block's switches as read-only state` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 注册表不可用时拒绝改认领 | test/settings-guard.test.ts | `refuses a claim-changing save while the registry is unavailable` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 关闭记忆的工作区默认收起 | test/page.test.tsx | `folds only registered memory-off workspaces` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 挂附加入口时同时落主入口并说明 | test/page.test.tsx | `declares the derived primary when an undeclared workspace gets a second entry` (updated: the staged primary is the path declaration's `primary`) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 关闭记忆的工作区默认收起 | test/page.test.tsx | `folds memory-off workspaces into a collapsed group` | 🟢 existing |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 展开分组后能把它重新打开 | test/page.test.tsx | `can switch memory back on from inside the folded group` (reopen now removes the declaration) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 没有关闭记忆的工作区时不出现空分组 | test/page.test.tsx | `shows no folded group when every workspace has memory on` | 🟢 existing |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 未配置库路径时显示占位 | test/page.test.tsx | `shows the default library path as a placeholder, never as a configured value` | 🟢 existing |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 复制库路径与远端 | test/page.test.tsx | `copies the library path and the remote to the clipboard` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 远端未配置时如实呈现 | test/page.test.tsx | `offers configuration, not initialisation, for a library without a remote` | 🟢 existing |
| specs/dsh-memex-settings-ui/spec.md → 页面以 DSH 工作区为单位，工作区下列出它的记忆入口 | 发布方向无法证实时不推测 | test/page.test.tsx | `never guesses a publication direction the host could not prove` | 🟢 existing |
| specs/dsh-memex-settings-ui/spec.md → 兜底入口默认开启、可关闭，关闭后读写都不可达 | 默认开启时 personal 可读可写 | test/page.test.tsx | `shows personal as readable and writable while the fallback is on` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 兜底入口默认开启、可关闭，关闭后读写都不可达 | 关闭后两个方向都不可达 | test/page.test.tsx | `turns the fallback off in both directions with a path declaration` (replaces the entry-write test) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 兜底入口默认开启、可关闭，关闭后读写都不可达 | 关闭只作用于这个工作区 | test/settings-model.test.ts | `a fallback close writes only this workspace's declaration and leaves shared-library workspaces untouched` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 兜底入口默认开启、可关闭，关闭后读写都不可达 | 关闭未声明工作区的兜底不落派生入口 | test/settings-model.test.ts | `closing the fallback of an undeclared workspace adds a declaration and no scopes entry` (replaces the staging test) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 兜底入口默认开启、可关闭，关闭后读写都不可达 | 绑定的显式列出可以覆盖关闭 | test/scope.test.ts | `lets an explicit binding listing outrank a turned-off fallback` | 🟢 existing |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 只有一行入口也标注角色 | test/page.test.tsx | `labels a lone entry with its role` (replaces `leaves a lone entry unlabelled…`) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 一组工作区的多个入口成组呈现 | test/settings-model.test.ts | `puts both entries of a shared workspace in one block, primary first` (extended: declaration-chosen primary) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 把兜底入口设为主入口 | test/settings-model.test.ts | `setting the fallback personal row as primary replaces the old primary on that workspace` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 从主入口更换为另一个库 | test/page.test.tsx | `replaces the primary with a picked library and names the replaced one before saving` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 切换不改变这个工作区的开关 | test/settings-guard.test.ts | `switching primary keeps both switches' effective values` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 从祖先路径分出来切换 | test/settings-model.test.ts | `switching under an inherited ancestor prefix splits the workspace out and leaves siblings routed` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 原主入口条目上的关闭在切换后保持 | test/settings-guard.test.ts | `carries the old primary's entry-level memory off into a path declaration` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 切换不影响共用库的其它工作区 | test/settings-model.test.ts | `switching primary in one workspace leaves the shared library's other workspaces unchanged` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 新增第二个入口时补主入口标记并说明 | test/settings-model.test.ts | `keeps exactly one primary when a workspace gains a second entry` (now writes the declaration) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 在继承祖先路由的工作区上挂入口 | test/settings-guard.test.ts | `attaching on an inherited workspace makes the new entry its sole primary and names every inherited library` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 在继承祖先路由的工作区上挂入口 | test/settings-guard.test.ts | `refuses an inherited attach whose new primary's binding lists personal, saying it would become primary` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 在继承祖先路由的工作区上挂入口 | test/settings-guard.test.ts | `refuses an inherited attach whose preserving declaration would close an on child` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 组内没有主入口时阻止保存 | test/settings-model.test.ts | `blocks a workspace with no declaration and no unique mark` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 主入口在页面上可辨、可切换，且保存前拦截唯一性冲突 | 组内标了多个主入口时阻止保存 | test/settings-model.test.ts | `blocks a workspace with several marks and no declaration, and a non-exact declared primary` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 关闭状态可见、可撤销 | test/page.test.tsx | `shows a memory-off workspace's state and its meaning, and keeps editing available` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 关闭一个工作区不连带共用同一个库的工作区 | test/settings-model.test.ts | `closing memory in one workspace leaves another workspace on the same primary on` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 关闭未声明的工作区会连带落声明 | test/page.test.tsx | `switches memory off for one workspace with a path declaration and no derived entry` (replaces the staging test) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 关闭父工作区时列出受影响的子工作区 | test/settings-guard.test.ts | `closing a parent lists registered child workspaces that also close` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 被祖先声明关闭时不能单独打开 | test/settings-guard.test.ts | `refuses to open a workspace an ancestor declaration closes and names the ancestor` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 打开时移除条目字段并保持其它工作区关闭 | test/settings-guard.test.ts | `opening removes the entry field and adds off declarations for other registered workspaces` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 打开需要移除仓库认领库上的关闭时拒绝 | test/settings-guard.test.ts | `refuses to open when the closing entry carries remote patterns` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 挂入口不会打开由继承主入口关闭的工作区 | test/settings-guard.test.ts | `attaching an entry under an inherited off primary adds memory and fallback declarations` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 移除主入口不会打开工作区 | test/settings-guard.test.ts | `detaching the only primary adds a memory declaration so the derived route stays off` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 保持关闭会波及开启的子工作区时拒绝保存 | test/settings-guard.test.ts | `refuses a save whose preserving declaration would close an on child workspace` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 在工作区上把 personal 设为主入口是显式决定 | test/settings-guard.test.ts | `making personal an entry on the workspace's own block is explicit and noted` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 间接使 personal 成为入口时拒绝 | test/settings-guard.test.ts | `refuses an edit that makes personal an entry of a workspace indirectly` (detach onto an inherited personal; attach personal on a parent with an inheriting child) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 被祖先声明关闭时不能单独打开 | test/settings-guard.test.ts | `points an ancestor refusal at the configuration when the ancestor is not registered` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 绑定保持可达时标注实际可达性 | test/channel.test.ts | `resolve reports fallback false with personal reachable through a binding` (plus page annotation assertion in `test/page.test.tsx` `annotates a fallback kept reachable by a binding`) | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 绑定保持可达时不误补关闭声明 | test/settings-guard.test.ts | `adds no fallback declaration when a binding kept personal reachable before the switch` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 没有绑定时切换会补兜底关闭声明 | test/settings-guard.test.ts | `adds a fallback declaration when switching away from an entry-level fallback off without a binding` | 🟢 green |
| specs/dsh-memex-settings-ui/spec.md → 工作区级记忆开关在页面上可辨、可切换 | 新主入口的绑定会打开兜底时拒绝保存 | test/settings-guard.test.ts | `refuses a switch whose new primary's binding would make personal reachable` | 🟢 green |

### dsh-memex-card-browser

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-memex-card-browser/spec.md → 关闭记忆的入口不可浏览 | 关闭记忆的入口没有打开动作 | test/page.test.tsx | `does not offer browsing for a memory-off workspace` | 🟢 existing |
| specs/dsh-memex-card-browser/spec.md → 关闭记忆的入口不可浏览 | 直接请求被拒绝 | test/channel-browse.test.ts | `refuses a memory-off library before starting anything` | 🟢 existing |
| specs/dsh-memex-card-browser/spec.md → 关闭记忆的入口不可浏览 | 从记忆开启的工作区可以打开共用的库 | test/page.test.tsx | `offers browsing for a shared library under the memory-on workspace only` | 🟢 green |
| specs/dsh-memex-card-browser/spec.md → 关闭记忆的入口不可浏览 | 请求中的工作区不影响判定 | test/channel-browse.test.ts | `ignores a workspace field in the request and still refuses an entry-level memory-off library` | 🟢 green |

### Additional tests (required by design and review, not scenario rows)

| Source | File | Test Name | Initial State |
|--------|------|-----------|---------------|
| design Migration Plan; review r1/r2/r3 S1 | test/settings-rollback.test.ts | `the frozen 0.2.0 schema passes workspaces through unchanged and the new schema recovers it` | 🟢 green |
| review r5 M1 change 2, the Host half | test/channel.test.ts | `resolve reports fallback false with personal reachable through a binding` (shared with the scenario row) | 🟢 green |
| review r5 suggestion 1 | test/workspace-decisions.test.ts | `personal as current scope reports its fallback decision but is always reachable` | 🟢 green |
| review r5 suggestion 2 | test/settings-guard.test.ts | `keeps a read-only or write-only binding's direction when computing reachability` | 🟢 green |
| design D5 (no secret leak) | test/channel.test.ts | `resolve reports claim and offBy without any raw remote URL` | 🟢 green |
| design D2 (page and Host use the same rules) | test/settings-guard.test.ts | `the draft recomputation agrees with the Host resolver on a table of configurations` | 🟢 green |
| design D5 (homeDir) | test/settings-model.test.ts | `model path comparisons use the Host homeDir, not an empty string` | 🟢 green |
| backward compatibility of saves | test/page.test.tsx | `saves scopes and workspaces as two sets in one fenced mutation` (replaces `saves the whole scope list…`) | 🟢 green |

## Coverage Notes

- **New test files:**
  - `test/workspace-decisions.test.ts`: the resolver side of the path-declaration model.
  - `test/settings-guard.test.ts`: the pure page functions for the universal guard, open, and switch. They take the settings snapshot (scopes, workspaces, bindings) and the Host route facts, and return a draft plus notices or a refusal.
  - `test/settings-rollback.test.ts`: the rollback round-trip.
  - `test/fixtures/settings-schema-0.2.0.ts`: the `MemexSettingsSchema` from 0.2.0, frozen verbatim (source `src/scope/settings.ts:13-30` at the current HEAD).
- **Table-driven agreement test:** the draft recomputation in `settings-guard` and the Host resolver must agree. The agreement test runs one shared table of configurations through both, covering path claim, ancestor inheritance, remote claim, derived route, bindings, and `personal` as current. It asserts equal `memory` and `personal.{read,write}`, except where the page is documented to be conservative (treating an unknowable route as reachable).
- **Existing tests that encode removed behaviour:** they are rewritten, not deleted, so that their scenario stays covered. Affected tests: `writes the fallback decision on the entry that carries the route`, `switches memory off on the entry that carries the route`, `turns the fallback off on an undeclared workspace, staging its derived primary`, `stages the derived primary when memory is switched off on an undeclared workspace`, `writes both switches on a declared library that claims no path` (→ `configuration blocks of every kind carry no switch and say why`), `leaves a lone entry unlabelled…`, and `saves the whole scope list as one fenced mutation`.
- **Existing reference:** the lifecycle timing rows use `test/lifecycle-runtime.test.ts`, which already wires a real `ScopeRuntime`. `runtime.replace()` simulates a live settings save mid-session.
- **Real-kernel acceptance** (`test/acceptance.test.ts`) needs no new cases. Routing changes are covered at the resolver level, and live acceptance happens after deployment (tasks, verify).
