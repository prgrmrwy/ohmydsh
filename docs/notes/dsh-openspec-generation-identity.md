# dsh-openspec 的 generation 身份与宿主机依赖布局

2026-10-08 本机（DSH 0.2.0-rc.2）实测记录。结论先行：**把宿主文件系统路径写进不可变身份，等于让一次
`dsh build` 就能让插件自锁**；而"自锁"当时是完全静默的，排查成本远高于缺陷本身。

## 现象

- profile 启动插件列表里有 `dsh-openspec`（`~/.dsh/dsh-startup.log` 的 `plugins=[…]`），宿主日志无相关错误。
- 任意 workspace 的 `/` 菜单里没有 `opsx-*` / `openspec-init` / `openspec-upgrade`，适配器的 Skill 也不出现在
  任何会话的 Skill 目录里。工作区里能见到的 `openspec-explore` 等 4 个是官方 CLI 写进项目 `.agents/skills`
  的项目级 Skill，只在跑过 `openspec init` 的仓库存在——所以"别的 workspace 什么都没有"是同一个原因的表象。
- 更早（DSH 0.1.5-rc.2，10-07）该 Skill 还能正常消费，会话日志里有 `provider "dsh-openspec"`。

## 只读取证（不需要看浏览器）

1. 从 `~/.dsh/dsh.log` 最后一行 `dsh web: <url>?token=…` 取本次启动的 token（**不要把 token 写进任何文件或卡片**）。
2. `curl -i "<url>/?token=$TOKEN"`，取响应里的 `set-cookie`（宿主用签名 cookie 认证浏览器请求）。
3. 用 connection RPC 信封直接问宿主命令目录：

   ```bash
   curl -s -X POST "<url>/api/commands/list" -H "Cookie: $COOKIE" -H 'content-type: application/json' \
     -d '{"type":"client-request","rpcId":"probe","method":"commands/list","payload":{"args":{"agentId":"session-<id>"}}}'
   ```

   要点：`payload.args` 必须是**具名对象**（数组会被 `gateway/internal` 拒绝）；命令目录是**全局**注册面，
   所以任一会话都能验。返回里没有 `opsx-*` 即适配器没有注册任何命令。同类端点还有 `/api/commands/execute`。

4. 物化失败可直接复现：import 部署副本的 `lib/upstream-compat.js`、`lib/manage-flow.js`、
   `lib/generation-materializer.js`，用与 `src/index.ts` 相同的输入调 `materializeGeneration`；把 `home`
   指向临时目录即可安全重跑。

实测结果：`generation-identity-collision`（约 1.5s 抛出）；把 `home` 换成 scratch 目录后同一调用 1.1s 成功。
逐字段比对显示 `skills` / `invocation` / `selectionFingerprint` / `delivery` / `version` 全等，只有
`sourceHashes.node_modules` 不同。

## 根因

1. 闭包目录名原为 `sha256(realpath)`；一次 profile 重装（`nodeLinker: hoisted`）把 4 个包从嵌套位置提升到
   profile 根：`diff` 由 `@fission-ai/openspec/node_modules/diff`、`string-width`/`strip-ansi`/`ansi-regex`
   由 `ora/node_modules/*` 变为 `profiles/web/node_modules/*`。**版本逐字节相同**（9.0.0 / 8.3.0 / 7.2.0 /
   6.4.0），只有物理路径变了；旧闭包目录名可用 `sha256("…/ora/node_modules/strip-ansi")` 反解命中。
2. generation id 只由（官方版本、selection fingerprint、workflow ids、适配器 Skill 正文哈希、telemetry）派生，
   不含依赖闭包 → 同一个 id 的"应有内容"随宿主机布局漂移 → `reuse()` 抛 `generation-identity-collision`。
3. 该异常抛在 `ctx.inject(['skills','commands'], async child => …)` 回调内、注册 Skill provider 与 commands
   之前，rejection 没有任何日志落盘（`grep -r "generation-identity-collision" ~/.dsh/*.log` 为空），
   插件树看起来"加载成功"。

旁证：`generations/` 目录 mtime 在每次失败启动时更新——materializer 每次都建了 staging 又删除；同一时间窗
（12:37）还有一次 `plugin tree failed to load: Cannot find module …/lib/generation-closure.js` 整体崩溃，
那是同一轮重装在运行中的宿主脚下改写硬链接部署副本导致的，属同一危险动作的另一面。

## 修复后的不变量（change `fix-openspec-generation-closure-identity`）

- 闭包目录名 = `包名@版本~内容哈希~直接依赖上下文哈希`，全部由包身份派生、**不含任何宿主路径**；
  同一批版本换布局产出逐字节相同的 generation 内容，`reuse()` 成立。
- generation 身份覆盖已解析的依赖闭包：真实依赖变化（版本/内容/解析结果）派生**新** id 并干净切换，
  不再与既有 generation 撞 collision；旧 generation 保守保留不重写。
- 启动贡献失败时先逆序撤销已注册的部分贡献（fail closed），再经宿主 logger 打**一条**
  `dsh-openspec: startup contributions failed (<code>); no Skills or commands were registered`；
  `<code>` 只取错误的 `code` 字段或构造函数名，不含路径与错误正文。

身份输入变化后旧 generation（如本机 `7ecafe373f934e138259d479`）不再被引用；下一次部署启动会物化并激活
新 generation，因此**不需要人工删状态目录**。

## 可复用的教训

任何"内容寻址 + 不可变身份"的设计都要检查一件事：**生成的内容是否是身份输入的函数**。只要内容里混进了
宿主路径、时间戳、随机数或遍历顺序，身份与内容就会各自漂移，而两者不一致时最自然的选择（fail closed）
会把插件打死。第二件事：**异步贡献回调里的失败必须自己上报**，宿主不会替你把它变成可见错误。
