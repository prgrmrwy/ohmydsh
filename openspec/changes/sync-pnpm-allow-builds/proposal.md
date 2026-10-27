## Why

DSH 用 pnpm 安装 profile 插件。pnpm 碰到一个尚未决定是否允许执行构建脚本的依赖时，会在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 下写入占位符 `set this to true or false`，然后以 `ERR_PNPM_IGNORED_BUILDS` 让本次安装失败。占位符不消失，之后每次安装都会失败。sync 目前完全不管这个文件，于是每台新机器第一次 `dsh build` 都会被拆成二十多个 `failed to install`，只能现场查日志、手改部署目录。2026-10-28 在 pvedev 上又遇到一次，这已经是第二次排查同一个问题。手改部署目录也违反"`dsh.yaml` 是唯一入口"的原则。

## What Changes

- `dsh.yaml` 新增顶层字段 `pnpmAllowBuilds`：依赖名到 `true`/`false` 的映射，作为 profile 构建脚本授权的真相源。初始值取自当前主力机已审查过的决定：`@google/genai: false`、`protobufjs: false`、`node-pty: true`。
- sync 在任何插件安装之前，把声明的决定写入 profile `pnpm-workspace.yaml` 的 `allowBuilds`。文件其它内容和不由 manifest 声明的条目一律保留，并保持幂等。
- sync 在部署账本中记录自己写过哪些条目。某条目从 manifest 删除后，若部署值仍等于 sync 当初写入的值，就撤销该条目；用户自己加的条目不动。
- 预检阶段发现 `allowBuilds` 中仍有未决定的条目（值不是布尔）时，sync 在安装之前 fail closed，一次性列出这些依赖名并指向 `dsh.yaml` 的 `pnpmAllowBuilds`。
- 某次安装失败后，若 pnpm 新写入了未决定的条目，sync 立即停止剩余安装，只报这一个首因，不再连锁报出几十个次生失败。
- sync 不自动批准任何构建脚本。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `repo-layout`：新增要求"profile 构建脚本授权由 manifest 声明并由 sync 物化"。

## Impact

- 代码：`scripts/sync.mjs`（manifest 校验、新的物化步骤与预检、安装失败后的首因判定、账本字段），`dsh.yaml`（新字段与初始值）。
- 测试：`tests/` 下新增 sync 场景测试（隔离的 `DSH_HOME`）。
- 部署：只写 `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 段。已有部署的首次运行若与声明一致则为空操作。
- 本地 overlay（`dsh.yaml.local`）只允许 `customizations` 顶层字段，本变更不放开这一限制。
