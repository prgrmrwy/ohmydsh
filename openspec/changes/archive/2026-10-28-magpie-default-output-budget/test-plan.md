## Test Plan

测试位于 `packages/dsh-magpie-connector/test/`，用包内 `vitest`。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 模型目录字段映射 | 字段映射 | test/catalog-mapping.test.ts | `spec Scenario "字段映射"` | 🟢 existing（回归保护，行为不变） |
| specs/dsh-magpie-connector/spec.md → 模型目录字段映射 | 畸形条目被丢弃 | test/catalog-mapping.test.ts | `spec Scenario "畸形条目被丢弃"` | 🟢 existing（回归保护，行为不变） |
| specs/dsh-magpie-connector/spec.md → 模型目录字段映射 | 非法容量值视为缺失 | test/catalog-mapping.test.ts | `spec Scenario "非法容量值视为缺失"` | 🟢 characterization（现有校验已满足，见注 2） |
| specs/dsh-magpie-connector/spec.md → 默认请求输出预算 | 大输出模型为压缩保留空间 | test/output-budget.test.ts | `spec Scenario "大输出模型为压缩保留空间"` | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 默认请求输出预算 | 小窗口按四分之一窗口预留 | test/output-budget.test.ts | `spec Scenario "小窗口按四分之一窗口预留"` | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 默认请求输出预算 | 输出能力不超过预算时保持不变 | test/output-budget.test.ts | `spec Scenario "输出能力不超过预算时保持不变"` | 🟢 characterization（预算等于 O，见注 2） |
| specs/dsh-magpie-connector/spec.md → 默认请求输出预算 | 网关侧手动设置的输出上限同样收紧 | test/output-budget.test.ts | `spec Scenario "网关侧手动设置的输出上限同样收紧"` | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 默认请求输出预算 | 缺少上下文窗口时不收紧 | test/output-budget.test.ts | `spec Scenario "缺少上下文窗口时不收紧"` | 🟢 characterization（见注 2） |
| specs/dsh-magpie-connector/spec.md → 默认请求输出预算 | 缺少最大输出能力时不下发预算 | test/output-budget.test.ts | `spec Scenario "缺少最大输出能力时不下发预算"` | 🟢 characterization（见注 2） |
| specs/dsh-magpie-connector/spec.md → 默认预算在适用窗口内通过宿主压缩检查 | 适用窗口内满足宿主两项压缩检查 | test/output-budget.test.ts | `spec Scenario "适用窗口内满足宿主两项压缩检查"` | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 默认预算在适用窗口内通过宿主压缩检查 | 适用窗口以下不保证通过 | test/output-budget.test.ts | `spec Scenario "适用窗口以下不保证通过"` | 🟢 green |
| specs/dsh-magpie-connector/spec.md → SDK 模型输出上限使用最大输出能力 | SDK 模型上限为最大输出能力 | test/output-budget-wire.test.ts | `spec Scenario "SDK 模型上限为最大输出能力"` | 🟢 green（预算落地后曾红，能力分离后转绿，见注 3） |
| specs/dsh-magpie-connector/spec.md → SDK 模型输出上限使用最大输出能力 | 没有最大输出能力时使用回退值 | test/output-budget-wire.test.ts | `spec Scenario "没有最大输出能力时使用回退值"` | 🟢 characterization（见注 2） |

## Coverage Notes

1. **宿主压缩检查的计算**：`test/output-budget.test.ts` 内写一个只用于断言的小函数，按 compaction-basic 0.2.0-rc.2 默认值（headroom 65536、thresholdRatio 0.8、retainRatio 0.16）算压力预算、阈值、保留量。不 import 宿主包（`resolveCompactSpec` 未导出）。函数旁注明来源文件与行号，作为 DSH 升级时的复核点。
2. **characterization 行**：这些场景描述的是本 change 必须保留的现状，现在就会通过，没有“先红”的可能。它们防止实现预算时误改缺字段分支或非法值处理。不为了让它们先失败而人为写错断言。
3. **SDK 模型参数截获**：用 `vi.mock('@earendil-works/pi-ai', …)` 包装 `createProvider`，记录 `provider.stream` 收到的 `model.maxTokens`，其余透传真实实现；HTTP 字段用现有网关 mock（`test/support/gateway.ts`、`wire.ts`）断言。实施顺序上，先写这条测试（当前通过，因为现在 `defaultMaxTokens` 就等于 O），再落地预算计算，此时它应**因为 `model.maxTokens` 变成 184464 而失败**，最后加 `outputLimit` 使其恢复。这是本行“红”的正确理由。
4. **额外测试（不需要映射，来自第二轮评审 S3/S4）**：
   - 单侧非法容量：`{context_window: "1000", max_output_tokens: 4096}` → 无 `context`、B = 4096、SDK 上限 4096；`{context_window: 500000, max_output_tokens: 0}` → 保留 `context`、无 `defaultMaxTokens`、SDK 上限 16384。
   - 边界两侧的 O 再各加一组 O = C（与 Magpie 发布值 O ≤ C 的真实边界一致）。
   - 直调适配器：有 O、有 B、不指定 `maxTokens` 时，两协议 HTTP 仍不含输出上限字段（确认没有重新引入适配器补齐）；没有 O、显式 `maxTokens: 100` 时，SDK 上限 16384、两协议 HTTP 字段为 100。
   - 宿主补齐路径：若能以合理成本构造 `@deepseek-ai/dsh-llm` 服务驱动适配器，断言不指定 `maxTokens` 时两协议 HTTP 字段为 B；成本过高则在 verify 中如实记为未覆盖，并以 `resolveModel` 的 `defaultMaxTokens` + 宿主 `resolveCallWithInfo`（`dsh-llm/lib/index.js:2169–2173`）的源码依据代替。
