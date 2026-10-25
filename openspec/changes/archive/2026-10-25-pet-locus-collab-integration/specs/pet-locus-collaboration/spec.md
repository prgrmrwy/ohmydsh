## MODIFIED Requirements

### Requirement: 关联具备双向发现且不过度披露

系统 SHALL 从入口查当前 locus/主会话/子会话，从主会话列出全部 locus，从子会话找到唯一 locus。正反向结果 SHALL 同源一致并区分历史和活跃代际。所有者管理面 SHALL 展示来源、群/话题、默认 Q&A、权限、工作根和状态。群内回执 MUST NOT 泄露完整 session ID、其它群 ID 或其它 locus 列表。子会话与主会话之间的协作 SHALL 经该主会话的 Locus 协作空间：子会话以代理成员 `pet` 的身份使用协作工具（`collab_status`、`collab_read`、`collab_create_item`、`collab_revise_item`、`collab_ack_item`、`collab_send_message`、`collab_set_status`、`collab_advance_request`），不提供建空间、邀请与成员管理工具；只读档与 shell 档子会话的协作工具面相同。兄弟子会话 MUST NOT 直接往来：子会话在正常读取中读不到兄弟写的记录，不能向兄弟发消息，也不能修改、确认或推进主会话的条目；需要兄弟上下文时问主会话，由主会话转述。该约束防误泄，不承诺防有意串通。

#### Scenario: 双向核对
- **WHEN** 所有者从研发主会话查看协作入口，再从某入口打开会话
- **THEN** 两个方向指向同一个 locus 与对应主/子会话

#### Scenario: 子会话反查
- **WHEN** 子会话查询自身关联
- **THEN** 只返回自己的 locus，不因共享 parent 获得所有兄弟入口的公开枚举

#### Scenario: 子会话的协作工具面
- **WHEN** 读取只读档与 shell 档子会话的真实工具快照
- **THEN** 两者都恰含上述 8 个协作工具，都不含 `collab_space`、`collab_invite`、`collab_member`；`pet_locus_ledger_read` 不在其中；两份快照中的协作工具名集合相同（shell 档另含其既有 shell 工具）

#### Scenario: 子会话不能向兄弟发消息
- **WHEN** 子会话 A 调用 `collab_send_message`，`to` 为 `pet` 或任何非 `main` 的值
- **THEN** dsh-collab 以 `COLLAB_BAD_RECIPIENT` 拒绝，不调用内核，不产生投递
