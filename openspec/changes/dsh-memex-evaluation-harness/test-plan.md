## Test Plan

评审门禁：第四轮 APPROVE_WITH_CHANGES，Required Changes 已独立复核，CHANGES_APPLIED: yes。表格绿色表示对应具名测试通过，不等于 live 验收完成；2026-10-28 生产补线与真实兼容依赖离线闭环已完成，范围与限制以 tasks.md / verify.md 为准。

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| specs/dsh-memex-evaluation/spec.md → 固定自检范围与风险确认 | 用户确认后运行六个条件 | packages/dsh-memex/test/eval-cli.test.ts | EVAL-001: 用户确认后运行六个条件 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 固定自检范围与风险确认 | 自定义输入被拒绝 | packages/dsh-memex/test/eval-cli.test.ts | EVAL-002: 自定义输入被拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 固定自检范围与风险确认 | 用户取消时无会话 | packages/dsh-memex/test/eval-cli.test.ts | EVAL-003: 用户取消时无会话 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 固定自检范围与风险确认 | 观察到越界访问即污染 | packages/dsh-memex/test/eval-boundary.test.ts, packages/dsh-memex/test/eval-collection.test.ts | EVAL-004: 观察到越界访问即污染 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 固定夹具来源校验与独立物化 | 固定资源成功物化 | packages/dsh-memex/test/eval-fixtures.test.ts | EVAL-005: 固定资源成功物化 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 固定夹具来源校验与独立物化 | 根合法但叶子链接被拒绝 | packages/dsh-memex/test/eval-fixtures.test.ts | EVAL-006: 根合法但叶子链接被拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 固定夹具来源校验与独立物化 | 替换为真实副本被拒绝 | packages/dsh-memex/test/eval-fixtures.test.ts | EVAL-007: 替换为真实副本被拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 固定夹具来源校验与独立物化 | 已有目标不被清理 | packages/dsh-memex/test/eval-fixtures.test.ts | EVAL-008: 已有目标不被清理 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 永久唯一执行路径与路由预检 | 两次尝试路由到不同库 | packages/dsh-memex/test/eval-routing.test.ts | EVAL-009: 两次尝试路由到不同库 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 永久唯一执行路径与路由预检 | personal 可达时拒绝 | packages/dsh-memex/test/eval-routing.test.ts | EVAL-010: personal 可达时拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 永久唯一执行路径与路由预检 | 旧身份不会重新指向新题 | packages/dsh-memex/test/eval-routing.test.ts | EVAL-011: 旧身份不会重新指向新题 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 轮次冻结实际输入 | 原输入删除后仍可复现 | packages/dsh-memex/test/eval-freeze.test.ts | EVAL-012: 原输入删除后仍可复现 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 轮次冻结实际输入 | 冻结数据被改时拒绝续跑 | packages/dsh-memex/test/eval-freeze.test.ts | EVAL-013: 冻结数据被改时拒绝续跑 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 顶层模型配置与委派事后审计 | 默认 AUTO 被显式关闭 | packages/dsh-memex/test/eval-lineage.test.ts | EVAL-014: 默认 AUTO 被显式关闭 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 顶层模型配置与委派事后审计 | 后代走其他模型 | packages/dsh-memex/test/eval-lineage.test.ts | EVAL-015: 后代走其他模型 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 顶层模型配置与委派事后审计 | 后代成本合并不重计继承 | packages/dsh-memex/test/eval-lineage.test.ts | EVAL-016: 后代成本合并不重计继承 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 首次题面前固定标题以关闭辅助请求 | 六条件无标题辅助调用 | packages/dsh-memex/test/eval-title-runtime.test.ts | EVAL-017: 六条件无标题辅助调用 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 首次题面前固定标题以关闭辅助请求 | 固定标题失败不发题 | packages/dsh-memex/test/eval-executor.test.ts, packages/dsh-memex/test/eval-controller.test.ts | EVAL-018: 固定标题失败不发题 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 默认模型副作用披露但不自动恢复 | 检测后只提示不写回 | packages/dsh-memex/test/eval-default-model.test.ts | EVAL-019: 检测后只提示不写回 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 默认模型副作用披露但不自动恢复 | 硬中断下次提醒 | packages/dsh-memex/test/eval-default-model.test.ts | EVAL-020: 硬中断下次提醒 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | 创建响应丢失不重复派发 | packages/dsh-memex/test/eval-lifecycle.test.ts | EVAL-021: 创建响应丢失不重复派发 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | turn-end 但 job 仍运行 | packages/dsh-memex/test/eval-lifecycle.test.ts | EVAL-022: turn-end 但 job 仍运行 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | 后代在 CLI 崩溃前已登记 | packages/dsh-memex/test/eval-lifecycle.test.ts | EVAL-023: 后代在 CLI 崩溃前已登记 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 受限裁判组合和首次请求前门禁 | 裁判成功提交结构化结果 | packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-024: 裁判成功提交结构化结果 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 受限裁判组合和首次请求前门禁 | own subagent 导致首请求前拒绝 | packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-025: own subagent 导致首请求前拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 受限裁判组合和首次请求前门禁 | 证据指令不能扩大能力 | packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-026: 证据指令不能扩大能力 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 受限裁判组合和首次请求前门禁 | 后置装配注入被最终请求门禁拒绝 | packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-027: 后置装配注入被最终请求门禁拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 受限裁判组合和首次请求前门禁 | 持久 lineage 相同但 live owner 错误 | packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-028: 持久 lineage 相同但 live owner 错误 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 受限裁判组合和首次请求前门禁 | 日常会话不受裁判门禁影响 | packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-029: 日常会话不受裁判门禁影响 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → Eval 桥绑定冻结轮次与生命周期 | 冻结项成功评分并清退 | packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-030: 冻结项成功评分并清退 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → Eval 桥绑定冻结轮次与生命周期 | 伪造路线或任意证据被拒绝 | packages/dsh-memex/test/eval-host.test.ts | EVAL-031: 伪造路线或任意证据被拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → Eval 桥绑定冻结轮次与生命周期 | 未鉴权或跨源请求被拒绝 | packages/dsh-memex/test/eval-connection-live.test.ts, packages/dsh-memex/test/eval-connection-runtime.test.ts | EVAL-032: 未鉴权或跨源请求被拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → Eval 桥绑定冻结轮次与生命周期 | 父会话已收到 prompt 被拒绝 | packages/dsh-memex/test/eval-judge-parent.test.ts, packages/dsh-memex/test/eval-judge-runtime.test.ts | EVAL-033: 父会话已收到 prompt 被拒绝 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → Eval 桥绑定冻结轮次与生命周期 | 裁判超时或客户端断开 | packages/dsh-memex/test/eval-host.test.ts | EVAL-034: 裁判超时或客户端断开 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 全文证据、实际阅读覆盖与引文核对 | 成功结果保留全文 | packages/dsh-memex/test/eval-evidence.test.ts | EVAL-035: 成功结果保留全文 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 全文证据、实际阅读覆盖与引文核对 | 日志损坏不判失败 | packages/dsh-memex/test/eval-evidence.test.ts | EVAL-036: 日志损坏不判失败 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 全文证据、实际阅读覆盖与引文核对 | 非空列表含空引文 | packages/dsh-memex/test/eval-evidence.test.ts | EVAL-037: 非空列表含空引文 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 共同终点与可重算的分支漏斗 | Act 跳过 Know 层 | packages/dsh-memex/test/eval-scoring.test.ts | EVAL-038: Act 跳过 Know 层 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 共同终点与可重算的分支漏斗 | 层内 no 优先于 unknown | packages/dsh-memex/test/eval-scoring.test.ts | EVAL-039: 层内 no 优先于 unknown | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 共同终点与可重算的分支漏斗 | 写回不被不适用层挡住 | packages/dsh-memex/test/eval-scoring.test.ts | EVAL-040: 写回不被不适用层挡住 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 按成功写入时序分类 | 先主动后要求不追溯改类 | packages/dsh-memex/test/eval-writeback.test.ts | EVAL-041: 先主动后要求不追溯改类 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 按成功写入时序分类 | 明确要求后未写 | packages/dsh-memex/test/eval-writeback.test.ts | EVAL-042: 明确要求后未写 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 计划预算与保守续跑 | 配对裁判预算不漏计 | packages/dsh-memex/test/eval-plan.test.ts | EVAL-043: 配对裁判预算不漏计 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 计划预算与保守续跑 | 活资源阻止续跑 | packages/dsh-memex/test/eval-plan.test.ts | EVAL-044: 活资源阻止续跑 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 自检报告而非效果排名 | 配对相同保留控制 | packages/dsh-memex/test/eval-report.test.ts | EVAL-045: 配对相同保留控制 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 自检报告而非效果排名 | 全部语义 unknown | packages/dsh-memex/test/eval-report.test.ts | EVAL-046: 全部语义 unknown | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 测试流量登记与消费端排除 | 三消费端排除 | packages/dsh-memex/test/eval-exclusion.test.ts | EVAL-047: 三消费端排除 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 测试流量登记与消费端排除 | 登记损坏使用后备规则 | packages/dsh-memex/test/eval-exclusion.test.ts | EVAL-048: 登记损坏使用后备规则 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 长期方法论保留且纠正迁移声明 | 逐原则保留去向 | packages/dsh-memex/test/eval-methodology.test.ts | EVAL-049: 逐原则保留去向 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 长期方法论保留且纠正迁移声明 | 未迁移原文不被删除 | packages/dsh-memex/test/eval-methodology.test.ts | EVAL-050: 未迁移原文不被删除 | 🟢 green |
| specs/dsh-memex-memory/spec.md → 召回报告为随插件分发的只读命令 | 部署后可在本机运行 | packages/dsh-memex/test/recall-report.test.ts | EVAL-051: 部署后可在本机运行 | 🟢 green |
| specs/dsh-memex-memory/spec.md → 召回报告为随插件分发的只读命令 | 运行不改变任何文件 | packages/dsh-memex/test/recall-report.test.ts | EVAL-052: 运行不改变任何文件 | 🟢 green |
| specs/dsh-memex-memory/spec.md → 召回报告为随插件分发的只读命令 | 跨库命中不被误归属 | packages/dsh-memex/test/recall-report.test.ts | EVAL-053: 跨库命中不被误归属 | 🟢 green |
| specs/dsh-memex-memory/spec.md → 召回报告为随插件分发的只读命令 | 旧记录被计入但不归属 | packages/dsh-memex/test/recall-report.test.ts | EVAL-054: 旧记录被计入但不归属 | 🟢 green |
| specs/dsh-memex-memory/spec.md → 召回报告为随插件分发的只读命令 | 默认排除已登记的测试会话 | packages/dsh-memex/test/recall-report.test.ts | EVAL-055: 默认排除已登记的测试会话 | 🟢 green |
| specs/dsh-memex-memory/spec.md → 召回报告为随插件分发的只读命令 | 登记缺失时按 scope 名排除 | packages/dsh-memex/test/recall-report.test.ts | EVAL-056: 登记缺失时按 scope 名排除 | 🟢 green |

| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | failed 或丢证据不能当资源释放 | packages/dsh-memex/test/eval-release.test.ts | EVAL-057: failed 或丢证据不能当资源释放 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | 归档测试根但不销毁日常对象 | packages/dsh-memex/test/eval-release.test.ts | EVAL-058: 归档测试根但不销毁日常对象 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | 作业按精确 owner 清退 | packages/dsh-memex/test/eval-release.test.ts | EVAL-059: 作业按精确 owner 清退 | 🟢 green |

| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | 后代结算通知在最终清队列时清除 | packages/dsh-memex/test/eval-release.test.ts | EVAL-060: 后代结算通知在最终清队列时清除 | 🟢 green |
| specs/dsh-memex-evaluation/spec.md → 身份先登记与中断保守恢复 | 可信结算记录保留不阻止继续 | packages/dsh-memex/test/eval-release.test.ts | EVAL-061: 可信结算记录保留不阻止继续 | 🟢 green |

## Coverage Notes

- 共 61 个场景，每个具名测试单独映射，不以额外测试替代；现有召回报告场景沿用原验收，新增过滤断言不得删掉原契约。
- 所有测试在 apply 阶段遵循 red→green→refactor。已有原契约测试可能初始已绿：保留回归并为新增路径写会因缺实现而失败的断言，不伪造红灯记录。
- runtime 测试使用与 manifest/compat runtime 一致的真实 Cordis、agent-loop、spawn、tools、标题 provider 和 mock LLM adapter，不把整个跨层链路替换成手写 mock。不得调用远端模型。
- 标题测试共装默认 first-prompt provider，检查测试条件 title=0、日常 title 正常。裁判测试检验最终 request 而非仅传参。
- eval-exclusion 集成测试可调用 tests/weekly-insights.test.mjs 与包装脚本的子进程夹具；不得读取个人真实日志。
- 资源身份测试补充评审 S1：forced-failed job 仍可能孤儿、interrupt accepted 仍有队列时，均不能认作已清退。
- 方法论检查只验证文档原则保留与映射标记，不声称机械检查能证明语义等价。
- 人工 live 六条件自检需后续明确授权；记录实际会话、模型、工具面、日志与默认值告警。此计划通过不代表 live 验收通过。
- 任何测试暴露 spec/API 不可行：暂停对应实现，修订方案并重新评审，不弱化安全断言。
- 2026-10-28 新增 eval-pipeline.test.ts：真实 register/ledger/collection/scoreFrozenItem/offlineReport 六条件串联，固定事件及协议响应（无模型）；验证生产采集字段可读、12 次固定评分、R无召回/W无写入为观测no而非缺证（4 pass/2 fail）、污染落盘可见、无清退证据不宣称已释放。此测试不替代 runtime、认证或完整 runner 接线验收。
- 2026-10-28 追加真实闭环：eval-production-runtime.test.ts（真实compat controller/loop/preset/jobs/workspace/zstd，固定mock adapter）、eval-memex-tools-runtime.test.ts（19真实工具/lifecycle producer contract）、eval-frozen-upgrade.test.ts（7冻结升级/篡改）、eval-managed-resume.test.ts（26同Host续跑及拒绝边界）、eval-tested-budget.test.ts/真实runtime无限工具循环、eval-default-review-entry.test.ts（all-unknown非零/状态/人工确认/续跑CLI）、eval-resume-bridge.test.ts/ eval-run-bridge.test.ts。补充测试只加强已有义务，不替代EVAL-032或live证据。
