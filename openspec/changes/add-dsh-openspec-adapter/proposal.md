## Why

当前 OpenSpec CLI 的全局安装没有把项目 `.agents/skills/openspec-*` 发布到其它 DSH workspace，社区适配器又仅支持旧版本的部分会话命令。需要一个可受管升级、忠实消费官方会话能力、且可外挂路由策略的 DSH adapter，而不是再维护一套 OpenSpec 工作流或把全部 CLI 功能包装进会话。

## What Changes

- 新写本地 `packages/dsh-openspec` bundle；`@codigoconelmer/dsh-openspec@0.1.0` 仅作为 NOTICE 中致谢的 prior art，不复制其源码（它只有六条 slash 且无 Skill provider，保留价值低，且避免与仓库“第三方不 vendor”原则冲突）。不在本 change 创建远端 fork 或发布 npm。
- 从独立受管、精确 pin 的官方 OpenSpec 版本生成 Skills 与 slash commands，覆盖官方支持的完整会话工作流集合并遵循其 profile/delivery 配置；CLI-only 功能保持官方 Bash/终端用法。
- 增加明确标记为自定义的 `/openspec-init` 与 `openspec-upgrade`（Skill + slash）。每次消费在未改动的官方正文之后追加一个格式受规范约束的适配器块，其中的受管 CLI 调用串使模板与该调用同版本；不修改系统全局 CLI，也不宣称重定向裸 `openspec` 命令，版本不一致由管理检查报告。
- 使用 Skill 或 slash 时按需检查官方稳定更新（插件选项 `updateCheck` 读 DSH settings 服务命名空间 `dsh-openspec`，默认开启）；成功结果共享缓存 24h，失败退避 15min，只作为下一次消费结果里的附加提示、不安装、不开新轮次。显式升级/回滚是同一种 source-owned 事务：写回包 pin 与根 lockfile、验证后激活，带中断恢复 journal；区分软件升级、项目 `openspec update`、`opsx-update` change 修订。
- 暴露实验性 routing-provider **契约**（contract-only：无生产调用方，不向任何会话发布 `openspec_route` 或指导），支持 `change-necessity`、`workflow-selection` 两阶段，经唯一的进程内入口调用；无 provider 时维持官方行为。会话工具发布推迟到拿到真实 Pet executor/Locus child 样本之后的单独 change。
- 用本地测试 router 验证接线。现有 Jev MCP、shadow Skill、recorder、Anvil/schema 与 spec-superflow 保持不变；真实 Jev adapter 在后续 change 实现。

## Capabilities

### New Capabilities

- `dsh-openspec-session`: 受管官方版本、官方会话表面、规范化适配器块、slash 命令载体、跨 workspace 发现（含已知 Pet 暴露缺口的声明）、slash 初始化、manifest 散文记录与 pin 对 lockfile 校验、幂等部署。
- `dsh-openspec-updates`: 按需更新检查、去重提示、显式可逆升级/回滚事务、中断恢复与独立管理入口。
- `dsh-openspec-routing-extension`: 两阶段、dispatcher 持有信任的 router 契约（contract-only）、生命周期、权威优先级与唯一进程内入口。

### Modified Capabilities

- 无。复用 `repo-layout` 的 local package/精确 pin/第三方记录/源码与生成产物分离契约，不改变既有 Jev shadow 规范。把 router 结果交给 Agent 实际上就是 advisory，因此本 change 只允许测试 provider 被选为 active；任何生产 provider 需另立 change 并经用户显式批准，Jev 须先完成 `jev-workflow-routing` 的 advisory 准入。

## Impact

- 新本地 bundle、构建/同步配套、根 lockfile、`dsh.yaml` 启用条目及官方依赖的散文记录（不含版本号），以及部署与用法说明；在 `BACKLOG.md` 登记“宿主层 Skill provider 进入 Pet scope”这一跨 provider 缺口（archify、spec-superflow 同样存在，本 change 不修）；DSH core 不修改。
- 引入官方 `@fission-ai/openspec` 精确依赖，初始基线 `1.13.2`（规划期检查的 npm latest；本机全局为 1.11.0），现役 DSH `0.1.5-rc.2`；内部模板模块由单一兼容层隔离并验证。
- 出站流量：更新检查只访问官方 npm registry 元数据，升级才下载发布物，均不携带会话、代码、路径或 provider 凭据。官方 CLI 默认会向 `edge.openspec.dev` 发送命令名与版本遥测；受管调用默认设置 `OPENSPEC_TELEMETRY=0`，插件选项 `telemetry: official` 时改为尊重用户的官方设置；受管调用恒设置 `OPENSPEC_NO_UPDATE_CHECK=1`，避免官方 CLI 自行访问 registry 并提示在受管流程之外升级。
- 运行状态在 `$DSH_HOME/plugins/dsh-openspec/`（generations、缓存、journal），不覆盖项目 change、系统全局安装或其它插件。注意：宿主层 Skill provider 会进入 Pet scope（已知缺口，与 archify、spec-superflow 同级，本 change 如实声明、不修复）。
- Anvil 由用户显式选择。本次只产出规划及独立审查，不实施代码、不部署、不重启宿主。
