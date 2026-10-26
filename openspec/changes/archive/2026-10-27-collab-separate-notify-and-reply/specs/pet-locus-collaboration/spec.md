## ADDED Requirements

### Requirement: 代理协作消息以通知意图登记

Pet 协作代理 SHALL 按有效通知意图（notify 缺省时兼容 needsReply）识别发给 pet 的通知消息，保留现有 ref、戳与点名路由规则。notify:true、needsReply:false 的结果 SHALL 登记为通知来源；notify:false 的消息即使需要回复也 MUST NOT 因同批其它通知被顺带登记。此登记 MUST NOT 自行恢复子会话或创建执行回合。

#### Scenario: 通知与回复分别处理
- **WHEN** 主会话向 pet 发 notify:false、needsReply:true 的消息，再发 notify:true、needsReply:false 的消息
- **THEN** 代理只登记后者并按现有规则路由，前者不被后一次指针追扫登记；不新增子会话执行
