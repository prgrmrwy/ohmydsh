# Product positioning / 产品定位

Confirmed direction: 2026-11-19. This document guides feature design and review; it does not claim that every presentation described below is implemented. Current behavior is documented in the README and implementation specifications.

## English

**Make Magpie's capabilities easy to understand and use from DSH. Magpie owns account pools and routing strategies; this plugin consumes and presents the gateway's capabilities.**

| Surface | User question | Responsibility |
|---|---|---|
| Usage panels | What resources remain, and which accounts need attention? | Present gateway-reported usage, balances, reset times and errors clearly. Account cards are not model-selection entries. |
| Settings | Which gateway entries do I want available in DSH, and with which defaults? | Configure the connection and DSH-side preferences such as visibility and default reasoning effort. |
| Model picker | Which model or routing entry should this conversation use? | Let users select an existing gateway entry with a recognizable name and meaning. |
| Magpie | How are accounts pooled and requests routed? | Own account login, pool management, group creation, strategy configuration, weights and upstream failover. |

A concrete model entry and a routing entry are both valid ways to consume Magpie. Selecting a concrete model does not necessarily select an account: Magpie may still choose an account from its pool. Selecting an automatic or custom routing entry sends the gateway's entry ID; it does not send a strategy authored by this plugin. Two Codex accounts can therefore appear as two usage cards while sharing one model-picker provider group.

Design principles:

- Use the gateway's catalog, names and advertised capabilities as the source of truth. Preserve entry IDs on requests; do not replace a routing entry with a guessed underlying model or account.
- Settings and the picker should describe the same entries with consistent names and type semantics. Their layouts need not be identical.
- Account-level usage and model/routing selection answer different questions. Do not force a one-to-one mapping or create account-specific picker entries just because multiple accounts exist.
- Keep account-pool and routing-policy editors in Magpie. Gateway connection selection in this plugin chooses how to reach Magpie, not which upstream account Magpie should use.
- Presentation changes must account for saved selections and preferences. A DSH provider route is an identity, not merely a heading; changing it requires an explicit compatibility or migration design.
- Existing explicit actions such as quota refresh and confirmed Codex reset remain separate gateway operations. This positioning neither removes them nor authorizes additional account-management features.

The classification rules, labels, dedicated picker sections and any route migration proposed around [PR #10](https://github.com/prgrmrwy/dsh-magpie-connector/pull/10) and [PR #11](https://github.com/prgrmrwy/dsh-magpie-connector/pull/11) remain implementation decisions for joint discussion. This document approves neither PR as written and does not select an A/B implementation proposal.

## 中文

**让用户在 DSH 中更清楚、更方便地使用 Magpie 的能力。Magpie 管理账号池和路由策略，插件负责消费并呈现网关能力。**

| 界面 | 回答的问题 | 职责 |
|---|---|---|
| 额度面板 | 资源还剩多少，哪些账号需要关注？ | 清楚展示网关提供的用量、余额、重置时间和异常；账号卡不等于模型选择入口。 |
| 设置页 | 哪些网关入口在 DSH 中可选，默认怎样调用？ | 配置网关连接，以及可见性、默认推理强度等 DSH 侧使用偏好。 |
| picker | 这次会话使用哪个模型或路由入口？ | 让用户辨认并选择网关已经提供的入口。 |
| Magpie 本体 | 账号如何组成池，请求如何分配？ | 负责账号登录、账号池、路由组创建、策略配置、权重和上游故障切换。 |

具体模型入口与路由入口都是插件应消费的能力。选择具体模型不等于指定账号，Magpie 仍可从账号池中分配。选择自动路由或自定义路由组，是发送网关已有的入口 ID，不是在插件里编写并提交策略。因此，两个 Codex 账号可以显示两张额度卡，同时共用一个模型选择器分组。

设计原则：

- 以网关目录、名称和声明的能力为依据；请求保留原始入口 ID，不将路由入口擅自替换为猜测的底层模型或账号。
- 设置页和 picker 对同一入口使用一致的名称和类型含义，布局不必完全相同。
- 账号用量与模型／路由选择回答不同问题，不强行一一对应，也不因为有多个账号就生成多个账号专属 picker 入口。
- 账号池和路由策略编辑留在 Magpie。插件的连接线路选择解决“怎样连接网关”，不决定网关使用哪个上游账号。
- 展示调整必须考虑已有会话选择和偏好。DSH provider route 是身份，不只是标题；修改它需要明确的兼容或迁移设计。
- 已有的额度刷新、确认后使用 Codex 重置卡等显式操作仍是独立的网关操作。这份定位不移除它们，也不自动授权扩展账号管理功能。

围绕 [PR #10](https://github.com/prgrmrwy/dsh-magpie-connector/pull/10) 和 [PR #11](https://github.com/prgrmrwy/dsh-magpie-connector/pull/11) 的具体分类规则、文案、picker 独立分组和 route 迁移仍待共同讨论。本文确认产品定位，不代表批准按现状合并两个 PR，也不代表已选择 A/B 实现方案。
