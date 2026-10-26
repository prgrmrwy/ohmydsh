## Decisions
固定服务映射endpoint+model+credential ref，System One兼容body保持state/questions/answers。Concentrate用/v1/systemone避开2026-10-26 decisions格式切换。自定义完整HTTPS endpoint（回环可HTTP），禁止URL凭据/query/hash/redirect；专用key，不复用其它服务key。每次调用快照服务配置、固定引用、请求结果关联服务，切换不把旧key发新host。

设置新增服务商、模型及自定义URL，key RPC显式provider，编辑provider后key状态清空并要求重新读取该服务元数据。现有{value}兼容OpenRouter，不根据未保存草稿隐式换key。凭据仍官方服务；不进配置或日志。

PolicyResult保留各维度confidence/probabilities、ms、decisionProvider/model；主runtime/state与child持久record携带结果。tooltip始终可读最近结果，提示开关仅控制toast；请求头匹配后才applied。无置信度写未提供，不能等同任务成功率。只保存最小判定信息不存原文。
