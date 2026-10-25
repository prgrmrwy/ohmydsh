## Decisions
主session request/header精确匹配后记录请求对应decision快照；assistant/message按同session最近实际header绑定，不取根latest（可能已是子决策）。新用户回合/MANUAL/失败/不支持必须清空候选，避免串轮。独立FeedbackBook append-only JSONL记录message绑定及修改/撤销，重启回读；不存文本/key，损坏行忽略且无绑定不显示。复用label RPC，带feedback闭集或null，与legacy label互斥。UI同一官方图标/Menu，失败可见不乐观修改；旧tier反馈继续原路径。
