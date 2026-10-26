## Why

ohmydsh 的 worktree 无法就地验收。原因是 ws start 只给它一个空的隔离 `DSH_HOME`：里面没有模型和凭据，`.npmrc` 缺私有 registry。在 worktree 里启动 DSH，要么 sync 失败，要么停在初始化页。实际做法只好退化成"先合入主干，再部署到真实 `~/.dsh` 验收"。2026-10-19 至 10-26 的会话洞察里，这条路径出现过 4 次用户纠正、5 次未验证就宣称完成，以及 1 次在 worktree 里误跑 sync。另外，在 worktree 里执行 `dsh restart` 会把日常 3080 Host 切到空 home（BACKLOG B014）。

change `ws-prepare-preview-hook` 让 ws 提供了按需执行 `.ws/prepare-preview` 的扩展点。本 change 是 ohmydsh 作为接入方的实现：决定带入什么，以及 DSH 预览 Host 怎么在 worktree 里安全地跑起来。

## What Changes

- **新增 `.ws/prepare-preview` 脚本（受 Git 跟踪）。**
  - 从真实 home（`WS_SOURCE_DSH_HOME`）按白名单复制运行配置到隔离 home：API key、订阅登录（原样复制，并提示 codex 登录可能被预览刷新挤掉）、默认模型与 provider、子会话模型白名单、权限预设、AUTO 路由全局配置、memex 配置，以及 registry。
  - 只修改 build 生成的 profile 文件；隔离 home 尚未 build 时，提示先执行 `dsh build`。
  - 不复制 Session 历史、storages 和按会话的状态。
  - 为这个 worktree 登记一个首选预览端口（按 operationId 哈希分散到 3180–3279），写入 `.env.local` 托管块中的 `DSH_PORT`。首选端口不保证独占，实际端口在启动时确定。
- **新增 `.ws/teardown-preview` 脚本。** ws clean 时调用，只停止 `preview.json` 记录的、身份一致的预览 Host。
- **launcher 支持在 worktree 中跑预览 Host：**
  - 在 worktree 里执行 `dsh` 时，从首选端口开始自动退避：端口已被占用，或者并发启动时没抢到端口，就换下一个，直到启动一个能确认是本次子进程的 Host。不会终止别人的进程，也不会把别人的 Host 认作自己的。实际端口和进程身份写入隔离 home 的 `preview.json`，并打印出来供 Agent 使用。
  - `dsh stop`、`dsh restart` 只作用于 `preview.json` 中记录、且身份核对一致的那个 Host。
  - 护栏：`DSH_HOME` 位于 `.git/ws/dsh-home/` 下时，拒绝对 3080 执行 start、restart、stop，从结构上杜绝把日常 Host 切到隔离 home。
- **调整验收顺序。** 新顺序为：需要验收时，在 worktree 内依次执行 `dsh build` → `ws prepare-preview` → `dsh`，在预览中验收 → 合入主干 → 在主 checkout 做生产部署。同步修订环境级指令、`add-dsh-plugin` skill 和 BACKLOG B014。B014 原有原则"预览不复制凭据"改为"按白名单复制运行配置快照，不共享 Session"。

依赖：`ws-prepare-preview-hook` 已实现。

## Capabilities

### New Capabilities
- `ohmydsh-worktree-preview`：ohmydsh 的 `.ws/prepare-preview` 行为（播种白名单、凭据处理、首选端口登记），以及 launcher 在隔离 home 下的端口退避、预览记录和日常端口护栏。

### Modified Capabilities
（无）

## Impact

- 新增 `.ws/prepare-preview`、`.ws/teardown-preview`、`scripts/lib/ws-preview-seed.mjs`，以及它们的测试。
- `scripts/launcher/args.mjs`、`main.mjs`、`environment.mjs`：`DSH_PORT`、端口退避、`preview.json`、护栏。
- `instructions/dsh-home.md`、`skills/add-dsh-plugin/`、`BACKLOG.md`。
- 安全面：真实 API key 与订阅 access token 会在 `<git-common-dir>/ws/dsh-home/<id>/` 多出一份副本（目录 0700、文件 0600，位于 `.git` 内，不会被提交），ws clean 时删除（由 `ws-prepare-preview-hook` 保证）。
