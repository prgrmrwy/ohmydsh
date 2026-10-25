## Why
新AUTO未写入旧四档JudgementBook，消息末尾人工反馈入口消失。需要恢复对实际投入的评价，而非恢复旧tier菜单。
## What Changes
复用回复动作图标，为已应用主决策提供合适/偏高/不足/无法判断及撤销；精确message/request绑定，记录最小元数据，不自动训练/调策略/重试。legacy入口不变。
## Capabilities
### New Capabilities
- `auto-allocation-feedback`: 消息末尾分配反馈。
## Impact
仅auto-model-routing主反馈存储、label RPC与UI及测试；不改子能力反馈、不上传、不发布。
