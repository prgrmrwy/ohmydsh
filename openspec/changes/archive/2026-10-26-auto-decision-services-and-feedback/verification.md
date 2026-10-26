# 实施与验证

2026-10-25：已实现OpenRouter/TypeSafe/Concentrate/自定义System One服务选择、固定版本模型、独立key引用；保留现有OpenRouter默认。修改服务草稿时清空key草稿并禁用管理，保存后读取新服务状态。自定义限HTTPS/回环HTTP，无URL凭据/query/hash，拒绝redirect，不自动换服务。自定义端点由用户信任，修改端点应先确认专用key适用；不宣称任意聊天模型兼容。

已恢复新策略主/子维度置信度、耗时、决策服务模型及请求匹配状态，tooltip不受toast开关影响。原始任务与key不写入决策记录。子记录含置信度可冷恢复；主状态仍是运行期状态，重启后下一回合重建，不虚构历史。未提供置信度显示未提供。

## 实测
- package typecheck、全量vitest、build通过；fake传输验证异步key解析期间配置切换不混key、各preset独立引用、451不回退。
- 子任务正式宿主集成测试：两维不同置信度、已应用、持久恢复且不存原文。
- 已通过managed dsh build部署，并重启原3080服务。
- 现有3080真实GUI：四种服务选项、固定模型、切TypeSafe草稿key禁用且提示先保存、custom空端点无效；关闭重开后仍OpenRouter且保存按钮禁用，无现役配置变更。
- GUI点击固定公开样例测试：真实OpenRouter成功，1032ms；浏览器无错误。
- Tooltip新状态通过真实React DOM测试；本次没有发送会话消息触发新的实际执行模型，故不将DOM fixture结果称作真实生成端到端验收。

## 分布展示修正
用户指出只有置信度百分比不足以感知分布。现补齐两维完整候选分布：能力按bounded/analytical/frontier/insufficient_context，投入按lower/baseline/higher排序，保留返回的0%，未返回分布显示未提供，不从置信度推算。共用toastText保证tooltip/toast一致。200测试/typecheck/build通过，managed build已部署，现有GUI刷新无错误；本次仅客户端变化无需重启。

## 限制
TypeSafe/Concentrate未用真实凭据发请求，仅官方协议与mock契约验证。TypeSafe可能有地区限制。没有跨服务性能/质量对照；无自动fallback。未发布、未推送；本地自审，不声称独立评审。
