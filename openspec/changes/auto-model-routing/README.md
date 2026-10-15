# auto-model-routing

主会话 AUTO 使用同步本地规则只调整 reasoning effort，保留官方 provider/model；切 MANUAL 后复原锚点 effort，覆盖旧快照的重试，直到持久请求头与官方合成都收敛；锚点模型尚未生效则等待，不自行换模型。快速重新 AUTO 不恢复本回合旧决定。芯片位于 GPT 速度芯片左侧，面板展示状态与最近 20 条内存决定。

子会话由 skill 提供档位表，主 Agent 自行判断并通过官方参数创建。不提供路由工具，不改子会话请求。不包含 Jev、任务文本外发、持久决定日志、恢复按钮、运行时全局开关或可插拔分类器。

状态：精简版 proposal/spec/design 已更新；第 4 轮批准已因范围变化失效，须完整重审。现有 test-plan/tasks 是旧范围，重审通过后替换，不可据其实现。
