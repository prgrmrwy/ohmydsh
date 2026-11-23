## Why

Agent 能决定派发，不代表创建接口允许选择 model/effort。当前推荐工具覆盖不了未暴露参数的 fork/teammate 路径，且单一难度档位同时控制能力和预算，无法独立验证策略收益。需要先明确策略，再定义 Jev 判断与实际执行契约。

## What Changes

- AUTO 默认升级为独立能力/深度策略（内部 policy-v2）；不提供日常版本选择，显式 legacy 配置仅用于回滚，保留旧四档配置与 MANUAL。2026-10-25 用户追加确认默认升级与本地部署。
- Agent 保留拆解、派发和验收权；AUTO 负责资源选配与生效，Jev 负责有限判断。
- 主会话仅调整 effort；子任务独立判断能力需求与推理投入，推荐 effort 为起点。
- 建立普通 subagent、fork、teammate 的能力探测和实际请求验证；不支持路径明确报告，不将推荐冒充应用成功。
- 将策略质量、Jev 忠实度和接入正确性分层验证。试验是否成为默认需另行批准。

## Capabilities

### New Capabilities
- `auto-routing-policy-v2`: 显式试验策略的决策契约、创建路径支持门槛、约束与验证。

### Modified Capabilities
- 无。现有 auto-model-routing 四档契约继续适用于默认策略；新策略隔离启用，不静默迁移。

## Impact

预期涉及 auto-model-routing 的判断、映射、工具与请求接入、设置和测试。宿主接入需先完成正式扩展点探针，不能先承诺 Teams/fork 支持。排除 subscriptions、MANUAL 改造、缓存协议、团队调度重做、自动发布与部署。只有提案获批后才进入代码实现。
