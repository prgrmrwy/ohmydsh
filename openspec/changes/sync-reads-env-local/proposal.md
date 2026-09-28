## Why

`.env.local` 只有 `bin/dsh` 会 `source`。直接运行 `node scripts/sync.mjs` 时，`.env.local` 里的 `DSH_LOCAL_MANIFEST` 不会生效，sync 看不到 overlay，于是把 overlay 条目**当作「已从 manifest 删除」静默卸载**，而且以 0 退出。这个问题已经实际发生过：一次裸跑 sync 卸掉了私有 overlay 的全部插件。`enabledEnv` 开关也有同样的分裂：`dsh build` 开着的定制，裸跑 sync 会把它关掉。

同一个仓库、同一份 `.env.local`，部署结果不应取决于走哪个入口。

## What Changes

- 以下 manifest 消费脚本在启动时读取**所在仓库根**的 `.env.local`：`scripts/sync.mjs`、`scripts/plugin-list.mjs`、`scripts/plugin-update.mjs`。
- 读取范围只限**决定部署什么**的变量：
  - `DSH_LOCAL_MANIFEST`；
  - 合并后 manifest 中各定制 `enabledEnv` 声明的变量名。
- 其它变量一律不读，例如 `DSH_HOME`、`DSH_PROFILE`、`DSH_BIN`、密钥，也不注入子进程。
- 调用方环境里**已设置**的同名变量优先，空字符串也算已设置。因此 `bin/dsh` 的行为不变，测试的显式隔离也不变。
- `.env.local` 只按字面值解析 `KEY=VALUE` / `export KEY=VALUE`，支持单引号、双引号和行尾注释，**不执行 shell**。
  - 被读取的变量若使用了 `$` 展开、命令替换等 shell 语法，manifest 消费脚本报错并以非零退出。启动清单例外：它降级，只在标准错误输出提示，不阻塞启动。
  - 这样不会让一个无法展开的值悄悄变成别的路径。
- 值来自 `.env.local` 时，sync 输出一行来源说明（只写变量名和文件，不打印值），不再无声生效。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `repo-layout`：新增要求：manifest 消费脚本自行读取仓库 `.env.local` 中决定部署内容的变量，与 `bin/dsh` 入口的部署结果一致。

## Impact

- 代码：
  - 新增 `scripts/lib/env-local.mjs`。
  - 改动 `scripts/sync.mjs`、`scripts/plugin-list.mjs`、`scripts/plugin-update.mjs`。
  - 改动经参数传入 env 的 `scripts/lib/dsh-host-runtime.mjs` 与 `scripts/lib/plugin-updates.mjs` 的调用处。
- 测试：新增 `tests/sync-env-local.test.mjs`。
- 文档：
  - `docs/notes/local-manifest-overlay.md`：删掉「裸跑 sync 需先 source」的提醒，改写为新语义。
  - `.env.local.example` 相应注释。
- 兼容性：
  - `bin/dsh` 路径的结果不变。
  - 此前裸跑 sync 会得到「无 overlay」结果的场景，现在与 `dsh build` 一致。这是本次要修的行为，不是破坏性变更。
