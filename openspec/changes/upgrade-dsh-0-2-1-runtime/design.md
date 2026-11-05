## Context

动机见 proposal.md。决策依据的事实都在 2026-11-05 核对过：

- **官方兼容检查**（`packages/boot/app-boot/src/plugin-compatibility.ts`）：
  - `dsh-v0.2.0-rc.2` 只检查 `@deepseek-ai/dsh*` peer，使用 `semver.satisfies(..., { includePrerelease: true })`，不读 `engines.dsh`。
  - `dsh-v0.2.1-rc.5` 和 `dsh-v0.2.2-rc.1`：声明了 `engines.dsh` 时只看它，否则看 peer。两种情况都按含预发布语义匹配。商店索引生成器（`apps/plugin-market-generator/src/packages.ts`）显示的范围也是优先取 `engines.dsh`，没有时取 peer 的合取。
- **实测**：`^0.2.0-rc.2` 在含预发布语义下接纳 `0.2.1-rc.5` 和 `0.2.2-rc.1`，在标准语义下都不接纳。`>=0.2.0 <0.3.0` 在含预发布语义下**也接纳 `0.3.0-rc.1`**；`<0.3.0-0` 不接纳。
- 所以已上架的四个商店包（peer `^0.2.0-rc.2`）在 0.2.1 Host 上**不会被拒绝加载**，用户问的「>= 效果」已经存在。剩下要回答的只是代码在 0.2.1 上能不能用。
- 本仓 `tests/local-package-peers.test.mjs` 强制所有 `@deepseek-ai/dsh-*` 依赖（含 peer）等于 `^<dshVersion>`。不改这个检查的话，升到 0.2.1-rc.5 会迫使商店包把下界抬到 0.2.1-rc.5，没必要地丢掉 0.2.0 用户。
- 仓库没有配置 strict-peer。pnpm 按标准语义校验，只会对预发布运行体报 peer 警告，不会失败。

## Goals / Non-Goals

**Goals**
- 生产运行体切换到 `0.2.1-rc.5`，期间不出现已启用定制缺席的中间态。
- 运行体兼容声明改为显式区间，以后在 0.2.x 内升级不再被迫改写 peer。
- 四个商店包在切换验收后得到明确结论，需要时发版。

**Non-Goals**
- 0.2.2 系列，以及 0.2.1 新增的实验插件。
- 改变任何插件的用户可见行为。适配只追求语义等价（`runtime-api-migration`）。

## Decisions

### D1 兼容区间：`>=<下界> <0.3.0-0`，`engines.dsh` 与 peer 同值
- **选择**：每个 local package 的 `engines.dsh` 和全部 dsh peer 写同一个字符串。默认 `>=0.2.0-rc.2 <0.3.0-0`；只有代码不再兼容旧版时，才把下界抬到 `0.2.1-rc.5`（见 D5）。
- **为什么两个都写**：0.2.0 Host 只看 peer，0.2.1+ 只看 engines。两个字段同值，才能在两类 Host 上得出一致结论。
- **为什么要上界**：DSH 0.x 的 minor 升级历来带破坏性变化（0.1→0.2 的 Session 格式、settings 接口）。不封顶就等于承诺未验证的 0.3。
- **否决的方案**：
  - 继续用 `^<dshVersion>`：每次升 rc 都要被迫抬下界、重新发版。
  - `>=0.2.0`（不封顶）：同上，承诺了未验证的 0.3。
  - `<0.3.0`：含预发布语义下会接纳 0.3.0-rc。

### D1a peer 带 `|| ^<dshVersion>` 尾段（实施中发现，2026-11-05）
peer 一开始写成和 `engines.dsh` 完全相同的区间，但 npm 是按标准 semver 校验 workspace peer 的，0.2.1-rc.5 不满足这个区间。结果 npm 不把运行体包 hoist 到仓库根，而是在各 package 下嵌套 rc.5 副本。部分官方包仍然 hoist 在根上，它们解析依赖时会越过 worktree，找到主 checkout 里 0.2.0-rc.2 的 `node_modules`，typecheck 因此报出 `SessionId` 双实例错误。

最终方案是 peer 写成 `<engines.dsh> || ^<dshVersion>`。尾段是区间的子集，在 Host 的含预发布语义下判定不变；对 npm 来说则能被当前 pin 满足。另外要求每个 dsh peer 都有同名 devDependency。

被否决的方案是根 `.npmrc` 的 `legacy-peer-deps=true`：它会让 npm 停止安装运行体包之间的必需 peer，实测缺了 17 个包，例如 `dsh-sandbox`、`dsh-fs`、`cordis-plugin-include`。

代价：升 pin 时，peer 尾段和 devDependencies 一样需要机械改写，但兼容区间和下界不变。

### D2 devDependencies 继续跟 pin
`@deepseek-ai/dsh-*` devDependencies 设为 `^<dshVersion>`，保证 build/typecheck 针对当前 pin 进行。兼容区间的「下界」由实测证据支撑，不靠类型。

### D3 schedule bundle 删除条目，而不是禁用
0.2.1 起 Automation 由官方 Web 承载，旧实验 bundle 选择会被自动清理，并且已无对应版本可 pin。按 `remove-dsh-plugin` 的语义删除该 manifest 条目，同时删掉 btw note 里「experimental-schedule 启用时工具集不一致」这条已失效的说明。候选验收中要确认：0.2.0 时期创建的任务仍在官方 Automation 页可见。

### D4 btw 作为 W1 前置项
PR #16 已合入上游，1.3.2 的 peer 同时覆盖新旧运行体。这符合 `staged-upgrade-execution` 的「上游发布后回收临时 fork pin」和「双兼容插件前置」。如果在 0.2.0-rc.2 上验收时发现 1.3.x 的行为相对 PR 构建有回退（例如 cache 命中），改判为不前置并记录证据。

### D5 商店包下界按证据定
商店包有四个：auto-model-routing、magpie-connector、sidebar-session-provider-icon、session-id-copy。
- 两个纯 Web client 包（session-id-copy、provider-icon）预计代码不变。只要在现役 0.2.0-rc.2 和候选 0.2.1-rc.5 上都验证过，下界就保留 `0.2.0-rc.2`。
- auto-model-routing 依赖子代理创建与完成语义，这部分 0.2.1 改了。如果适配后依赖「child ID 立即返回」这类新行为，下界抬到 `0.2.1-rc.5`。
- magpie-connector 是 provider 加 Web，可能受 API Key 读取优先级变化影响，由审计决定。
- 结论逐包记录在 `checking/store-packages.md`。

### D6 验收环境沿用 0.2.0 升级的做法
隔离 `DSH_HOME` 和非生产端口（`dsh build` → `ws prepare-preview` → `dsh`）按最小分组逐步组合。清洁构建 gate 按 `staged-upgrade-execution` 的 devbox 场景执行。日常 3080 只在原子切换后刷新验收。

## Risks / Trade-offs

- **0.2.1 的子代理通知语义变化让 Pet Locus 或 AUTO 静默失效**（调用成功、无报错、结果丢失）→ 先读 `docs/architecture/dsh-plugin-integration-pitfalls.md`；候选中用真实子任务验证完成通知能回到父会话，不以无报错作为通过依据。
- **Automation 接管旧任务失败** → 切换前备份会话目录。验收清单列出现有任务的名称和下次触发时间，切换后逐条比对。
- **区间声明与实际不符**（声明了 `<0.3.0-0`，但 0.2.2 实际不可用）→ 这是 `engines` 的固有语义，任何区间都有这个风险。0.2.2 有已知破坏项，但当前已发布的包本来就声明了同一区间，本 change 不扩大承诺。升 0.2.2 的 change 需要按证据决定是否收窄或发新版。
- **pnpm 对预发布运行体报 peer 警告** → 这是已知噪声。验收不以无警告为条件，以 loader 结果与功能为准。

## Migration Plan

1. W0：在 0.2.0-rc.2 上跑通并记录基线。
2. W1：btw 回收（加 width-tiers，如果判定可前置）。在现役运行体上 build、刷新、验收，然后独立上线。
3. W2+W3：在 worktree 内完成全部改动，在隔离候选中按分组验收，然后跑 devbox 清洁构建 gate。
4. 原子切换：备份会话、Pet SQLite、profile；从主 checkout 执行 `dsh build`，连续第二次应无变更；由用户决定是否重启。重启后刷新 3080 验收。
5. 回滚：停止 writer → 恢复备份 → 恢复旧 manifest（`dshVersion: 0.2.0-rc.2`、schedule bundle 条目、旧 devDependencies）→ `dsh build` → 重启。0.2.1 如果改写了会话或 Automation 投影，不能直接用旧版读取，必须先恢复备份。
6. W4：切换验收通过后，逐个发版商店包（先在主仓升版本并推 main，由 mirror-release 打 tag 发布）。商店 PR 经用户确认后再提交。

## Open Questions

- 0.2.1 是否对 Session 或 Pet 持久格式有单向迁移？release notes 没有提到格式升级，候选验收时用真实备份副本确认。结果只影响回滚步骤的细节，不改变方案。
