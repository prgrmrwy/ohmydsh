## Test Plan

独立评审 round 4 为 APPROVE。以下测试尚未实现；🔴 red 是实施起点，不声称已经运行失败。每项须先看到正确原因的失败，再实现。

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| specs/case-verify-evidence/spec.md → checking 目录布局与格式识别 | 新格式目录被接受 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_001` | 🟢 green |
| specs/case-verify-evidence/spec.md → checking 目录布局与格式识别 | 旧格式目录被拒绝 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_002` | 🟢 green |
| specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结 | 首次片段校验不依赖冻结 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_003` | 🟢 green |
| specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结 | 冻结后记录哈希 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_004` | 🟢 green |
| specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结 | 冻结后被修改 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_005` | 🟢 green |
| specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结 | 重新冻结使当前计划失效 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_006` | 🟢 green |
| specs/case-verify-evidence/spec.md → oracle 经用户确认后冻结 | 非法 oracle | `skills/case-verify/tests/test_model_gates.py` | `test_cv_007` | 🟢 green |
| specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle | 合法追溯 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_008` | 🟢 green |
| specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle | 引用不存在的 oracle | `skills/case-verify/tests/test_model_gates.py` | `test_cv_009` | 🟢 green |
| specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle | oracle 来源却没有挂载 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_010` | 🟢 green |
| specs/case-verify-evidence/spec.md → 计划与 trail 只描述待验内容并追溯 oracle | 计划中残留执行结果 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_011` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | 确认齐备后可以记录观察 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_012` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | 未确认计划时不能记录观察 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_013` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | 策略不可用时不能确认 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_014` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | 仅修改 plan 的执行字段也会失效 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_015` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | 外部报告 URL 更新不影响确认 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_016` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | 同内容重新确认也必须重跑 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_017` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | 重挂 oracle 后旧通过不可继承 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_018` | 🟢 green |
| specs/case-verify-evidence/spec.md → 流程确认点以可校验记录落盘 | derived 断言变化后必须重跑 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_019` | 🟢 green |
| specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入 | 追加保留已有内容 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_020` | 🟢 green |
| specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入 | 并发追加 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_021` | 🟢 green |
| specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入 | 迟到旧 worker 结果被拒绝 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_022` | 🟢 green |
| specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入 | 新 revision 真正重跑成功 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_023` | 🟢 green |
| specs/case-verify-evidence/spec.md → 观察记录只经追加脚本写入 | 非法记录不写入 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_024` | 🟢 green |
| specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录 | 带截图的通过 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_025` | 🟢 green |
| specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录 | 工具返回成功但没有证据 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_026` | 🟢 green |
| specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录 | 已引用的证据被覆盖 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_027` | 🟢 green |
| specs/case-verify-evidence/spec.md → 证据有类型、有范围且限定在 evidence 目录 | 证据路径越界 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_028` | 🟢 green |
| specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成 | 事后纠偏 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_029` | 🟢 green |
| specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成 | 非法纠偏 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_030` | 🟢 green |
| specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成 | 竞争纠偏只有一个成功 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_031` | 🟢 green |
| specs/case-verify-evidence/spec.md → 纠偏只能通过追加 supersede 记录完成 | 非法 revision 被拒绝 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_032` | 🟢 green |
| specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算 | 多环境下的保守计算 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_033` | 🟢 green |
| specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算 | 局部复测不能抹掉另一环境的失败 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_034` | 🟢 green |
| specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算 | 复测解除失败 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_035` | 🟢 green |
| specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算 | 续跑范围 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_036` | 🟢 green |
| specs/case-verify-evidence/spec.md → 状态、统计与续跑范围由观察记录计算 | 手改统计被发现 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_037` | 🟢 green |
| specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口 | 合法目录通过 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_038` | 🟢 green |
| specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口 | 列出覆盖缺口 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_039` | 🟢 green |
| specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口 | 未验证期望计入通过 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_040` | 🟢 green |
| specs/case-verify-evidence/spec.md → 执行门禁保留原规则并检查覆盖缺口 | 报告缺少新章节 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_041` | 🟢 green |
| specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变 | mock 未确认被拦截 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_042` | 🟢 green |
| specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变 | presence-only 点击被拦截 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_043` | 🟢 green |
| specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变 | 合法计划通过两个门禁 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_044` | 🟢 green |
| specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变 | checkpoint mock 缺口不能被 trail 决定掩盖 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_045` | 🟢 green |
| specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变 | 缺失文本命中与未命中 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_046` | 🟢 green |
| specs/case-verify-evidence/spec.md → mock 与 trail 门禁规则在 JSON 模型上保持不变 | 受限状态如实通过结构门禁 | `skills/case-verify/tests/test_model_gates.py` | `test_cv_047` | 🟢 green |
| specs/case-verify-skill/spec.md → skill 由 manifest 登记并只经 sync 部署 | 启用后部署且幂等 | `tests/case-verify.test.mjs` | `test_cv_048` | 🟢 green |
| specs/case-verify-skill/spec.md → skill 由 manifest 登记并只经 sync 部署 | 禁用后移除 | `tests/case-verify.test.mjs` | `test_cv_049` | 🟢 green |
| specs/case-verify-skill/spec.md → 公开 skill 不含组织专属值 | 主机名白名单通过 | `tests/case-verify.test.mjs` | `test_cv_050` | 🟢 green |
| specs/case-verify-skill/spec.md → 公开 skill 不含组织专属值 | 混入内部域名被拦截 | `tests/case-verify.test.mjs` | `test_cv_051` | 🟢 green |
| specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现 | 匹配唯一 adapter | `skills/case-verify/tests/test_adapters.py` | `test_cv_052` | 🟢 green |
| specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现 | 无匹配或多重匹配 | `skills/case-verify/tests/test_adapters.py` | `test_cv_053` | 🟢 green |
| specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现 | 名称不安全或重名 | `skills/case-verify/tests/test_adapters.py` | `test_cv_054` | 🟢 green |
| specs/case-verify-skill/spec.md → adapter 通过环境变量确定性发现 | 描述非法的候选 | `skills/case-verify/tests/test_adapters.py` | `test_cv_055` | 🟢 green |
| specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1 | 合法片段进入合并 | `skills/case-verify/tests/test_adapters.py` | `test_cv_056` | 🟢 green |
| specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1 | 声明为 spec 的来源不被升级 | `skills/case-verify/tests/test_adapters.py` | `test_cv_057` | 🟢 green |
| specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1 | 多次拉取互不覆盖 | `skills/case-verify/tests/test_adapters.py` | `test_cv_058` | 🟢 green |
| specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1 | 片段非法时停止 | `skills/case-verify/tests/test_adapters.py` | `test_cv_059` | 🟢 green |
| specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1 | adapter 执行失败 | `skills/case-verify/tests/test_adapters.py` | `test_cv_060` | 🟢 green |
| specs/case-verify-skill/spec.md → oracle-source adapter 的输出经校验后才能进入阶段 1 | 没有可用 adapter | `skills/case-verify/tests/test_adapters.py` | `test_cv_061` | 🟢 green |
| specs/case-verify-skill/spec.md → report-sink adapter 只在报告门禁通过后推送 | 首次推送记录地址 | `skills/case-verify/tests/test_adapters.py` | `test_cv_062` | 🟢 green |
| specs/case-verify-skill/spec.md → report-sink adapter 只在报告门禁通过后推送 | 报告无效时不调用推送 | `skills/case-verify/tests/test_adapters.py` | `test_cv_063` | 🟢 green |
| specs/case-verify-skill/spec.md → report-sink adapter 只在报告门禁通过后推送 | 推送失败不影响本地结论 | `skills/case-verify/tests/test_adapters.py` | `test_cv_064` | 🟢 green |
| specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试 | 仓库测试运行 skill 测试 | `tests/case-verify.test.mjs` | `test_cv_065` | 🟢 green |
| specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试 | 缺少合适的 Python | `tests/case-verify.test.mjs` | `test_cv_066` | 🟢 green |
| specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试 | Python 用例失败 | `tests/case-verify.test.mjs` | `test_cv_067` | 🟢 green |
| specs/case-verify-skill/spec.md → 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试 | 不引入第三方模块 | `tests/case-verify.test.mjs` | `test_cv_068` | 🟢 green |
| specs/case-verify-skill/spec.md → 真实验收数据默认不入库 | 拦截真实数据及归档副本 | `tests/tracked-artifacts.test.mjs` | `test_cv_069` | 🟢 green |
| specs/case-verify-skill/spec.md → 真实验收数据默认不入库 | fixture 与脱敏报告不触发新增规则 | `tests/tracked-artifacts.test.mjs` | `test_cv_070` | 🟢 green |

## Coverage Notes

- 覆盖 17 个 requirement、70 个 scenario，每个场景恰好一个命名测试。测试名的序号与 tasks 序号稳定对应；可增加更细的参数化子用例。
- Python 测试只依赖标准库；Node 包装 Python 与隔离 sync；无真实平台/凭据/用例或截图进入 fixture。
- confirm/freeze/append 使用临时目录与并发进程；revision fence 测试显式模拟旧 worker 延迟提交，同内容重确认后仍拒绝。按 scenario 的 THEN 比对退出码、日志原字节、revision、状态和调用次数。
- 推送测试使用记录调用次数的本地假 adapter，缺报告/缺章节/错摘要一律零调用；合法报告才推送。外部 URL 更新不影响确认哈希。
- R4 S1 补充回归：env 非版本键集合不同拒绝、精确复用接受；两观察共享一个不可变证据；cp automation full/partial × mock missing/unknown，决定缺失拒绝、齐备接受。补充原门禁四例以及 consequence、implementation/unverified、IME、surface、available/evidence 的正反例，不只依靠 stderr 关键词。
- 制品检查用路径列表及 git check-ignore 临时 fixture，覆盖 plan/trails/gates、archive 深度和旧 docs 白名单叠加；只允许脱敏 report/summary 并不验证内容已安全。
- Python 缺失/低版本的 skip 测试是对包装器的主动故障注入；正式实施验收环境必须装有 Python 3.9+，完整测试运行不得实际跳过核心用例。
- 报告摘要测试对标记区逐字比对；当前状态只读取当前 plan_rev，历史已移除 checkpoint 不套当前定义。
- 私有 adapter 的实际迁移和内部关键词扫描需要在私有仓完成，不把内部关键词或数据写入本 change；不声称本测试替代真实内部 adapter 的验收。
