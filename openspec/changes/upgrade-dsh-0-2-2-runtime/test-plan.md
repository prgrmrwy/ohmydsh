## Test Plan

<!-- LIVE LEDGER: during apply, flip each row 🔴 red → 🟢 green as its test passes. verify blocks on any row left red. -->
<!-- Generated from every `#### Scenario:` in specs/ (72 scenarios); regenerate if specs change. -->

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 同次主请求同步官方 effort 与 defaults | packages/dsh-auto-model-routing/test/selection.integration.test.ts | spec Scenario "同次主请求同步官方 effort 与 defaults" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 同步失败不丢本次请求 | packages/dsh-auto-model-routing/test/selection.integration.test.ts | spec Scenario "同步失败不丢本次请求" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 手动与子请求不污染默认 | packages/dsh-auto-model-routing/test/selection.integration.test.ts | spec Scenario "手动与子请求不污染默认" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 异步解析期间切 MANUAL 不覆盖主请求 | packages/dsh-auto-model-routing/test/selection.integration.test.ts | spec Scenario "异步解析期间切 MANUAL 不覆盖主请求" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | MANUAL 请求原样通过 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "MANUAL 请求原样通过" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 只改 effort | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "AUTO 只改 effort" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 切回 MANUAL 不复原 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "切回 MANUAL 不复原" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 结果同步到官方选择 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "AUTO 结果同步到官方选择" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 判档覆盖待生效手选 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "AUTO 判档覆盖待生效手选" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 快速切回 AUTO 不恢复旧决定 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "快速切回 AUTO 不恢复旧决定" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 重复同模式设置无副作用 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "重复同模式设置无副作用" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 旧状态文件可读 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "旧状态文件可读" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 新会话按默认模式创建 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "新会话按默认模式创建" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 修改默认模式不影响已有会话 | packages/dsh-auto-model-routing/test/host.integration.test.ts | spec Scenario "修改默认模式不影响已有会话" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 步骤被拒时不请求 Jev | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "步骤被拒时不请求 Jev" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 首轮真实领取序列只取用户消息 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "首轮真实领取序列只取用户消息" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 多条用户消息按序拼接并截断 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "多条用户消息按序拼接并截断" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 同回合与重试复用决定 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "同回合与重试复用决定" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 非用户回合沿用上一 depth | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "非用户回合沿用上一 depth" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 子会话不走主会话判断 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "子会话不走主会话判断" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | Magpie 自动子路由 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "Magpie 自动子路由" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | 未登记 provider 的 GPT 主会话可以派子任务 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "未登记 provider 的 GPT 主会话可以派子任务" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | 子路由在 step 1 生效且不写默认 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "子路由在 step 1 生效且不写默认" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | 官方参数校验失败的创建不请求 Jev | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "官方参数校验失败的创建不请求 Jev" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | created 等待 Jev 期间取消创建 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "created 等待 Jev 期间取消创建" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | 从 0.2.1 中断状态恢复的子会话补写 route | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "从 0.2.1 中断状态恢复的子会话补写 route" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 能力槽可用时按能力选模 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "能力槽可用时按能力选模" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | provider 没有能力槽模型时保持父模型 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "provider 没有能力槽模型时保持父模型" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 父模型不在允许列表时不改写 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "父模型不在允许列表时不改写" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | depth effort 不可得时用父会话 effort | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "depth effort 不可得时用父会话 effort" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 父会话 effort 也不可用时不改写并告警 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "父会话 effort 也不可用时不改写并告警" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 子任务 Jev 失败不改写 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "子任务 Jev 失败不改写" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 显式维度不可用时不替换 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "显式维度不可用时不替换" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 只显式 effort 时能力槽须支持该 effort | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "只显式 effort 时能力槽须支持该 effort" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 不改写的记录在重启后不重判 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "不改写的记录在重启后不重判" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 矛盾的记录组合被拒绝 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "矛盾的记录组合被拒绝" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 冷恢复时初始决策中断 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "冷恢复时初始决策中断" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 已有 route 实时门禁失败仍拒绝 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "已有 route 实时门禁失败仍拒绝" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 子判断期间模式往返使旧结果失效 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "子判断期间模式往返使旧结果失效" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 同一步重试前门禁失效 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "同一步重试前门禁失效" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 请求内容受限 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "请求内容受限" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 上一轮上下文截断、取末段并脱敏 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "上一轮上下文截断、取末段并脱敏" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 脱敏覆盖常见形态且不误伤正文 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "脱敏覆盖常见形态且不误伤正文" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 首个用户回合不带上一轮上下文 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "首个用户回合不带上一轮上下文" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 启用 execution 的预设加入固定行 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "启用 execution 的预设加入固定行" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 自主主任务不被断言为逐条复核 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "自主主任务不被断言为逐条复核" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 设置中的未知预设回落到缺省预设 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "设置中的未知预设回落到缺省预设" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 等待期间切换模式丢弃结果 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "等待期间切换模式丢弃结果" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 不跟随重定向 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "不跟随重定向" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 源码不含本地分类与其它出站 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "源码不含本地分类与其它出站" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 凭据从存储读取且换 key 立即生效 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "凭据从存储读取且换 key 立即生效" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 期限按设置生效 | packages/dsh-auto-model-routing/test/jev.test.ts | spec Scenario "期限按设置生效" | 🔴 red |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 主判断进行中切换预设 | packages/dsh-auto-model-routing/test/preset-sampling.integration.test.ts | spec Scenario "主判断进行中切换预设" | 🔴 red |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 子任务在创建后、首次判断前切换预设 | packages/dsh-auto-model-routing/test/preset-sampling.integration.test.ts | spec Scenario "子任务在创建后、首次判断前切换预设" | 🔴 red |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 预览进行中切换预设 | packages/dsh-auto-model-routing/test/preset-sampling.integration.test.ts | spec Scenario "预览进行中切换预设" | 🔴 red |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 预览与 fresh 子任务独立采样 | packages/dsh-auto-model-routing/test/preset-sampling.integration.test.ts | spec Scenario "预览与 fresh 子任务独立采样" | 🔴 red |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 非用户回合不重判 | packages/dsh-auto-model-routing/test/preset-sampling.integration.test.ts | spec Scenario "非用户回合不重判" | 🔴 red |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 测试连接使用所选预设 | packages/dsh-auto-model-routing/test/preset-sampling.integration.test.ts | spec Scenario "测试连接使用所选预设" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 主会话判断提示 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "主会话判断提示" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 决策提示标记所用判档预设 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "决策提示标记所用判档预设" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 子任务判断提示 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "子任务判断提示" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 主决策在请求前后的状态 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "主决策在请求前后的状态" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 完全显式的子任务决策可见 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "完全显式的子任务决策可见" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 开关关闭或判断失败不提示 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "开关关闭或判断失败不提示" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 提示只显示一次且 3 秒消失 | packages/dsh-auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "提示只显示一次且 3 秒消失" | 🔴 red |
| specs/auto-model-routing/spec.md → 本步选择改写依赖运行体核验 | 目标运行体上 step 1 即用新 effort | packages/dsh-auto-model-routing/test/runtime-selection.e2e.test.ts | spec Scenario "目标运行体上 step 1 即用新 effort" | 🔴 red |
| specs/auto-model-routing/spec.md → 本步选择改写依赖运行体核验 | 选择对象被冻结时退回下一步生效 | packages/dsh-auto-model-routing/test/runtime-selection.e2e.test.ts | spec Scenario "选择对象被冻结时退回下一步生效" | 🔴 red |
| specs/auto-model-routing/spec.md → 本步选择改写依赖运行体核验 | 运行体改为传递副本时测试失败 | packages/dsh-auto-model-routing/test/runtime-selection.e2e.test.ts | spec Scenario "运行体改为传递副本时测试失败" | 🔴 red |
| specs/fs-observation-policy/spec.md → 部署面显式启用官方文件观察策略 | 启用后有效配置含策略行且未禁用 | tests/fs-observation-policy.test.mjs | spec Scenario "启用后有效配置含策略行且未禁用" | 🔴 red |
| specs/fs-observation-policy/spec.md → 部署面显式启用官方文件观察策略 | 未读先改被拒绝 | tests/fs-observation-policy-runtime.test.mjs | spec Scenario "未读先改被拒绝" | 🔴 red |
| specs/fs-observation-policy/spec.md → 部署面显式启用官方文件观察策略 | 读后被外部修改再编辑被拒绝 | tests/fs-observation-policy-runtime.test.mjs | spec Scenario "读后被外部修改再编辑被拒绝" | 🔴 red |
| specs/fs-observation-policy/spec.md → 部署面显式启用官方文件观察策略 | 禁用后恢复官方默认 | tests/fs-observation-policy.test.mjs | spec Scenario "禁用后恢复官方默认" | 🔴 red |

## Coverage Notes

- **测试命名**：沿用本仓 `spec Scenario "<场景名>"` 的命名约定，一个场景对应一个具名 test；参数化与内部单元测试可以额外添加，不进本表。
- **保留场景也标 red**：MODIFIED requirement 中原样保留的场景已有测试，但运行体升到 0.2.2 后，旧的 `agent/request` 改写路径会抛错，这些测试必须先在目标运行体上失败，再随实现转绿；已有测试改名或断言调整（例如 `policy-host.integration.test.ts:401-409` 的阶段断言，以及原来断言 `agent/request` 改写的用例）都在对应行转绿前完成。
- **真实运行体测试**：「本步选择改写依赖运行体核验」的三个场景放在新的 `runtime-selection.e2e.test.ts` 中，使用 `dshVersion` 精确版本的真实 `@deepseek-ai/dsh-agent-loop`（以及 dsh-agent、dsh-llm），只替换模型 adapter 与持久化端口；第 4、5 轮评审的内存探针（ReactLoopAgent、AgentLoop.initializeAgent + SubagentManager）作为参考实现。子会话 created/resume 与重试门禁场景（「子路由在 step 1 生效且不写默认」「created 等待 Jev 期间取消创建」「从 0.2.1 中断状态恢复的子会话补写 route」「同一步重试前门禁失效」「官方参数校验失败的创建不请求 Jev」）同样须在真实 loop + subagent 链路上断言，不能只用 harness 假 agent；它们落在 policy-host.integration.test.ts，必要时引入同一套真实运行体夹具。
- **fs-observation-policy**：`tests/fs-observation-policy.test.mjs` 在隔离 `DSH_HOME` 中跑 sync，并用目标运行体 `--dump-config` 断言有效配置（启用恰一行、二次 sync 无变化、禁用后恢复官方默认）；`tests/fs-observation-policy-runtime.test.mjs` 在进程内组合官方 `dsh-fs-observation-policy` 与 `dsh-tool-fs`，断言 `FS_NOT_OBSERVED` / `FS_STALE_VERSION`。两者都是可执行测试，没有 N/A 行。
- **本表之外的验收门禁**（不是场景，但属于 tasks）：现役基线、隔离预览分组验收、devbox 清洁构建 gate、真实数据副本的备份与恢复演练、memex 裁判启用 Team 时的成功路径（D4）、dsh-pet 工具读回与 sidebar 异步 register（D8）、根 `engines.node` 的 bootstrap 测试（D7）。
