## Why

当前 pin 的 `@deepseek-ai/dsh@0.1.1-rc.2` 在部分机器上通过 npm/libnpmexec 计算预发布 peer 依赖图时会长期无输出卡死，导致本来只是 `dsh stop`、`dsh build`、`dsh start/restart` 的日常操作不可预测地阻塞。仓库已经具备直连 npx 缓存或 pnpm 固定缓存中 CLI 的能力，但 cache miss 仍默认先进入已知不可靠的 npx 通道；需要一个默认启用、范围明确且未来可整体删除的临时运行体策略。

## What Changes

- 新增临时的默认 cache-first/cache-only 运行体策略：目标 pin 的已验证 CLI 已存在时，所有官方 CLI、build 与 web start 路径都直接执行缓存入口，不再调用 npx 做重复依赖计算。
- 对当前已知受影响的 rc.2 默认禁用 npx 安装探针；npx 缓存 miss 时优先使用或准备仓库管理的 pnpm 固定缓存，避免进入 libnpmexec Arborist 卡死路径。
- 为首次安装或缓存损坏提供有界、可诊断的失败语义和显式逃生门；不得无限等待，也不得静默切换版本。
- 保持 `dsh stop` 的本地进程管理路径不触发任何包安装或版本解析；`restart` 只在端口停止完成后解析一次目标运行体。
- 将该策略标记为临时兼容层，并记录删除条件：上游/npm 已证明解决 rc.2 依赖计算卡死，且冷启动与重复 restart 回归通过后删除默认绕过。

## Capabilities

### New Capabilities

- `dsh-runtime-provisioning`: 约束 DSH CLI/长期 web 运行体的缓存解析、受影响版本默认绕过、有界 provision 与可删除条件。

### Modified Capabilities

- `startup-autoupdate`: 明确 stop 不得触发运行体 provision，restart 对当前 pin 采用同一稳定运行体解析策略。

## Impact

- 代码：`scripts/lib/dsh-cli.mjs`、`scripts/dsh-server-bin.mjs`、`scripts/dsh-cli.mjs` 与必要的 `bin/dsh` 接线。
- 测试：扩展 `tests/sync-dshcli.test.mjs`、launcher CLI/start/restart 测试，增加“禁止默认 npx probe”和有界失败覆盖。
- 运维：本机、lumevm、devbox 后续日常 `dsh build/stop/start/restart` 默认避开 rc.2 的 npx 依赖图重算；不改变当前 `dshVersion` pin、profile 数据或凭据。
- 兼容：保留 `DSH_BIN` 最高优先级；不改变 registry 作用域与 server npm 环境清洗不变量。
