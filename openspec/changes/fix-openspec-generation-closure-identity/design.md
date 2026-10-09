## Context

在途 change `add-dsh-openspec-adapter` 的实现在 DSH 0.2.0-rc.2 上暴露了一个**静默失效**：插件被加载、启动插件列表里有它、日志无错，但 `/` 菜单里既没有 `opsx-*` / `openspec-init` / `openspec-upgrade`，也没有该适配器的 Skill。

本机取证（2026-10-08，全部只读或 scratch 目录）：

1. **宿主自证没有注册**：从 `dsh.log` 取 web token → 带 cookie `POST /api/commands/list`（connection RPC 信封，`payload.args.agentId`）→ 返回只有 `compact, export, feedback, goal, permission, plan`。适配器的 8 条命令一条都没有，且这是**全局**注册面，与 workspace 无关。
2. **复现物化失败**：直接 import 部署副本的 `lib/upstream-compat.js` / `lib/manage-flow.js` / `lib/generation-materializer.js`，用与 `index.ts` 相同的输入调 `materializeGeneration` → 1.5s 后抛 `generation-identity-collision`（把 `home` 指向 worktree 里的 scratch 目录则 1.1s 成功）。逐字段比对：`skills`、`invocation`、`selectionFingerprint`、`delivery`、`version` 全部相等，只有 `sourceHashes.node_modules` 不同。
3. **差异来源**：`copyDependencyClosure` 用 `sha256(realpath)` 作闭包目录名。12:37 的 profile 重装把 4 个包从嵌套位置提升到 profile 根——`diff` 由 `@fission-ai/openspec/node_modules/diff`、`string-width`/`strip-ansi`/`ansi-regex` 由 `ora/node_modules/*` 变为 `profiles/web/node_modules/*`；**四个包的版本逐字节相同**（9.0.0 / 8.3.0 / 7.2.0 / 6.4.0），只是物理路径变了。旧闭包目录名可反解：`sha256("…/ora/node_modules/strip-ansi")` 等命中旧名。
4. **静默机制**：异常抛在 `ctx.inject(['skills', 'commands'], async child => …)` 回调内、`registerProvider` 与 `registerCommands` 之前；`grep -r "generation-identity-collision" ~/.dsh/*.log` 为空，即 rejection 没有任何日志落盘。
5. **旁证**：该适配器 10-07（0.1.5-rc.2）还能用——会话日志里有 `<skill_content name="openspec-explore">` 与 `provider "dsh-openspec"`；`generations/` 目录 mtime 12:52 说明每次失败启动都建了 staging 又删掉。

## Goals / Non-Goals

**Goals：** generation 内容只由官方版本、官方文件、适配器 Skill 正文与**解析出的依赖身份**决定，与宿主机物理布局无关；任何真实变化要么被身份覆盖（干净切换），要么显式失败**且可见**；不改变既有 generation 磁盘语义与安全边界。

**Non-Goals：** 不改 DSH core、不改 profile/部署、不动 `dsh.yaml` pin；不引入 GC/purge（旧 generation 仍保守保留）；不试图让 DSH 支持热更新或自动重启；不修 `dsh build` 与运行中宿主共享硬链接这一仓库级危险动作（另见 BACKLOG D005）。

## Decisions

### D8. 闭包命名去路径化 + 闭包身份进入 generation id + 启动失败必须可观测

**命名规则**：每个拷贝出的依赖包以 `key = "<name>@<version>~<ctx8>"` 命名，落在 `<generation>/node_modules/.dsh-closure/<key>/`。`ctx8` = 该包**直接依赖**按依赖名排序后的 `depName->childName@childVersion` 列表的 sha256 前 8 位。key 只由包身份与解析出的子包身份派生，**不含任何宿主路径**；同一批版本无论嵌套还是提升到父级根，key 与链接布局完全一致，因此 `generationHashes` 逐字节一致，`reuse()` 成立。

- 为什么带 `ctx8` 而不是只用 `name@version`：同一 name@version 的不同物理副本可能处在不同解析上下文（子包版本不同）。带上直接依赖身份后缀后，key 仍与布局无关，但能把上下文不同的副本分开，保持既有"不错误合并"的保真度；上下文相同（实际安装的常态）则合并为一份拷贝。
- 遍历顺序固定（依赖名排序、深度优先）并在**首次**放置某 key 时写链接，因此重复 key 的后续节点只复用、不重写，产物是解析图的确定性函数。
- 依赖名合法性校验与 optional 缺失语义保持原样（`dependency-name-invalid` / optional ENOENT 跳过）。

**身份覆盖闭包**：新增 `closureIdentity(sourceRoot)`（只解析、不拷贝，读取各包 `package.json`），返回 `sha256(sorted keys)`；`generationIdentity(...)` 把它并入哈希（原 `openspec-upgrade-v5` salt 与 manage Skill 正文哈希保留）。效果：真实闭包变化（版本或解析结果变化）派生**新** id → 新 generation 被物化并激活，而不是与旧目录撞 `generation-identity-collision`；闭包不变（含重装后仅路径变化）→ 复用既有 generation。

- 替代方案 A：保留 realpath 命名、把 realpath 从"内容"里剔除（只哈希包内容）。同样能修好本次回归，但把"同一版本的两份不同上下文副本"合并掉，且 id 仍不能覆盖真实的依赖变化，仍会撞 collision。否决。
- 替代方案 B：撞 collision 时原地覆盖（supersede-in-place）。破坏"generation 不可变"这一既有不变量，也失去旧 generation 作为回滚与审计记录的价值。否决。
- 替代方案 C：只把失败改成致命（让整棵插件树加载失败）。会把 Host 一起拖垮，代价远大于收益。否决。

**启动失败可观测且 fail closed**：`apply()` 的注入回调体用 try/catch 包住：失败时按创建顺序的逆序撤销已注册的部分贡献（路由服务 disposer、Skill provider、commands、目录监视），然后经宿主 logger 打**一条** error：`dsh-openspec: startup contributions failed (<code>); no Skills or commands were registered`。`<code>` 取错误的 `code` 字段（须匹配 `^[a-z0-9][a-z0-9-]{0,63}$`），否则取构造函数名，再否则 `unknown`——**不含错误正文、不含路径**，因此不会把宿主路径或上游文本写进日志。上报本身再失败也不改变"已处置"的事实（不得因为上报把失败变成未捕获 rejection）。

- 该失败仍不注册任何面向会话的表面（与 `add-dsh-openspec-adapter` 的 fail-closed 语义一致），但不再静默；`ctx.logger` 是 cordis Context 的既有契约，缺失 logger 的测试替身不会把已处置的失败变成 rejection。

**本次线上失效的自愈**：身份输入变化后，本机 `generations/7ecafe373f934e138259d479` 不再被引用（陈旧目录保留）；下一次部署启动会物化并激活新 generation，命令与 Skill 随之恢复。因此本 change 落地后不需要人工删状态目录。

## Risks / Trade-offs

- [身份输入变化 → 旧 generation 变成孤儿] → 与既有"不删非 staging generation"的保守语义一致；README 的移除说明已覆盖"确认无未完成 journal 后手动删除"。
- [闭包 key 变化导致同一 id 仍撞 collision] → 只可能发生在"版本相同但内容或上下文不同"的投毒/篡改场景；此时 fail closed 且**现在有日志**，属期望行为。
- [`closureIdentity` 增加一次启动期解析与内容哈希，且物化自身会再规划一次] → 实测本机官方闭包 14 MB / 69 个包：`closureIdentity` 约 220–260 ms，完整物化约 1.2–1.5 s（改动前约 1.1 s），即每次挂载净增约 0.3–0.6 s。启动可接受，未做跨调用缓存：缓存会让"包内容在原地变化"与指纹失配，代价大于收益。受影响的集成用例改为 30 s 预算（`vitest.config.ts`），与 `dsh-memex`/`session-links` 等兄弟包一致——这些用例每个要多次物化真实官方包，默认 5 s 在改动前已贴边（实测 4596 ms / 4492 ms）。
- [依赖图极端形态（重复 name@version + 不同上下文）] → 由 `ctx8` 分离；若仍出现 key 冲突且链接不同，产物取确定性首放置，`reuse()` 的逐字节校验兜底并显式报错。

## Migration Plan

1. 在本 change 分支内按 tasks.md 的 red-green 顺序实现：闭包规划/命名与 `closureIdentity` → 身份接线 → 启动失败上报 → 测试。
2. 运行 `packages/dsh-openspec` 的 build/typecheck/vitest 与仓库级 `npm test`、`npm run check:artifacts`，并跑 `openspec validate fix-openspec-generation-closure-identity --strict`。
3. 部署与重启**不在本 change 内自动执行**：需要 `dsh build`（含 merge 到主 checkout）后由用户自行重启宿主；本次已明确不重启。
4. 回滚：还原本 change 的源码改动即可；陈旧 generation 与新 generation 都不需要清理，回滚后旧 id 重新被引用。
