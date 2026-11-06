## Why

DSH 的 latest/next 频道已经到 `0.2.2-rc.1`（npm，2026-11-04 发布），本仓仍 pin 在 `0.2.1-rc.5`（`dsh.yaml:5`）。0.2.2 有两处会让现有自研包直接报错的运行体变化，还有两项默认行为变化需要明确取舍。只改 pin 会让 AUTO 的每个请求都失败，所以要按运行体迁移来做（沿用 `staged-upgrade-execution`、`runtime-api-migration` 的约束）。

## What Changes

- **pin 升级**：`dshVersion` 及同族的 skill-filesystem、mcp-client provider pin 改为 `0.2.2-rc.1`；local package 的 `@deepseek-ai/dsh-*` devDependencies 改为 `^0.2.2-rc.1`，`engines.dsh` 区间 `>=0.2.0-rc.2 <0.3.0-0` 已包含目标版本，按证据决定是否需要抬下界；更新根 lockfile。
- **BREAKING（运行体）AUTO 路由迁出 `agent/request`**：0.2.2 在 step 准备开始时就固定本步的 provider/model/effort（`dsh-agent-loop/lib/index.js:670`，早于 `agent/pre-step`）。之后 `agent/request` 返回的值只要和这个选择不一致就直接抛错（`:1000-1001`），官方也已把 `agent/request` 标为 deprecated。`dsh-auto-model-routing` 主会话改 effort（`src/policy-host.ts:209`）和子会话覆盖 route（`:218`）都必须改为在 step 准备之前调用 `agent.model.select()`。主会话的 Jev 判断目前放在 step 1 的 `agent/pre-step` 里，这个时机已经晚于选择被固定，所以判断时机或「判完再进入本步」的方式需要重新设计（见 design）。
- **BREAKING（运行体）memex 裁判工具投影迁移**：`system-prompt/assemble` 的 payload 改成了 `PromptPresentation`，不再带 `tools`（`dsh-system-prompt/lib/types/index.d.ts:114-122`）。`packages/dsh-memex/src/eval/judge-boundary.ts:22-25` 需要迁到按步骤启用的工具机制（`tools.resolve`/`executable`）。裁判工具面的要求（`dsh-memex-evaluation` spec:198）不变。
- **恢复文件观察策略**：0.2.2 默认关闭「改文件前先读」和外部修改防护。用户决定显式恢复：在 manifest 中加入官方 `@deepseek-ai/dsh-fs-observation-policy@0.2.2-rc.1`，与环境级指令里「先读后改」的约定保持一致。
- **接受 Web Fetch 新行为**：0.2.2 不再拒绝非公网地址。用户决定接受，不额外加限制；在 manifest note 或 release 记录里写明这一信任面变化。
- **其余变化逐项复核**：`ctx.tools.schemas(scope)` 在按步骤启用工具后的读回结果（dsh-pet `src/index.ts:741/1216/1280/1938` 的 Locus 工具上限核验）、`sessionProjections.register` 改为异步（sidebar-session-provider-icon `src/index.ts:23`）、官方 connection 行是否已自带 webServer（决定 `patches/connection-webserver.yml` 是否保留）、Node 最低版本 24.9、noPet 官方模块名册按目标版本重新生成。
- **隔离候选验收**：`dsh build` → `ws prepare-preview` → `dsh`，按分组复跑基线人工项。生产切换须经用户批准。

不在本 change 内（后置）：第三方插件的可选升级（better-sidebar 0.30.1、btw 1.3.5、width-tiers 2.0.2、ponytail 5.3.3，除非某项被证明是目标运行体的硬依赖）；商店包发版与商店 PR（单独走 publish 流程）；启用 0.2.2 的新功能（apply_patch、forge、liveshare、PTC VM 模式等）。

## Capabilities

### New Capabilities
- `fs-observation-policy`：部署面显式组合官方文件观察策略，使「改前先读」和外部修改防护不随运行体默认值变化而静默消失。

### Modified Capabilities
- `auto-model-routing`：主会话 effort 与子会话 route 的应用方式，从在请求时改写（`agent/request`）改为在 step 准备之前通过官方 `agent.model.select()` 设定；同步修订「AUTO 主 effort 同步官方选择」中关于应用时机与 applied 判定的要求。

## Impact

- 代码：`packages/dsh-auto-model-routing`（policy-host、`scripts/host-capability-probe.mjs:78`、相关测试与 docs）、`packages/dsh-memex/src/eval/judge-boundary.ts`，可能涉及 `packages/dsh-pet`（工具读回）和 `packages/dsh-sidebar-session-provider-icon`。
- 配置：`dsh.yaml`（pin、新增 observation-policy 条目、connection patch 的复核结论、Web Fetch 行为说明）、根 `package-lock.json`。
- 依赖：会改 lockfile，需要先 `ws promote` 才能安装。
- 运行环境：Node ≥ 24.9（本机 v24.12.0）。
- 生产：日常 Host 3080 需要用户批准后，从主 checkout `dsh build` 并重启；没有自动化覆盖的人工验收项在隔离预览里复跑。
