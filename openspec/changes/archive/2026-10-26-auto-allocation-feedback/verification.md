# 验证
2026-10-25：205测试、typecheck、build及严格OpenSpec/diff检查通过。已managed dsh build物化，服务端需重启加载，本次不冒称现网消息已验证。

正式Host集成用生成的真实assistant/message ID验证：applied主决策可读反馈，修改并插件重启后仍可读；MANUAL下一消息返回空。Book单测覆盖修改、撤销、无绑定拒绝与非法闭集；React DOM覆盖四项菜单、撤销及失败不乐观更新。legacy测试保持通过。

后续生产只读核实：用户点击appropriate反馈已落盘，对应lower/low，证明真实UI到持久化链路；本期新增评估snapshot及独立feedback事件后206测试通过、typecheck/build通过。旧记录继续可读，未伪造历史快照。snapshot requestSeq在正式宿主集成验证为真实事件seq；新增服务端需重启加载，新增字段尚未生产实测。确定度文案解释Choice公式。采集口径详见package docs/feedback-evaluation.md。

只记录主投入反馈，不做子能力评价、不自动训练或换模重试。不回填升级前没有绑定元数据的消息；不会从最新状态猜旧消息。未提交或推送。
