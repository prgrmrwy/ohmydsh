## Why

`@deepseek-ai/dsh` 的 registry 默认频道已从本仓固定的 `0.1.2-rc.1` 前进到 `0.1.5-rc.2`，但两者之间包含 Session 持久化格式 v0→v3、Agent/Subagent 生命周期、Web 附件与右侧栏等破坏性迁移，现有 Pet Host compatibility runtime 和 9 个 local package 也精确绑定旧版本族。直接改 pin 会使 Worktree Session 首发附件交接、Pet independent child/原子存储能力、第三方插件装载及历史 Session 恢复失去可证明的兼容性，因此必须按可回滚的运行体迁移实施。

## What Changes

- **BREAKING** 将 manifest 的 DSH 精确 pin 从 `0.1.2-rc.1` 迁移到 registry 默认频道版本 `0.1.5-rc.2`，并同步全部 local package 的 `@deepseek-ai/dsh-*` 运行体声明、锁文件和真实 API 适配。
- **BREAKING** 针对 `dsh-v0.1.5-rc.2` 重新推导 Pet Host compatibility runtime：保留尚未上游化的 silent settlement、idle/independent continuable child、精确 child Session、询问轮接缝及 Storage transaction/applyBatch/exclusive owner 能力；重新固定 tag、commit、patch hash、override provenance 和能力探针，不机械复用 0.1.2 产物。
- 将 Worktree Session 的首次提交交接从旧图片草稿 seam 迁移到 0.1.5 generic attachment/file-upload 生命周期，同时保持同一 Session 单次提交、失败恢复、附件不丢失且不重复上传的用户语义。
- 用真实旧 Session 数据验证上游 v0→v3 链式迁移、冷读、恢复写入和重启一致性；迁移无法证明安全时 fail closed，不自行重写历史日志。
- 按依赖方向分批审查并精确 pin 目标运行体兼容的第三方插件：升级 better-sidebar、cost-meter、width-tiers、skin-center、session-archive、cockpit-bridge 与 Trae；为必须保留的 subscriptions 0.9.2 应用仅扩 0.1.5 peer 的可复现兼容 patch；按用户决策移除 open-in-vscode、sidebar-qa、setting-restart，保留唯一 Archify Skill 来源。
- 在旧版先固定可复跑基线，再以独立 `DSH_HOME`、备用端口和分组组合复跑 host/client、Web、Session、Worktree、Pet、Cockpit 与安全边界；每阶段保持单独回滚和连续两次 sync 幂等。
- 增加 devbox 主干构建验收：实现形成可复核 Git commit 后，通过 SSH 登录 devbox，第一步调用 `set_sh_devbox_proxy`，再从 Git 获取候选 commit，在 devbox 的隔离 checkout、隔离依赖与隔离 `DSH_HOME` 中完成全部清洁构建和场景验证；不得借用、修改或长时间占用本地 `ws/dsh` 的依赖、构建产物、Host 或现有 GUI。host/lumevm 由用户在 devbox gate 通过后手动部署，不属于本 change 的自动验收面。
- 保持 `autoUpdate` 关闭；此次迁移只接受经审查的精确版本，不追踪 `0.1.6-alpha`，也不把未完成的 `pet-locus-independent-agent-inquiries` 产品语义混入本次升级。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dsh-runtime-provisioning`: 为长期 Host 的精确 compatibility runtime 增加跨 DSH 版本族重审、能力证明、provenance、版本不匹配拒绝及官方一次性 CLI 隔离要求。
- `runtime-api-migration`: 将真实历史 Session 格式迁移、local package 全量 host/client 构建以及第三方 loader/实际激活纳入运行体 API 迁移的强制验收面。
- `source-workspace-worktree-session`: 明确首次 Worktree 提交必须保留 generic attachments 的单次交接、失败恢复和去重语义。
- `staged-upgrade-execution`: 明确运行体原子批、无兼容版本插件的禁用闸、独立 `DSH_HOME` 分组候选验证和数据迁移回滚证据。

## Impact

- 真相源与依赖：`dsh.yaml`、根 `package-lock.json`、9 个 `packages/*/package.json` 及其 host/client 源码和测试。
- Host compatibility：`packages/dsh-pet/compat/subagent/` 的 Subagent、Agent Loop、Storage、launcher builders、patches、fingerprints、provenance 与运行时探针。
- Worktree Session：`packages/worktree-session/src/client/handoff.ts` 及 generic attachment/file-upload 测试装置。
- 第三方 pin：cost-meter、width-tiers、better-sidebar、skin-center、session-archive、cockpit-bridge、Trae、subscriptions compatibility fork 与 opencode header；并从 manifest 清理 sidebar-qa、open-in-vscode、setting-restart，保留 archify-dsh Skill 来源。
- 持久数据与运行环境：历史 Session v0/v1/v2 日志、Pet SQLite、隔离 `DSH_HOME`、Web profile、启动清单及现有 GUI 刷新流程。
- 并行变更：`pet-locus-independent-agent-inquiries` 继续拥有 G1–G5 的产品语义；本变更只负责把其已经明确要求的 runtime seams 等价迁移到 0.1.5，不将未完成门槛宣称为通过。Pet 整体及当前可达的 silent/idle/independent/exact-session/Storage 能力是本次生产切换硬门槛，不允许通过禁用 Pet 或降级能力完成升级。