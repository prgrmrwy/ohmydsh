# Jev policy-v2 验证（2026-10-24）

## 结论

官方接口和真实 `typesafe/jev-1.13` 均支持一次请求中独立返回 capability 与 depth。10 次合成任务请求全部返回合法的双 Choice；预先定义的 development / holdout 各 5 例均符合预期，不调整 rubric、不重试。**这只证明接口与小样本分类，不证明实际子模型质量、成本收益或默认推广条件。**

- [官方教程](https://openrouter.ai/docs/guides/community/jev-tutorial.md)：多个问题并行作答，不能读取彼此答案。
- [官方 API schema](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md)：questions 为命名问题映射，answers 同键返回。
- [价格入口](https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints)：验证时 input US$0.042 / million tokens，output 0；请求显式 max_price + 禁止 fallback。
- 模型仍固定 `typesafe/jev-1.13`；文档虽然已有 1.14，本次不擅自升级。

## 实测

用户授权上限：20 次、输入每次 ≤8192 bytes、US$0.10。实际 10 次，总 input 8194 tokens，**US$0.000344148**；单次 493–1036 ms。真实 snapshot 为 `typesafe/jev-1.13-20260917`。

| 样例 | split | capability | depth |
|---|---|---|---|
| dev-bulk | development | bounded | baseline |
| dev-risk | development | bounded | baseline |
| dev-debug | development | analytical | baseline |
| dev-proof | development | frontier | higher |
| dev-missing | development | insufficient_context | baseline |
| hold-extract | holdout | bounded | lower |
| hold-batch | holdout | bounded | baseline |
| hold-tradeoff | holdout | analytical | baseline |
| hold-constraints | holdout | frontier | higher |
| hold-unknown | holdout | insufficient_context | baseline |

[测试输入及独立预期](../eval/policy-v2-cases.json)、[问题定义](../src/policy-v2-rubric.json)、[有预算保护的实测脚本](../eval/policy-v2-live.mjs)。depth 从同一任务证据独立判断相对适配模型的推荐投入，不引用另一个尚未返回的 capability 答案。两者都指定时不判；只指定一个维度时仅询问另一个。

实测脚本先保留每次费用预算再请求，失败也计一次；预留每次 65536 input tokens 远高于合成输入。未知 usage.cost 停止，不记零。尚有 10 次授权余量，不默认消耗，也不因生成一个新结果文件就获得新预算。跨多次运行的全局预算需由执行者核对，脚本不是账户级额度控制。

## 实施映射起点

版本 `capability-slots-1`：Claude bounded/analytical/frontier = Haiku/Sonnet/Opus 5.5；Codex = Luna/Sol/Sol（目前目录只有两种已选能力模型，不伪造第三种）。推荐 effort 复用当前 [官方起点表](../src/effort.ts#L7-L16)，Claude 三模型 medium、Luna high、Sol medium。depth 只按支持序列移动一档，automatic 不使用 max；显式值仍校验目录、允许列表与上限，失效报错不替换。

这份映射是初始试验基线，不声称已经独立证明各子模型是最优能力槽。未进行实际子模型调用或端到端任务保留集对照；其成本、质量与返工收益均未知。
