## Context

动机见 proposal.md。前置条件是 `ws-prepare-preview-hook`：ws 在显式调用时执行 `.ws/prepare-preview`，传入 `WS_SOURCE_REPO`、`WS_WORKTREE`、`WS_GIT_COMMON_DIR`、`WS_OPERATION_ID`、`WS_DSH_HOME`、`WS_SOURCE_DSH_HOME`，并把 `DSH_HOME` 覆盖为隔离 home。

ohmydsh 侧现状：
- launcher（`scripts/launcher/main.mjs`、`args.mjs`）的端口默认值硬编码为 3080，`DSH_HOME` 取自 worktree 的 `.env.local`。
- 真实 home 中运行所需的配置分散在以下几处：`.credentials.yaml`、`plugins/subscriptions/*.json`、`profiles/web/cordis.patch.yml` 锚点之后的行、`.npmrc` 和 `pnpm-workspace.yaml`。sync 只改写生成区（`scripts/sync.mjs:87-90`），锚点之后的行会保留。
- 端口身份证明已有 `probePort`、`stopServer`、`sameProcessIdentity`（`scripts/launcher/process.mjs`）。

## Goals / Non-Goals

**Goals:**
- 在 worktree 里依次执行 `dsh build`、`ws prepare-preview`、`dsh`，无需初始化即可得到可用的预览 Host。
- 多个 worktree 并发预览时，端口自动错开，互不干扰。
- 结构上杜绝 worktree 影响日常 3080 Host。

**Non-Goals:**
- 不新增 launcher 子命令，复用现有的 build、start、restart、stop。
- 不隔离 `~/.dsh-memex`、`~/.claude`、`~/.codex` 这类 DSH_HOME 之外的状态。

## Decisions

### D1：`.ws/prepare-preview` 脚本

脚本是一个 `#!/usr/bin/env node` 薄壳，调用 `scripts/lib/ws-preview-seed.mjs`。白名单以常量形式放在该模块顶部，作为唯一声明。它不放进 dsh.yaml，因为这是 worktree 开发环境的行为，不属于部署定制。

前置校验（任何写入之前）：隔离 home 中必须已有 `profiles/web/package.json`，即已在 worktree 中执行过 `dsh build`，否则提示先 build 并退出（评审第 5 项：在全新 home 上，sync 会先调用官方 CLI 初始化 profile，而官方初始化遇到已有文件会跳过，见 `sync.mjs:716-726`；如果我们先写了 `cordis.patch.yml`，就会顶替官方模板）；`WS_DSH_HOME` 的 realpath 必须位于 `<WS_GIT_COMMON_DIR>/ws/dsh-home/` 下，且不等于 `WS_SOURCE_DSH_HOME` 的 realpath；`WS_WORKTREE` 必须等于脚本所在仓库根。任一条件不满足，就以非零状态退出，不写任何文件。

各项的处理方式：
- `.credentials.yaml`：用 `yaml` 解析。源中的 `client-connection/browser-session` 不复制；目标中已有的同名 record 保持原值；其余 `refs` 和 `records` 用源覆盖。
- `auth.json`：原样复制，并打印每个账号的剩余有效期与登录风险提示（见 D2）。
- `cordis.patch.yml`：此时文件必然已由 build 生成。在锚点行之后按 id 替换或追加白名单行，生成区不动。找不到锚点行时失败退出，不做猜测。
- `.npmrc` 只合入 `registry=` 和 `@scope:registry=` 行。不处理 `pnpm-workspace.yaml`：真实 home 中已经没有 `allowBuilds`（2026-10-26 核对），没有可复制的内容。自举验收中如果隔离 home 安装时报 ERR_PNPM_IGNORED_BUILDS，再针对性补上（评审第 2 项）。
- 写入方式：先写临时文件再 rename，权限 0600，内容未变则跳过。
- 首选端口：已有 `DSH_PORT` 时沿用；否则取 `3180 + (sha256(operationId) 前 4 字节 % 100)`，写入独立托管块 `# BEGIN ws-preview managed` / `# END ws-preview managed`。这个块与 ws 自身的 `worktree-session managed` 块互不覆盖（ws 的 `managedEnvironment` 只替换自己的块，见 `packages/worktree-session/src/host/environment.ts:26-33`）。脚本不探测端口，也不扫描其它 worktree；唯一性由启动时退避保证（D3），所以并发执行 prepare-preview 不存在竞态。
- 输出末尾提示：memex 与日常环境共享真实记忆库；接下来执行 `dsh` 启动预览（之后改了代码，先 `dsh build` 再 `dsh restart`）。

### D2：订阅登录原样复制，风险明示

评审核对了订阅插件的实际行为（`dsh-plugin-subscriptions/lib/auth/store.js`），推翻了原先"去掉 refresh token"的做法：
- 插件读取 `auth.json` 时，缺少 `refreshToken` 的账号会被当成不可用直接跳过（`isValidSessionShape`，第 298-304 行）。去掉之后，预览里一个订阅账号都没有。
- claude 的刷新会先读 macOS 钥匙串，刷新后再写回钥匙串（`auth/claude-code-creds.js:157-172`）。钥匙串在 DSH_HOME 之外，日常 Host 下次刷新前也会先读它，所以预览中刷新出的新 token 会被日常环境自动拿到。
- codex 的刷新（`providers/codex.js:202`）没有写回外部存储。预览中如果先刷新，refresh token 就会轮换，日常环境再刷新时可能报 `refresh_token_reused`，需要在日常 GUI 里重新登录一次。

因此原样复制，并在脚本输出中列出各账号的剩余有效期和上述风险。预览只在 access token 过期后才会刷新，所以刚执行完 prepare-preview 的短时间内，风险很低。

### D3：launcher 改动

- `args.mjs`：`flags.port` 的初值改为 `undefined`，并记录 `portExplicit`。主 checkout（非隔离 home）按 `flags.port ?? env.DSH_PORT ?? 3080` 解析，行为与现在一致。
- 隔离 home 判定：`isolatedHome(repo, home)` 用 `git rev-parse --git-common-dir` 加 realpath 判定。
- 护栏：在隔离 home 下，如果目标端口是 3080（显式指定，或缺少 `DSH_PORT`），在 `probe`、`stop` 和任何 `runScript` 之前直接抛错；退避序列也跳过 3080。`dsh build` 只打印 `隔离构建 → <绝对 home>（日常 GUI 未更新）`。
- **预览记录** `<隔离 home>/preview.json`：`{port, pid, created}`，其中 `created` 取自 `probePort` 返回的进程记录，与 `sameProcessIdentity` 使用同一身份字段。这是判定"本 worktree 的预览 Host"的唯一身份来源。
- **stop**：读取 `preview.json`，对记录端口执行 probe；只有监听者的 pid 和 created 都一致时，才调用现有的 `stopServer`。否则删除过期记录并报告未运行，不发任何信号。
- **start（未显式指定 `--port`）的退避流程**：
  1. 如果 `preview.json` 指向的端口上正是记录的进程，按既有"已在运行"处理，并打印 URL。
  2. 否则生成候选序列：从首选端口（restart 时为原端口）开始，在 3180–3279 内递增并回绕，最多尝试 20 次。
  3. 对每个候选端口：`probePort` 结果不是 `empty` 就跳过（不论占用者是否为 DSH）；是 `empty` 就启动子进程，并复用现有的就绪循环。就绪的唯一判据是"该端口监听者的 pid 等于本次子进程的 pid"。
  4. 未就绪时，沿用现有逻辑回收本次子进程。**在隔离 home 下禁用"另一个启动器抢先成功"分支**（`racedOwner` 时不再把对方当作自己），改为继续尝试下一个候选。这就是两个 worktree 同时抢同一端口时的退避路径：没抢到的一方，子进程会提前退出，或者 probe 到的 pid 不是自己，于是进入下一个端口。
  5. 成功后原子写入 `preview.json`，打印 `隔离预览环境 home=… port=…` 与 `DSH_PREVIEW {"url","port","home"}`。
- 显式指定 `--port`：不退避，沿用现有语义；在隔离 home 下仍受 3080 护栏约束。
- 为什么不在 prepare-preview 阶段用文件锁预留端口：端口占用是运行时的事实，预留表会与实际监听状态漂移（进程崩溃、手工启动的服务），还要额外处理锁过期。以"实际 bind 成功，且监听者是自己的子进程"为准，就不需要维护任何共享状态。

### D4：memex 与 AUTO 路由

按用户的选择，两者的配置都会复制。memex 配置指向同一个 `~/.dsh-memex`，在预览中写卡会写入真实库，脚本输出会提示这一点。AUTO 路由只复制 `config.json`，不复制 `state/auto-model-routing/` 下的会话状态和反馈日志，以免出现悬空引用、污染统计。

## Risks / Trade-offs

- [凭据副本] → 目录 0700、文件 0600，位于 `.git` 内；ws clean 时删除。
- [预览中刷新订阅登录，codex 在日常 GUI 失效] → 原样复制是让订阅可用的唯一办法。脚本输出有效期和风险提示；出现时，在日常 GUI 重新登录一次即可。
- [预览中写 memex 卡会进入真实库] → 已接受，脚本会给出提示。
- [运行时追加行的 id 随 DSH 升级变化] → 缺失的 id 列为 skipped，不报错；升级 DSH 时一并复核白名单。
- [Agent 没有先执行 prepare-preview 就启动] → launcher 护栏在隔离 home 下拒绝 3080，并提示先执行 `ws prepare-preview`。
- [实际端口与首选端口不同，Agent 拿错 URL] → 以 `DSH_PREVIEW` 行或 `preview.json` 为准，首选端口只是起点；指令中写明这一点。
- [预览区间被占满] → 最多尝试 20 次后报错，提示停掉不用的预览 Host 或执行 ws clean。

## Migration Plan

1. `ws-prepare-preview-hook` 先实现、合入，并在主 checkout 部署（ws 工具需要加载新版本）。
2. 实现本 change 并通过测试。
3. 在一个 worktree 中自举验收：执行 `dsh build` → `ws prepare-preview` → `dsh`；在 `DSH_PREVIEW` 给出的端口上通过 Host API 完成一次真实模型回合；确认 3080 的 pid 不变、真实 home 白名单文件的哈希不变、预览中订阅账号可用；在首选端口上放一个占位监听，确认会偏移到其它端口。
4. 合入主干后执行一次生产 `dsh build`。
5. 回滚：删除 `.ws/prepare-preview`，ws 就会报告 skipped。launcher 护栏是独立的安全改进，保留。

## Open Questions

- 是否需要额外复制官方 skill 或用户级 skill？sync 会物化本仓库的 skill，暂不复制。验收中如发现缺失，再补进白名单，不影响整体设计。
