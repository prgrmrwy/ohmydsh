## Why

`packages/dsh-openspec`（在途 change `add-dsh-openspec-adapter` 的实现）在 2026-10-08 的 DSH 0.2.0-rc.2 轮次里于本机**静默失效**：profile 启动插件列表照常列出 `dsh-openspec`，宿主日志没有任何相关错误，但任意 workspace 的 slash 菜单里都没有 `opsx-*` / `openspec-init` / `openspec-upgrade`，该适配器的 Skill 也不出现在任何会话的 Skill 目录里（工作区里能见到的 `openspec-explore` 等 4 个是官方 CLI 写进项目 `.agents/skills` 的项目级 Skill，只在跑过 `openspec init` 的仓库存在）。

实机定位（证据与命令见 design.md D8）：`copyDependencyClosure` 用依赖包的**宿主机物理路径**（realpath 的 sha256）命名拷贝目录，而 generation id 只由（官方版本、selection fingerprint、workflow ids、适配器 Skill 正文哈希、telemetry）派生。一次 `dsh build` 的 profile 重装把 4 个包从嵌套位置提升到 profile 根（**版本完全没变，只有物理路径变了**），于是同一个 generation id 的应有内容发生变化，`materializeGeneration` 的 `reuse()` 抛 `generation-identity-collision`；该异常发生在 `ctx.inject(['skills', 'commands'], async …)` 回调内、注册 Skill provider 与 commands 之前，rejection 没有任何日志落盘——插件"看起来装好了"，实际零贡献。

## What Changes

- 依赖闭包命名与宿主机路径解耦：每个拷贝进 generation 的依赖包以自身身份（`name@version` 加一个由**直接依赖身份**派生的上下文后缀）命名，不再使用 realpath；同一批版本在嵌套/提升等不同物理布局下必须产出逐字节相同的 generation 内容。
- generation 身份覆盖已解析的依赖闭包：闭包身份变化（版本或解析结果变化）时派生**新的** generation 并干净切换，而不是与既有 generation 撞 `generation-identity-collision`；闭包不变时复用既有 generation。
- 启动贡献失败不再静默：注入回调失败时先撤销已注册的部分贡献（fail closed），再经宿主 logger 以稳定、有界的诊断码报告一次；不把该失败升级为整个 Host 启动失败。
- 测试：同一批依赖版本在两种物理布局下复用同一 generation；闭包身份对布局不敏感、对版本敏感；启动失败有日志且零注册。
- 不改 generation 的磁盘语义（旧 generation 仍保守保留、v1 不删非 staging generation），不改 DSH core，不改 profile/部署配置。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dsh-openspec-session`：在途 change `add-dsh-openspec-adapter` 的 delta 尚未归档。本 change 以 ADDED 要求在同一 capability 上追加「generation 内容与宿主机依赖布局解耦」与「启动失败必须可观测」两组约束；两者不改变该 change 已有的任何场景，归档先后顺序无要求。

## Impact

- `packages/dsh-openspec/src/generation-closure.ts`（闭包规划与命名、新增 `closureIdentity`）、`packages/dsh-openspec/src/index.ts`（身份输入 + 启动失败上报）、`packages/dsh-openspec/test/generation-closure.test.ts`、新增 `packages/dsh-openspec/test/closure-identity.test.ts` 与 `test/startup-failure.test.ts`、`packages/dsh-openspec/vitest.config.ts`（30 s 测试预算，与兄弟包一致）；README 的 generation 段、`dsh.yaml` 条目 `note` 与 `docs/notes/dsh-openspec-generation-identity.md`（实机取证与结论）。
- 身份输入变化会让**已部署的旧 generation 不再被引用**（本机 `7ecafe373f934e138259d479` 即成为陈旧目录，按既有语义保守保留、不自动删除）；下一次部署启动会物化并激活新 generation，这同时就是本次线上失效的自愈路径。不涉及数据迁移。
- 无新增出站流量、无权限面变化、无依赖变化，不改 `dsh.client`/`exports`/peer 等启动期字段。
