# auto-model-routing

主会话 AUTO 每个用户回合请求一次 Jev（经 OpenRouter decisions 接口，`typesafe/jev-1.13`，3 秒期限、不重试）得出四级档位，只调整 reasoning effort，保留官方 provider/model；切 MANUAL 后复原锚点 effort，覆盖旧快照的重试，直到持久请求头与官方合成都收敛。Jev 任何失败（余额不足、凭据无效、限流、地区受限、超时等）立即把会话停用为 MANUAL 并在芯片上显示原因，直到用户重新点 AUTO；不使用本地规则或通用模型降级，不主动查询余额。

子会话通过 Host 工具 `route_subagent` 复用同一 Jev 判断，返回显式 provider/model/reasoning_effort；工具失败时 skill 要求主 Agent 暂停委派并询问用户。

状态：2026-10-20 按用户要求修订（替换本地规则分类器，见 `spike-jev-openrouter.md`）。proposal/design/spec 已更新；第 5 轮批准（review.md）针对旧范围，**已失效，须完整重审**。tasks.md、test-plan.md、implementation-review.md、verification-progress.md、verify.md 记录的是首版（`13f1587b`，本地规则）的实施与验收，仅作历史参考；重审通过后重写 tasks/test-plan，不可据其实施。
