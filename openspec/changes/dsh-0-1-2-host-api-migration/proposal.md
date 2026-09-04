## Why

本仓库的 DSH 运行体仍 pin 在 `0.1.1-rc.2`,而 registry 的 `latest` 已是 `0.1.2-rc.1`。前一个 change `staged-dsh-and-plugin-upgrade` 已完成全部不依赖运行体的插件升级(阶段一至三),但其阶段四在 4.5 阀门**停止并回退**:该 change 的 spike 只审计了 client 半区,遗漏 host 半区,实测 8 个自研包中 **5 个无法构建**,破坏点超出其「只做等价接线迁移」的 Non-Goals 边界。

停止是正确的,但代价是两项收益被一并阻塞:`dsh-better-sidebar@0.18.0` 与 `dsh-sidebar-qa@0.5.0` 都要求 `0.1.2` 线运行体,至今无法放行。本变更以「host 半区 API 适配」为正题重新立项,把前次已查清的部分直接复用,只解决真正未解的问题。

**关键的是,其中一处破坏牵涉安全边界而非单纯的 API 变更**:`connection.rpc.handle` 删除了第三个参数,而本仓库三个插件统一传入的 `{ authority: 'loopback' }` 正在其中——该约束已写入 `settings-system-clock` 的 spec 要求,不是实现细节。因此这不能作为一次机械的编译修复处理。

## What Changes

### 前置 spike:补齐 host 半区(门槛,不通过则停)

前次 change 的失误根因是**审计面被"客户端包只影响客户端"的直觉缩小**。本变更的 spike 必须同时覆盖 host 与 client 两个半区,并逐项回答:

1. `Session.events` 在 `0.1.2` 的替代读取方式(影响 `dsh-pet` 取标题与水位、`worktree-session` 判定 blank session)
2. **`authority: 'loopback'` 的等价安全机制** —— `handle(channel, handler, options)` → `handle(channel, handler)`,且 `ConnectionRpcHandlerOptions` 类型已完全不存在
3. `SubagentRuntime.registerContinuableSetup` 的承接 API(`worktree-session` 核心路径)
4. `SessionLogOffset` 类型收紧的迁移方式(`session-links`)
5. `worktree-session` 3 例测试 `no agent factory registered` 的成因

### host 半区适配 + 运行体升级(同批次)

- 5 个包适配新 host API:`dsh-pet`、`worktree-session`、`system-clock`、`home-network-model-guard`、`session-links`
- 7 个包的 client 半区按前次已查清的映射改 inject 声明(方案已验证可行,见 Impact)
- `dshVersion` `0.1.1-rc.2` → `0.1.2-rc.1`,与 8 个 local package 的运行体 peer **同批次**变更

三者不可拆分:适配代码在旧运行体上无法编译(新 API 不存在),而 peer 检查要求 `dshVersion` 与 peer 声明同批变更。

### 放行后置插件

- `dsh-better-sidebar` `0.17.1` → `0.18.0`
- `dsh-sidebar-qa` `0.4.0` → `0.5.0`

### 明确不做

- **不重新设计自研包的架构**:适配以「保持现有功能语义」为准,不借机重构
- **不放宽 `authority: 'loopback'` 的安全语义**:若 `0.1.2` 无等价机制,停下来讨论,不得默认删参
- 不改动任何插件或自研包的用户可见功能

## Capabilities

### New Capabilities
- `runtime-api-migration`: 运行体主版本迁移中「宿主 API 破坏面」的处理契约——审计面必须覆盖 host 与 client 两个半区、安全语义类 API 被移除时的处理规则(不得以编译通过为由静默降级)、适配必须保持既有功能语义而非借机重构,以及迁移前后如何以同一基线证明能力稳定。

### Modified Capabilities
- `settings-system-clock`: 其两条 requirement 显式把 RPC channel 的 `authority: loopback` 写为规范约束。`0.1.2` 移除了该参数,需明确该安全语义在新运行体下如何表达与验证——**规范意图(通道限本机回环)不变,变的是表达方式**。若新运行体确无等价机制,该 requirement 需改为声明等效的替代保障,而不是删除约束。

## Impact

- **运行体**:`dshVersion` `0.1.1-rc.2` → `0.1.2-rc.1`(registry `latest`,2026-09-04 复核仍是该版本)
- **自研包**:8 个 package 的 `peerDependencies` 同批更新;其中 5 个需改 host 半区代码,7 个需改 client 半区 inject 声明
- **配置真相源**:`dsh.yaml`(`dshVersion` 与两个后置插件 pin)
- **可直接复用的前次产出(不必重做)**:
  - client 半区映射已查清:`sessions`→`dsh-api-session-controller`、`slots`→`dsh-client-ui-renderer`、`workspaces`→`dsh-api-workspace-controller`、`conversation`→`dsh-client-ui-conversation`;`ISessions` 保留 14 个成员,移除的 3 个本仓库均未使用
  - 能力基线 `baseline.md`(自动化 951 例 + 人工清单)已固定,并在前次失败中验证过归因作用
  - 后置插件准入已查清:`sidebar-qa@0.5.0` 所需 7 个 `ctx.remote.session.*` 方法全部可得,但 `selectModel`/`modelCatalog` 由 `dsh-client-ui-model-selection` 提供,验收须确认该包加载
- **校验**:`tests/local-package-peers.test.mjs` 在迁移期间全量失败是预期前置门槛(已由 `repo-layout` 规范固化),不得放宽
- **开发方式**:沿用前次已验证有效的隔离方式——独立 Worktree Session + 隔离 `DSH_HOME`,升级与回退全程未影响日常 GUI
- **风险**:`0.1.2-rc.1` 为 rc 级;前次已实测该升级会同时触发 5 包构建失败,故本变更的实际工作量集中在 host 适配而非版本号变更
