## Context

见 `proposal.md` - Why。当前解析逻辑已经集中在 `scripts/lib/dsh-cli.mjs`：`DSH_BIN → npx 缓存 → pnpm 固定缓存 → npx provision → pnpm provision`。`bin/dsh` 的 start 路径通过 `scripts/dsh-server-bin.mjs` 复用它，sync/官方 CLI 也经 `runDshCli` 复用；所以“正常缓存命中”本来就不会再次 npx。剩余风险是 cache miss 时 `probeNpxInstall()` 使用同步且无超时的 `npx -y <spec> --version`，rc.2 的大预发布 peer 图在部分机器上会长期卡死，pnpm fallback 永远没有机会执行。

当前 `autoUpdate.enabled: false` 已避免每次 start/build 查询最新版本，但它不控制 CLI provision；`DSH_SKIP_UPDATE=1` 也不是运行体解析开关。临时方案必须保持这两个概念分离，不把“跳过版本检测”误写成“保证不进 npx”。

## Goals / Non-Goals

**Goals:**

- 将受影响版本的默认 provision 策略集中到唯一解析模块，并对 `0.1.1-rc.2` 默认使用 pnpm 固定缓存通道。
- 缓存命中时保证 start/build/CLI 完全离线直连。
- 所有安装探针有界，并在失败时保留精确 pin 和已有可用缓存。
- 让临时兼容逻辑未来能以删除一条策略记录和对应测试的方式退出。

**Non-Goals:**

- 不修复 npm Arborist/libnpmexec 本身。
- 不升级 DSH 到 `0.1.2-alpha.*`，不改变 `dshVersion`。
- 不改 profile、插件或凭据格式。
- 不让 `dsh stop` 依赖任何 CLI 入口；它继续只按端口和 argv 管理当前进程。

## Decisions

### D1：以精确 spec 的集中策略表选择 provision 顺序

在 `scripts/lib/dsh-cli.mjs` 内维护临时策略，例如 `@deepseek-ai/dsh@0.1.1-rc.2 → pnpm-only`。解析的前三层优先级保持不变：显式 `DSH_BIN`、npx 已有缓存、pnpm 已有缓存都直接复用；策略只影响“两级缓存都 miss”之后允许启动的 provision 通道。

这样不会把已有 npx cache 作废，也不会把 rc.2 特判散落到 `bin/dsh`、server helper 和 sync。备选“在所有命令前默认注入 `DSH_SKIP_UPDATE=1`”被否决，因为它只控制版本检测，无法阻止 `resolveCliBin` cache miss 后运行 npx。备选“硬编码本机 `_npx/de483…` 路径”被否决，因为 HOME、npm cache 与平台不同，且已有 key 计算器能够正确解析。

### D2：逃生门只改变 provision，不改变 pin 或缓存优先级

新增一次性环境开关（实施时命名为明确的 `DSH_ALLOW_NPX_PROVISION=1`），仅允许受影响版本在 cache miss 时恢复通用 npx-first 流程。它不绕过 manifest pin、不覆盖 `DSH_BIN`，也不强制重装已有缓存。启动器必须打印提示，避免诊断环境在不知情下重新进入已知风险路径。

不采用含义模糊的 `DSH_SKIP_NPX`：默认已经是跳过，否定式开关会形成双重否定，未来删除也更难理解。

### D3：provision 使用可终止、带超时的子进程，而非无界 spawnSync

将安装探针从无界 `spawnSync` 收敛为一个可测试的有界 runner：启动独立进程组，超时先 TERM、短暂宽限后 KILL 整组，并返回带 channel/timeout 的结构化结果。默认 timeout 应足够覆盖正常网络安装，并可由测试注入短值；用户可获得明确错误而不是永远卡住。

仅依赖 shell `timeout` 不可取：macOS 默认没有 GNU timeout。只 kill 直接 pid 也不足够，因为 npm/pnpm 会生成子进程，遗留进程可能继续持锁。

### D4：pnpm 固定缓存必须事务化准备

cache miss 时在同一版本目录旁创建唯一临时 staging 目录，完成 `pnpm add <exact-spec>` 并验证 `lib/bin.js` 存在后再原子提升为版本缓存。失败或超时删除 staging，不删除/覆盖已有有效目录。并发调用通过原子目录/锁文件收敛为一个 owner；等待者只做有界等待并重新探测成品。

当前实现直接在最终目录安装，半成品 `node_modules` 会让后续探测误判。临时方案既然默认依赖 pnpm 通道，就必须补齐完整性与并发边界。

### D5：stop 保持在解析器之前短路

`bin/dsh` 当前在 `STOP` 分支直接 `do_stop` 后退出，已经满足“不 provision”。实施只增加防回归测试，不把 stop 重构进 CLI 解析器。restart 继续先 stop，再进入统一 start 路径；最终只解析一次精确运行体。

### D6：部署不要求当前会话立即重启

代码和测试提交后，launcher 更新立即对下一次命令生效；不主动重启当前 host，以免中断正在进行的 GUI 会话。用户下一次 `dsh restart` 将走默认绕过策略。lumevm/devbox 只有在拉到该提交后才获得策略，不在本次实施中远程修改。

## Risks / Trade-offs

- [pnpm 也可能因网络或 registry 异常卡住] → 同样受统一 timeout 与进程组清理约束。
- [固定缓存首次准备比复用 npx cache 慢] → 只在两级 cache miss 时发生，成功后长期直连；现有 rc.2 npx cache 命中不受影响。
- [并发 build/start 同时 provision] → staging ownership 和有界等待确保最终目录只有完整产物。
- [临时策略长期遗留] → 策略表旁记录问题、引入日期、删除 gate，并建立专门测试；升级到已验证版本后主动移除。
- [环境逃生门重新暴露卡死] → 明确提示且仍有 timeout，最坏有界失败。

## Migration Plan

1. 先增加策略选择与有界 runner 单测，再修改解析器。
2. 用临时 HOME/cache 和 stub npx/pnpm 验证 rc.2 cache miss 不调用 npx、成功产出固定缓存，连续第二次零安装。
3. 运行 launcher、sync 与 artifact 全套测试。
4. 提交后不重启当前 host；由用户稍后执行普通 `dsh restart` 验证无 `DSH_SKIP_UPDATE` 前缀也不会进入 npx。
5. 回滚只需 revert 该提交；既有 npx/pnpm 缓存可保留，不涉及用户数据。

删除临时策略前，使用显式 `DSH_ALLOW_NPX_PROVISION=1` 在隔离 cache 做一次冷安装，并连续验证 build 与 restart；全部在 timeout 内稳定完成后再走单独 change 删除策略与临时说明。

## 验收缺口（归档时记录）

缓存优先入口本身已实机验证：解析直接命中 npx 缓存中的精确 bin，无依赖
计算，host 服务 HTTP 200。

但触发本变更的那个症状——TraeX 配置保存报 `r.mutate`——**未能验证**。
TraeX 在归档时既未部署也未加载（manifest `enabled: false`，profile
composition 中 0 处，`node_modules` 下无 `@byted` 包），因此没有可观察
的现场。

这不是「验证通过」，而是「无法验证」。重新启用 TraeX 时应先复验；若症状
仍在，说明根因不在运行体入口解析，需要另开变更。
