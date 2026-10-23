# AUTO routing：核心诉求与待补差距

记录时间：2026-10-24（Asia/Shanghai）。状态：需求回顾与调研，不是已批准实施方案；不修改现行运行规范、0.3.0 默认行为或生产配置。

## 用户核心诉求（后续方案的验收方向）

1. 决策配置遵循 Anthropic 与 OpenAI 对具体模型用途、effort、委派和成本优化的官方建议；区分官方支持能力、官方推荐和本项目经验策略，不将自定义四档表称为官方标准。
2. 主会话保留用户选择的 provider/model，只调整 effort。保留主模型的理由包括行为/上下文连续性与减少缓存扰动；不承诺改变 effort 一定保留缓存，须按实际适配器核验。
3. 强主模型承担理解、拆解、协调与验收；适宜的执行任务交给较轻量子模型。不因缺乏跨模型评估而简单退回“所有子会话默认使用强主模型”，也不把所有小事都委派。
4. AUTO 的目标是质量、速度、总开销的平衡，避免一律最高或最低配置。总开销包括判档、上下文移交、worker 执行、主模型复核与失败重试。
5. 用户记得曾要求“主模型让简单子模型干活”：当前环境级指令确有委派场景指导，但不是所有简单任务强制委派；后续应补齐与独立插件一致的执行边界。

## 当前证据

- 当前规范：../../../openspec/specs/auto-model-routing/spec.md，固定主模型、共享四档 rubric、childRoutes 与派发规则。
- 默认主模型起点与偏移：../src/effort.ts；Claude 子表 Haiku/Sonnet/Opus/Opus；GPT 子表 Luna/Sol/Sol/Sol。
- 子工具：../src/subagent-tool.ts，单独判断子任务；指定模型时只调 effort；校验目录与允许列表。
- 包内指导：../skills/subagent-model-routing/SKILL.md，主要约束选模、调用与复用；是否派发的场景主要位于 ../../../instructions/dsh-home.md。历史提交 14d68627（2026-10-22）已明确加入较大编码、独立复核、大量探索、可并行工作的派发规则，以及小修复/讨论不派发；这确认用户记忆中的委派要求确实曾落地，但不是所有简单任务强制派发。
- 来源与评估范围：../eval/README.md，现有回归是判档一致性，不是最终任务质量/速度/费用基准。

## Gap 与建议（待调研校准，不是实施授权）

| Gap | 影响 | 建议与验证 |
|---|---|---|
| 同一难度标签同时决定模型能力档与effort | simple 可能同时降到小模型与低effort，不能由“强模型轻松做”推导“小模型低预算可靠做” | 保留轻量worker；分开能力适配与推理预算，以所选模型官方起点为基线，再验证偏移；不急于增加第二次网络判档 |
| 固定model被误当作缓存保持保证 | Claude顶层effort可能影响前缀，省下输出费用但新增缓存写入 | 检查当前Claude/GPT适配器与官方文档；记录cache read/write和总延迟；比较稳定effort与逐轮effort策略 |
| 缺少是否值得委派的成本边界 | 一行任务派发可能比主模型直接做更慢更贵 | 主Agent依据任务独立性、工作量、移交成本与可验证性决定派发；不要“simple必委派” |
| 独立插件与个人环境指导不完全相同 | 安装工具/skill不保证强主轻子的工作方式真正执行 | 明确包内最小派发/复核指导及尽力而为边界，真实Host验证，不宣称强制拦截 |
| 缺少结果验收与质量失败升级闭环 | 弱配置可能持续重试，最终成本反增 | 区分工具/网络故障与推理失败；定义验收、有限重试与能力升级策略，尊重用户固定模型约束 |
| 官方推荐与经验配置边界不清 | 默认表随模型更新失效，用户误以为有官方保障 | 维护版本化来源、适用任务、支持effort、推荐起点；将自行推导明确标注为待评估预设 |
| 没有端到端收益证据 | 分类准确不等于任务成功或省钱 | 同任务比较固定高配置、固定推荐配置、当前AUTO及候选AUTO；记录独立通过率、全链路耗时/费用与重试次数 |

## 优先级

1. 核验缓存语义与官方模型使用建议（先防止优化方向相反）。
2. 明确模型能力适配与effort预算分离；保留强主轻子目标。
3. 补齐委派→执行→验收→必要升级的边界。
4. 用端到端评估选策略，而不是仅凭判档准确率。

## 已独立核验的缓存证据

- [OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching.md)（2026-10-24读取）：request-level reasoning.effort 可以改变模型侧指令；支持的 GPT-6+ 模型通过追加 configuration_update 并保持顶层原值来保留早先前缀。这是 API 能力，不证明当前 DSH/订阅适配器已支持。
- [Magpie rules.go](https://github.com/yetone/magpie/blob/main/internal/gateway/rules.go)（2026-10-24读取 main，可变引用）：同回合保持决策；keepsEffort 在缓存仍暖时阻止降 effort，但允许升档，缓存过冷或上下文缩小至一半以下时允许降档；区分 Pick 与 Wanted，注释说明支持 effort updates 的路径可使用 Wanted。项目注释中的缓存命中观测是上游自述，不是本项目复现结果。它是可借鉴的缓存策略，不能直接抄作所有 provider 的普遍规律。Sol 后续对固定提交 f3eb92924e56605860f6a85a3449247c26c0bd90 的检查指出，effort_update.go 的更新通路为 MAGPIE_EFFORT_UPDATES=on 显式启用的 preview，默认关闭，限 GPT-6/OpenAI或ChatGPT账户/Responses；不能将源码出现 takesEffortUpdates 解读为所有部署默认具备缓存保持能力。

## 官方强主轻子的适用边界

[Anthropic 多智能体研究系统](https://www.anthropic.com/research/multi-agent-research-system)（2026-10-24全文读取）描述 Opus 4 lead + Sonnet 4 workers，在其内部研究评估优于单 Opus 4；这是特定研究系统结果，不是本项目收益证明，也不是所有 coding 都适合多agent的结论。文章强调并行独立方向、上下文压缩、清晰任务边界与最终结果评估；同时指出多agent显著增加token，编码任务往往比研究更难并行。应采用其编排与验收原则，不直接复制旧代模型组合或收益百分比。

## 外部调研

已由 gpt-6.1-sol/high 完成官方指引、维护/热度较高社区路由与 yetone/magpie 策略调研，主会话复核了OpenAI缓存、Anthropic研究编排、LiteLLM评估与Magpie更新路径。详见 [调研记录](routing-community-research-2026-10-24.md)。结果区分官方文档、代码事实、项目自述与未经复现的效果声明；热度不等于效果，不把调研建议直接写为现行spec。
