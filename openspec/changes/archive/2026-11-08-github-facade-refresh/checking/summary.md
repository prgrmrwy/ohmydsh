# 归档复核（2026-11-08）

本 change 按原 `PASS_WITH_WARNINGS` 收尾；历史警告没有回写为已解决。维护者联系地址仍未获本轮独立确认，本轮没有修改联系信息、发布外部内容或重新拍摄图片。

## 当前基线与证据

- 在受管 `ws/change` 中先同步到 `origin/main` 的 `83a26b0e`，共补进 33 个提交；manifest 已 pin DSH `0.2.2-rc.1`。
- 原始实现、隐私人工门禁、双语检查、426 项根测试（424 通过、0 失败、2 跳过）与二次 sync 证据保留在 `verify.md`，后续真实截图补充也保留。它们是历史结果，本轮未冒充重跑。
- 后续 0.2.2 升级的 `checking/summary.md` 记录根测试 775 通过、0 失败、2 跳过，以及全部包 build/typecheck 通过，支持旧代码已在完整依赖环境继续验证。

## 规范同步与最终实现对齐

- 新建 repo-docs-governance、repo-facade 主规范；向 repo-layout 仅合并本 change 两项新增与一项修改，保留后续 Node、peer、构建输入和运行体配置规则。
- 展示允许名单跟随三个包的正式更名；Node 启动器的子命令检查按实际参数解析行为描述。
- 迁移处置表可在活跃或归档目录定位；已获准退休的 checking 文档按固定完整 commit/blob 审计，不恢复副本，也不把今日工作树上的旧迁移命令说成已重跑通过。
- 主规范用描述性来源名称表达旧路径禁令，未扩大全仓扫描豁免；代码与测试均未修改。

## 本轮验证

- 归档后在受管 worktree 运行 `npm test`：777 项，774 通过、0 失败、3 跳过，退出 0。跳过项为两项依赖真实 DSH MCP bridge 的集成探针，以及当前 macOS 环境不适用的 Linux systemd 作用域用例；未改跳过条件或断言。
- `npm run typecheck --workspace dsh-openspec` 与 `npm test --workspace dsh-openspec -- --no-fsModuleCache`：38 文件 / 162 项通过，退出 0。
- `openspec validate --specs --strict`：60 份主规范全部通过；六个 change 在移动前均严格校验通过。
- `npm run check:artifacts`、`git diff --cached --check` 通过。根回归在所有新增规范和归档目录已进入 Git 索引后执行，包含链接、旧路径残留、归档后处置表定位与精确历史证据核验。
- 六个 change 的 33 项增量 requirement 描述与具名场景均逐项核对到主规范；未触及的要求保留，memex 合并二次执行结果不变。原来存在的元数据文件均逐字节保留；managed-superagent-host 原本没有 `.openspec.yaml`，没有人为补造。
- 独立只读复核未发现阻断项，并用 Git 索引文本核实 11 个增量 capability / 33 项 requirement 完整同步、6 份既有主规范中的另外 69 项要求均保留；历史警告、测试缺口与退休证据没有改写为完成。
- 独立复核发现的跨规范冲突已按 `baac3208` 的现行实现修正：Pet 排空要求只约束有效 descriptor 的协议分支；web 缺 descriptor 告警后跳过排空，非 web 前置限制、无效凭据拒绝及原进程身份守卫保持有效。这是规范对齐，没有修改实现或测试。

## 本轮归档批次

同一批次归档六项到 2026-11-08，新增五份能力规范并更新现有规范：

- [unify-skill-execution](../../2026-11-08-unify-skill-execution/tasks.md)：10/10，保留三端原生验收及尚未完成的物理终端关闭/桌面 UI 认证边界。
- [managed-superagent-host](../../2026-11-08-managed-superagent-host/tasks.md)：13/13，保留真实部署隔离证据及当前 profile 边界。
- [dsh-memex-switch-primary](../../2026-11-08-dsh-memex-switch-primary/tasks.md)：33/33，四个 capability 已同步。
- [auto-routing-marketplace-refresh](../../2026-11-08-auto-routing-marketplace-refresh/tasks.md)：4/4，按原发布合同保留历史 npm/商店外部待办，不把当时状态冒充今日状态。
- [fix-openspec-generation-closure-identity](../../2026-11-08-fix-openspec-generation-closure-identity/tasks.md)：18/18，补上后续升级与本轮验证，历史 7 项失败仍保留。
- [github-facade-refresh](../tasks.md)：57/57，按原 PASS_WITH_WARNINGS 收尾，未修改联系信息或伪标警告已解决。

本轮没有生产 build、Host 重启、包发布或 worktree 清理；归档命令以 `--skip-specs` 仅完成目录移动，因为规范已先行智能合并并验证。

## 保留活跃的 change（15 项）

| Change | 保留原因 |
| --- | --- |
| [upgrade-third-party-plugins](../../../upgrade-third-party-plugins/proposal.md) | 已有历史用户验收声明，但缺 design/specs/tasks，且提案仍混有相反的早期部署描述；不在本轮擅自补造产物或假定全部门槛完成。 |
| [sync-build-inputs-dirs](../../../sync-build-inputs-dirs/verify.md) | 仍有明确 DECISION: FAIL，强制全仓零跳过门槛未满足；本次 3 项跳过不构成豁免。 |
| [sync-pnpm-allow-builds](../../../sync-pnpm-allow-builds/tasks.md) | 0/11，未实施。 |
| [session-safe-dsh-restart](../../../session-safe-dsh-restart/tasks.md) | 缺真实 macOS 会话内重启与重连 receipt 验收，普通升级/生产重启不等价。 |
| [magpie-owner-routes](../../../magpie-owner-routes/tasks.md) | GUI 分组已有后续证据，但指定发版及 PR 更新仍未结清。 |
| [dsh-memex-reuse-evidence-and-card-lead](../../../dsh-memex-reuse-evidence-and-card-lead/tasks.md) | 缺下一回合提醒与消费、频率、成本观察报告。 |
| [dsh-memex-retrieval-suite](../../../dsh-memex-retrieval-suite/tasks.md) | 完整 20 题中仍有 11 题目标待确认，并依赖 reuse → fix-stale 的先行收尾。 |
| [dsh-memex-primary-switch-carries-cards](../../../dsh-memex-primary-switch-carries-cards/tasks.md) | 缺真实迁卡、copied/skipped 与后续召回日志验收。 |
| [dsh-memex-remote-config-moves-library](../../../dsh-memex-remote-config-moves-library/tasks.md) | 缺真实迁库、同步状态、旧目录退休和只读失败路径验收。 |
| [dsh-memex-fix-stale-card-on-use](../../../dsh-memex-fix-stale-card-on-use/tasks.md) | 缺 overwritten/created 与依据抽样、前后新卡对比，并依赖 reuse 先归档。 |
| [dsh-memex-delete-undeclared-library](../../../dsh-memex-delete-undeclared-library/tasks.md) | 文档/版本任务框有旧账，但真实 GUI 二次确认与空库物理删除仍缺证据。 |
| [dsh-memex-demote-in-context-self-cards](../../../dsh-memex-demote-in-context-self-cards/tasks.md) | 0/14，未实施。 |
| [collab-cross-machine-spi](../../../collab-cross-machine-spi/tasks.md) | 0/67，设计已评审但尚未实施。 |
| [auto-routing-policy-and-enforcement](../../../auto-routing-policy-and-enforcement/tasks.md) | 缺真实 teammate 路径与保留任务集质量/返工/总开销对照；旧 policy 增量不可覆盖新行为。 |
| [auto-model-routing-standalone-release](../../../auto-model-routing-standalone-release/tasks.md) | 商店 PR 已有后续承接，但 Trusted Publisher/OIDC 仍缺独立完成证据；原任务明确要求外部待办未完时保留。 |
