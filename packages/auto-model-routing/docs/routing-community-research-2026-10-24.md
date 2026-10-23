# AUTO routing 外部方案调研（2026-10-24）

状态：只读调研，未采纳实现；主会话复核 + gpt-6.1-sol/high 子智能体调研。核心诉求见 routing-intent-and-gaps.md。

## 先分清三类自动路由

1. 服务网关选模型/供应商：对请求做能力与价格路由，可能改变主模型，不天然符合本项目主模型固定的不变量。
2. 固定模型调推理预算：最接近本项目主会话，但需处理缓存前缀、模型支持与同回合稳定性。
3. 编排层委派：决定是否派发、任务边界、worker能力与预算、验收升级；网关分类器无法代替主Agent完成这些决策。

## 已复核的一手证据

### Anthropic：强主轻子的生产案例，但不保证省token

来源：https://www.anthropic.com/research/multi-agent-research-system

官方研究系统使用 Opus 4 lead + Sonnet 4 workers；适合多条独立方向的并行研究与上下文压缩，强调任务目标/输出格式/边界/工具指导，以及按最终成果评估。不能将该内部研究评估的收益直接推广到所有编码任务；多agent会增加token消耗，只有收益足够时才值得。

Anthropic platform effort/caching文档本次直接抓取存在地区跳转限制。仓库 eval/README.md 的2026-10-21/22来源摘要是历史依据，不能冒充本次全文复核。

### OpenAI：effort不是无缓存代价的开关

来源：https://developers.openai.com/api/docs/guides/prompt-caching.md

官方说明 reasoning.effort 可改变隐藏模型指令；支持GPT-6+模型可以追加 configuration_update、保持顶层原值，以保存既有前缀。是否适用于DSH订阅适配器需单独检查实际协议，不能从API文档直接推断。

### LiteLLM：分类 + 运行约束 + 影子评估

来源：https://docs.litellm.ai/docs/auto_router
来源：https://docs.litellm.ai/docs/auto_router/evaluate

当前已经有 Auto Router add-on，不能再将LiteLLM仅归为负载均衡。最值得借鉴的是 shadow evaluation：同输入复制请求、盲评实际输出、对比多个策略；官方明确指出 tier标签匹配不等于选中模型答得好。

费用核算包括classifier与下游费用，记录fallback和p95；继续回合的对照费用应采用暖缓存，切换后新增cache write应扣除。其按最昂贵配置估算的savings仍是反事实估计，不能等同本项目实测节约。

### Magpie：回合稳定、缓存迟滞、可选effort更新

项目确认为 https://github.com/yetone/magpie ，不是同名数据集或仅DSH连接器。

固定代码：https://github.com/yetone/magpie/tree/f3eb92924e56605860f6a85a3449247c26c0bd90

- internal/gateway/rules.go：用户回合开始决策，工具结果继续沿用；上下文超过模型能力等例外另处理。缓存仍暖时保留更高effort，不因新一轮简单就立刻降档；冷却或上下文显著缩短时才允许降低。
- Pick/Wanted区分实际保留档位与新判断期望，方便展示“推荐值≠生效值”。
- internal/gateway/effort_update.go：MAGPIE_EFFORT_UPDATES=on的preview才启用，默认关闭；限GPT-6、Responses、OpenAI/ChatGPT账户，并排除某些服务端历史管理/自动截断路径。
- 超过初始base的升档重设顶层effort；注释声称configuration_update升到高档时实际推理不足。这是上游实测自述，非官方保证，也未由本项目复现。
- 保存每个thread/account/model的更新位置并重放；历史不匹配、compact或重启可能导致重新缓存。不是只改一个effort字段就能实现。

可借鉴：主会话调effort要有缓存意识；判档值与生效值可分离；缓存更新路径需显式支持与能力验证。不可照搬：默认启用preview、假定跨provider都支持、将所有回合只升不降当作永久最优。

## Sol 补充核验：官方建议

- https://claude.com/resources/articles/claude-model-and-effort-level-in-claude-code ：model是能力边界，effort也影响读文件/工具/核验/坚持程度；从模型默认起，把effort当总体偏好。认真尝试仍错可能需强model，漏读/不测/早退可能需更多effort。
- https://code.claude.com/docs/en/model-config.md ：当前Opus/Sonnet/Haiku5.5默认medium；各模型同名effort不等价。
- https://code.claude.com/docs/en/prompt-caching.md ：多数模型不同effort有独立cache；当前Claude Code在部分模型与直API/订阅组合可保cache，但其他后端、禁beta等不适用。这是client×backend×model组合能力，不自动适用于DSH。
- https://developers.openai.com/api/docs/guides/model-selection.md ：用同输入比较模型和effort，选择达到质量要求的最轻配置。
- https://developers.openai.com/api/docs/guides/reasoning.md ：Sol默认medium，high适合复杂调试，xhigh需eval收益；模型在各effort档内已会根据任务自适应。
- https://learn.chatgpt.com/docs/agent-configuration/subagents.md ：主线程管需求/决策/最终交付，子线程做噪音探索并摘要；Sol适合歧义多步，Luna适合窄且可重复任务，显式Luna起high/Astra起low；子agent不是必定更弱。

## 社区策略与维护快照

2026-10-24约02:09–02:15 Asia/Shanghai，Sol读取GitHub REST repo与commits端点。stars仅关注度；last push/commit不等于质量。下表均为当时值。

| 项目 | 关注/维护 | 路由与适用边界 |
|---|---|---|
| [Magpie](https://github.com/yetone/magpie) | 20,159 stars / 1,547 forks，HEAD f3eb929，10/23 18:05Z提交；9/23建仓，活跃但年轻，maintainers-only PR | 最接近本项目的回合判档与effort缓存问题，但网关不负责拆解/验收 |
| [LiteLLM](https://github.com/BerriAI/litellm) | 61,909 / 12,608，HEAD 1e6dc81，10/23 18:11Z提交 | 大平台；Auto Router仍Beta/add-on。四档→模型/pool，可用heuristic/LLM/Jev/local Laya；上下文/模态约束、stall escalation、session pin。平台成熟不证明每个路由策略成熟 |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | 5,633 / 446，HEAD 0b64fda，最后push 2024-08-10 | 强弱两模型win-rate/阈值路由；MF/Elo/BERT等，强调本域校准。影响力研究基线而非持续维护的新模型产品；旧静态benchmark非长程coding证据 |
| [DSH Laya](https://github.com/HapyRain/dsh-router-laya) | 25 / 6，HEAD 29624e7，10/17提交 | 本地约846MB分类器+规则，默认同Flash调low/high/max，同回合锁定；故障回low。标签99%与未公开实验不能当端到端收益 |
| [Neptune810 router](https://github.com/Neptune810/dsh-model-router) | 2 / 3，HEAD 1d1968a，10/04提交 | full/effort/model作用范围，错误/重复升级与降档迟滞；child preferCheap未经质量证明 |
| [thedeveloper256 router](https://github.com/thedeveloper256/dsh-model-router) | 1 / 0，9/20最后push | root planner/child executor角色配置；当前两者默认均Flash，README与旧description不一致；角色分离不等于实际强主轻子 |
| [incrhst router](https://github.com/incrhst/dsh-model-router) | 0 / 0，8/31提交 | size/tool/code/关键词分数阈值切Pro/Flash，图片vision；未见验收闭环 |
| [superboy911 router](https://github.com/superboy911/dsh-model-router) | 4 / 1，9/11最后push | 有序关键词→model+可选effort，无匹配不改；确定规则而非学习型AUTO |

社区DSH路由尚无充分证据表明已形成大规模验证的收敛方案；不能把同名repo混为一个热门项目。

## OpenRouter Auto 现行策略

来源：https://openrouter.ai/docs/guides/routing/routers/auto-router.md （Sol本次读取）

当前是轻classifier分约30任务类→最近7日该类真实aggregate spend share排序→cost_tier区间→allow/exclude/tool/modality/ZDR约束下选模型与fallback。不是旧NotDiamond描述；市场支出份额不等于能力评分，cost_tier不等于reasoning effort，也不是纯价格上限。session stickiness有条件：原模型仍须在新任务top候选中。可借鉴约束和实际模型透明度，不能原样替换固定主模型策略。

## Magpie进一步代码观察

- classify.go/decide.go：普通小模型可intent+effort两个调用并行；Jev可单调用多questions；effort score 0..3映射low/medium/high/xhigh，不同于本项目choice tier再加模型offset。
- 意图normalized confidence门槛0.4；level低confidence保前级；结果10分钟缓存与inflight合并，失败rest30秒，可保持前intent。
- 当前上下文含最新请求前3000+后1000runes、前轮user/reply各1000，不含工具结果/推理。
- https://usemagpie.ai/docs/intent 标记v0.1.99，仍写只看最新消息/不支持group classifier，与固定提交当前代码不同；不能只读旧文档。
- smart/order/rotate/usage/pace大量处理账户可用性与额度，不应统称质量最优路由。

## 对本项目的建议顺序

1. **P0 缓存与结果基线**：固定主模型+官方默认effort，与主effort-only、child-model-only、child-effort-only、联合AUTO对照。按窄实现/探索/debug/跨系统设计分层，以独立测试与最终结果为准，计父子/分类/验收/重试/cache总费用、端到端与p95。不要只评tier。
2. **P1 分离能力与预算**：保留强主轻子；主模型负责规划验收，子模型按任务能力和可验证性选，不因是child就便宜。小模型先用推荐effort起点测，不能未经验证再次降档。
3. **P1 缓存感知调节**：核验当前DSH实际wire能力，再选择逐轮更新/较稳定默认/自然任务边界/冷却或compact后的降档迟滞；不照搬Magpie五分钟。
4. **P2 验收与升级**：能力失败与429/timeout分开；根据失败原因补上下文/加effort/换model，设上限与停止条件。现有Jev失败退出AUTO/暂停委派契约不能静默换成low fallback。
5. **P2 可观测与影子对照**：展示判档与生效配置、缓存/费用/升级原因；真实shadow output有对照价值但额外花钱，推荐值或理论估费不等实际效果。

未安装外部项目、未执行付费基准、未更改运行配置。以上外部收益数字均未独立复现；实施仍需单独确认规范与验收条件。
