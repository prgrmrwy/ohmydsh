## 1. 回归基线与 characterization 测试

- [x] 1.1 运行包内 `npm test`，记录基线全绿
- [x] 1.2 在 `test/catalog-mapping.test.ts` 新增「非法容量值视为缺失」，在 `test/output-budget.test.ts` 新增「输出能力不超过预算时保持不变」「缺少上下文窗口时不收紧」「缺少最大输出能力时不下发预算」；确认均通过（现状行为，见 test-plan 注 2）
- [x] 1.3 新增 `test/output-budget-wire.test.ts`：「SDK 模型上限为最大输出能力」「没有最大输出能力时使用回退值」，含 pi-ai `createProvider` 截获；确认当前均通过（见 test-plan 注 3）

## 2. 默认请求输出预算

- [x] 2.1 Write failing test: `test/output-budget.test.ts` 的「大输出模型为压缩保留空间」「小窗口按四分之一窗口预留」「网关侧手动设置的输出上限同样收紧」（断言失败原因应是 `defaultMaxTokens` 仍等于 O）
- [x] 2.2 Implement: `src/host/catalog.ts` 按公式计算 `defaultMaxTokens`，65536 写成具名常量并注明来源（compaction-basic 默认 `headroomTokens`、Magpie `dshHeadroom`）与 DSH 升级复核点；pass 2.1
- [x] 2.3 确认 1.3 的「SDK 模型上限为最大输出能力」此时**因 `model.maxTokens` 变为 184464 而失败**（预期的红）
- [x] 2.4 Refactor; full suite stays green（除 2.3 预期失败项）

## 3. 能力分离

- [x] 3.1 Implement: `CatalogModel` 新增 `outputLimit`，`src/host/adapter.ts` 交给 pi-ai 的 `model.maxTokens` 改为 `entry.outputLimit ?? 16384`；`prepareCall` 的未知模型回退条目同步；pass 2.3
- [x] 3.2 Refactor; full suite stays green

## 4. 宿主压缩检查不变量

- [x] 4.1 Write failing test: 「适用窗口内满足宿主两项压缩检查」「适用窗口以下不保证通过」，含注明来源的宿主默认值计算函数（test-plan 注 1）。注：2.2 已实现公式，若此时直接通过，先临时回退 2.2 的公式确认测试会因 (524288, 524288)/(131072, 65536) 等组合失败，再恢复
- [x] 4.2 Implement: 无需新增产品代码（由 2.2 满足）；pass 4.1
- [x] 4.3 Refactor; full suite stays green

## 5. 额外测试（test-plan 注 4）

- [x] 5.1 单侧非法容量、O = C 边界组合
- [x] 5.2 直调适配器不补齐、无 O + 显式 100 两协议断言
- [x] 5.3 评估宿主 llm 服务驱动的补齐路径测试成本；可行则实现，否则在 verify 中记为未覆盖并给出源码依据

## 6. 文档、版本与部署

- [x] 6.1 `packages/dsh-magpie-connector`：版本 0.1.1 → 0.1.2，CHANGELOG 记录行为变化与受影响模型，README（中英）补充默认输出预算说明
- [x] 6.2 `dsh.yaml` 条目 version 与 note 同步（含“DSH 升级复核 compaction-basic 默认值”）
- [x] 6.3 包内 `npm run typecheck`、`npm test`、`npm run build`；仓库 `npm test`、`npm run check:artifacts`
- [x] 6.4 `openspec validate magpie-default-output-budget --strict`
- [x] 6.5 `dsh build`，连续第二次无变化；询问用户是否重启 DSH（不自行重启）
- [x] 6.6 重启后只读查询 `/models`，确认三个受影响模型的 `defaultMaxTokens` 为 70464 / 70464 / 434464；真实生成冒烟按 design Open Questions 另行征得同意
