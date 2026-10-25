## Context

见 [proposal](proposal.md)。现行 [规范](../../specs/auto-model-routing/spec.md) 要求主子共享 questions，并在子路由中给出固定八组输出；因此不能将新的能力/深度判断静默塞入现有四档契约。现行 [请求中间件](../../../packages/auto-model-routing/src/index.ts) 对 origin=subagent 直接返回，自动覆盖所有子请求尚不存在。

当前工具 schema：普通 subagent 可传 provider/model/reasoning_effort；fork 和 spawn_teammate 未暴露这些参数。独立安装官方 0.2.0-rc.2 的[宿主探针](../../../packages/auto-model-routing/docs/host-capability-report.md)已验证普通、fork、fresh teammate 服务路径均可通过全局 pre-step/request hook 读取任务和配置实际 fake-adapter 请求，无需修改宿主。该证据不等于工具端到端或生产路由支持；fork 真实 provider 历史兼容、teammate fork 组合仍未验证，冷恢复还需插件持久化并重放初始决策。

## Goals / Non-Goals

Goals：先形成可判定的策略，再以 Jev 执行；模型能力与 effort 分离；创建路径是否受支持必须可检测、可解释。

Non-Goals：重新实现 Agent 编排，不修改 subscriptions/MANUAL，不做缓存协议、自动团队创建或持续任务重路由。

## Decisions

### D1. AUTO 默认升级（2026-10-25 用户追加授权）

初始隔离试验已完成最小真实 Magpie 验收。用户明确不需要版本开关并授权默认升级、部署验收：缺省 policy 为内部 policy-v2；已有配置未指定 policy 时直接生效，不修改会话 AUTO/MANUAL、不改主模型、不删除旧四档配置。设置只展示 AUTO/MANUAL 与新策略说明，旧四档编辑仅在显式 legacy 回滚时显示。`policy: legacy` 保留为配置/RPC 回滚值，不作为日常选择。旧配置仍保留以便回滚，不偷偷套用到独立能力/深度规则。此授权允许默认替换，不代表保留集已证明性能收益。

### D2. 策略顺序与优先级

Agent 先决定任务组织。AUTO 优先执行显式约束，再判模型能力、再判 effort，最后验证可用性与创建路径。风险与工作量不直接等同难度。主会话模型不变，未知需求保持官方推荐起点；子任务目标不足以判断时返回 needs-context，不默认最弱，也不无理由最强。显式模型保留，只判断 effort；显式 effort 保留，只判断未约束的模型维度；两者都指定时只校验，不调用 Jev。选择不可用时可见停止，不偷偷替换。

### D3. Jev 决策契约草案

主请求输入：当前用户请求与已有有界上下文；输出 depth=lower|baseline|higher。主模型尚未执行本轮，不能依赖尚不存在的拆解。没有充分升降依据用 baseline。

子请求输入：task（目标与范围）、可选 deliverable/acceptance/knownUnknowns、provider 和显式约束；不强制新增大段模板，已有 task 足够清楚时无需重复填写。输出 capability=bounded|analytical|frontier 与 depth=lower|baseline|higher，允许 insufficient-context 表达目标缺失。能力衡量方法是否明确、歧义与推理依赖；深度衡量选定能力层级所需投入。易验证允许更积极选轻量，不把可验证性用作模型能力的替代指标。

映射：每个 provider 的三个能力槽使用版本化模型配置，不以名称字典序推断能力；effort 从具体模型推荐起点按支持序列最多移动一档，受现有上限约束。自动默认仍不使用 max。轻量能力+baseline 是明确执行任务的首个基线，不因 bounded 自动输出 lower。具体模型沿用已有目录与配置来源，独立校准后形成版本化映射，不在提案中声称某组合已证明最优。

主子决策问题不同；子请求优先一次 Jev 调用获取两个维度，而非必然增加两次调用。实施前核对 Jev 公开接口能否表达两个维度，并用假服务验证本地解析契约；假服务不能证明真实服务支持，真实支持需在获准的小样本调用中验证。如接口无法可靠表达，暂停该实现项并修订契约，不悄悄退回耦合档位。

### D4. 支持状态与生效证据

推荐与应用分开记录：recommended、applied、unsupported、needs-context、failed。applied 必须有实际子请求的配置匹配证据，记录最小关联标识、策略版本、推荐/实际 model+effort，不保存原始会话或凭据。配置身份不能靠 prompt 相似度或模型显示名绑定。

实施第一步是只读/无模型调用的宿主探针：验证正式 API 能取得精确父子关系、原始任务、首次请求前的配置入口，并保证并发创建不会串用。ordinary、fork、teammate 各自出结论。缺一项即 unsupported，不启用该路径自动应用。遵循用户确认的约束：只依赖已发布官方能力，不修改宿主、不依赖 compat 补丁、不向上游提出实现前提；覆盖不到的路径如实声明。

不支持创建路径必须在路由请求结果中明确告知，且不能标记已路由。路由工具/指导要求暂停并让用户选择继承或改用受支持路径；没有正式拦截能力时不得声称系统强制阻止原生创建。用户选择继承后保持原生行为并标明未路由。

fork 还需验证历史与模型/provider 的兼容；不通过即不支持，不能擅自改为 fresh。长驻 teammate 仅在创建时选配，后续任务重选不在首版范围；MANUAL 不覆盖已创建实例的原生配置，只停止后续 AUTO 决策。

### D4a. Magpie 执行入口（2026-10-25 用户确认）

OpenRouter 只用于 Jev；本机实际验证先只经 `dsh-magpie-connect`，不调用本地 Claude/codex/subscriptions。transport provider 与模型能力家族分离：保留完整 `claude/...` / `codex/...` model ID，自动能力槽仍使用已有版本化家族表，不伪装为本地 provider、不跨 transport 回退。其他 Magpie 模型可显式指定，自动映射缺失时报告 unsupported；其 effort 需使用当前官方 LLM resolveModelInfo 返回的 defaultEffort，缺元数据不猜。显式模型+effort 仅验证目录/允许列表；无显式模型时从父模型的已知家族确定能力槽，未知则停止。旧策略目录和约束不变。真实模型调用仍需单独预算，缓存不是在线可用证据。

### D5. Agent 验收而非路由器自治重试

通过指导要求主模型区分描述不足、信息不足、推理不充分、能力不足和基础设施故障。本 change 不实现自治升级循环；升级视作主模型明确发起的新资源决策，必须记录原因并遵守显式约束。避免在没有可靠成功判据时建设重试状态机。

### D6. 三层验证

策略层使用人工预先确定的案例/反例与独立任务验收，不用 Jev 输出当正确答案；Jev 层评估对策略判据的忠实度、耗时和开销；执行层检查实际请求与并发隔离。开发案例和保留集分开。真实调用前确认模型、次数与费用/额度上限；订阅 usage 与 API 价格估算不混淆，未知值不记零。

## Risks / Trade-offs

- [宿主未提供足够入口] → 对应路径明确不支持，不能把普通 subagent 完成当作全路径完成；不以 runtime 扩展或上游改动补齐覆盖。
- [试验策略增加配置复杂度] → 仅一个显式开关，复用目录与限制，不自动迁移；验证后另决定替换默认。
- [两个判断维度增加误差] → 分层案例，先测耦合与分离策略，保留当前策略作对照。
- [当前规范仍要求共享 questions] → 当前规范对应默认策略，新 capability 仅约束显式试验路径；未来推广默认必须修改原规范。
- [原生工具可以绕过指导] → 报告真实强制边界，未绑定的创建不得冒充 routed。

## Migration Plan

提案批准 → 探针与支持矩阵 → 假服务契约测试 → 显式试验实现 → 离线验证 → 预算确认后的真实对照 → 单独决策默认推广。关闭试验选择即回到现行策略，不删除旧配置，不改已有子会话模型。无部署动作包含在本次提案交付中。
