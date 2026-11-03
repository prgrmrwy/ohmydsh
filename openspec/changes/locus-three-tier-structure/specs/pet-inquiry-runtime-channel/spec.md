## REMOVED Requirements

### Requirement: 询问接受必须有可用的端到端处理能力
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 持久询问必须实际派发到精确目标的独立轮次
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 答案必须持久关联并续进请求方原工作
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 询问执行和续进不得改变权限或回复归属
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 全链路继承 Host 派生的原工作与询问链
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 运行槽与生命周期在途必须分别判断
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 永久结果处置必须原子关闭询问关联
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 重启与历史询问处置依赖精确证据
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。

### Requirement: 所有者可以核对询问进度而不混用待办台账
**Reason**: 三层结构下询问由 locus 主会话与 dsh-collab 承担：子会话问不出的事登记待办，locus 主会话经 collab 向干活主会话提问、经 `locus_reply_child` 回复子会话；`pet_inquire`/`pet_inquiry_answer` 与 inquiry 子系统整体退役（见 design 决策 11）。
**Migration**: 现存 inquiry 行保留只读、不再写入；升级后进行中的询问不再续进，其记录在管理面标为"已退役"；不再提供询问工具。
