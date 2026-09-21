## MODIFIED Requirements

### Requirement: Worktree Session remains in the source Workspace
系统 SHALL 在源 Workspace 的空白 Session 中完成 Worktree 启动，而不得为新启动流程注册第二个 Workspace 或创建第二个 Session。准备成功后，首条消息 SHALL 通过原 Session 的官方提交路径发送，Session 的 Workspace 归属 SHALL 保持不变。

首条消息 SHALL 将发送时已确认可用的完整草稿载荷作为一个原子交接单元处理，包括文本以及运行体支持的图片、普通文件或其它 generic attachments。插件 SHALL 冻结并转交官方 draft attachment identifiers，准备成功后只调用一次官方 submit；attempt 身份、上传恢复、echo retirement 与失败时保留草稿 SHALL 由目标运行体公开的官方 attachment/input 生命周期承担。插件 MUST NOT 创建第二套跨重试 operation/upload 确认协议。准备或官方提交失败时不得丢失附件、重复提交或降级到主 checkout。

#### Scenario: Successful in-place Worktree start
- **WHEN** 用户在源 Workspace 的空白 Session 选择 base、启用 Worktree 并发送首条消息
- **THEN** 系统创建独立 task branch 和 worktree，将当前 Session 绑定到该 worktree，并在同一 Session 中只提交一次首条消息及其全部附件
- **THEN** DSH Workspace 列表不新增该 worktree 对应的顶层 Workspace

#### Scenario: Worktree preparation fails before submission
- **WHEN** branch、worktree、依赖或环境准备任一步骤失败
- **THEN** 系统不得发送首条消息、不得把消息降级到主 checkout，并 SHALL 让官方 input 生命周期保留文本和全部附件供用户重试

#### Scenario: Attachment upload fails during first submission
- **WHEN** Worktree 已准备成功但任一 generic attachment 在官方提交生命周期中上传或解析失败
- **THEN** 官方 input 生命周期 SHALL 保留 draft 与 attachments 供用户重试，插件不得自行重传、追踪部分确认或创建第二个 worktree

#### Scenario: Mixed attachment first submission succeeds
- **WHEN** 首条消息同时包含文本、图片和普通文件且 Worktree 准备与官方提交均成功
- **THEN** 同一 Session SHALL 恰好收到一次完整提交，每个附件恰好关联一次且顺序和用户选择一致

#### Scenario: Worktree mode is disabled
- **WHEN** 用户未启用 Worktree 并发送消息
- **THEN** 系统 SHALL 完全沿用普通 Session 的 generic attachment 提交行为且不得创建或绑定 worktree