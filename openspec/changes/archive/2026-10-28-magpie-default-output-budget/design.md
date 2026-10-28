## Context

- `src/host/catalog.ts:18–19`：`max_output_tokens` 直接映射为 `info.defaultMaxTokens`。
- `src/host/adapter.ts:167`：交给 pi-ai 的 `model.maxTokens` 取 `info.defaultMaxTokens ?? 16384`；`adapter.ts:182–183` 只把 `options.maxTokens` 原样转给 pi-ai。
- DSH 宿主补齐默认值：`@deepseek-ai/dsh-llm` `resolveCallWithInfo`（仓库 `node_modules/@deepseek-ai/dsh-llm/lib/index.js:2169–2173`）在 `config.maxTokens` 缺失时取 `info.defaultMaxTokens`；非 prepared 调用在派发前同样补齐（`2291–2308`）。线上 launcher 解析到的 compat llm 包行为相同（`compat-packages/llm/lib/index.js:2175–2179`、`2297–2314`）。所以线上请求**一直带着**输出上限：现状是 Astra/Luna 128,000、MiniMax 512,000。只有绕过 llm 服务、直接调用适配器（例如现有 `test/generate.test.ts`）才没有补齐。
- pi-ai 0.87：Chat（`openai-completions.js:587`）与 Responses（`openai-responses.js:230`）只在 `options.maxTokens` 为真值时写输出上限字段；Responses 会把小于 16 的值提到 16。
- compaction-basic（`lib/index.js:15–17、124–134、757–758`）：预留 = 会话 `config.maxTokens ?? defaultMaxTokens ?? 0`；压力预算 = 窗口 − 预留 − `headroomTokens`（默认 65536），≤ 0 时抛配置错误；阈值 = `floor(min(窗口 × 0.8, 压力预算))`；默认保留量 = `floor((窗口 − 预留) × 0.16)`，不小于阈值时同样抛配置错误。
- Magpie（commit `98e23350f14bfa63adc43c54271fb8fecb4fce5c`）：`/models` 只发布 `max_output_tokens` = `OutputWithin(window, output)`，即不超过窗口（`internal/gateway/gateway.go:1003–1004`、`internal/provider/models.go:2860–2869`）；“管理员手动设置 Max output”的 `OutputSet` 标记是 `json:"-"`，不出现在 `/models`（`internal/provider/models.go:2410`、`internal/catalog/catalog.go:68`）。
- 在线网关（2026-10-28 只读 `GET /models`）：13 个模型中 3 个受影响（GPT-6 Astra/Luna 阈值 78,464 → 136,000；MiniMax M3.1 Flash 422,464 → 500,000），其余不变。最小窗口为 272,000。

## Goals / Non-Goals

**Goals:**
- `defaultMaxTokens` 给 DSH 留出压缩空间，复用 Magpie `dshMaxTokens` 在“未手动设置 Max output”时的公式。
- 交给 pi-ai 的模型输出上限保持网关声明的最大输出能力。

**Non-Goals:**
- 不改请求补齐路径：宿主已经补齐，适配器不重复补齐。直调适配器时不写默认值的现状保持不变。
- 不读取宿主的 compaction 配置，不跟随用户自定义的 `headroomTokens`、`thresholdRatio`、`retainRatio`。
- 不复刻 Magpie 对手动 Max output 的例外（`/models` 拿不到该标记）。
- 不改变 pi-ai Responses 将有效请求 `maxTokens` 1–15 提到 16 的既有行为；有效值可以来自调用方显式值，也可以来自宿主补齐的默认预算。适配器仅原样传给 pi-ai，不保证该区间线协议值与本地预留严格相等（Chat 原样发送）。
- 不改设置页展示，不新增用户可配的预算或窗口选项（subscriptions 那样的按模型窗口设置留作独立需求）。

## Decisions

1. **在 `mapCatalog` 中计算预算，并在 `CatalogModel` 上新增 `outputLimit` 保留能力值。**
   `listModels`/`resolveModel`/`prepareCall` 都从同一份目录取 `info`，宿主补齐和 compaction 读的也是 `resolveModel`/`prepareCall` 给出的 `defaultMaxTokens`，只在目录一处计算就能保证一致；`withDefaultEffort` 不受影响。
   - 拒绝方案“在适配器里按需计算”：会产生第二个真相源。
   - 不把 SDK `model.maxTokens` 也改成预算：当前 `provider.stream` 路径下显式 `maxTokens` 不受 `model.maxTokens` 封顶，改小不会立即出错；保留 O 是为了让能力语义正确，避免将来走到会按模型上限封顶的 pi-ai 路径时，把预算误当能力。

2. **压缩余量写死为 65536，代码注释写明来源和复核点。**（用户 2026-10-28 确认）
   与 Magpie `dshHeadroom` 和 compaction-basic 默认 `headroomTokens` 一致。读宿主配置会让插件耦合宿主内部实现。

3. **不在适配器补齐默认预算。**（用户 2026-10-28 确认，依据评审 M1）
   宿主已经做了；在适配器重复补齐只会多出 Responses 最小 16、显式值优先级等需要另行规定的边界。

4. **只承诺 C ≥ 104026 时通过宿主两项压缩检查；以下仍按公式计算、不拒绝。**（用户确认，依据评审 C1/M2）
   记 P 为压力预算、T 为阈值、R 为保留量、S = C − B。C ≥ 262144 时 `B ≤ floor(C/2) − 65536`，所以 `P ≥ ceil(C/2)`、`T ≥ floor(C/2)`；同时 `R ≤ floor(0.16 × C) < floor(C/2)`，故 R < T（与 O 无关，B 变小时 S 变大，但 R 的上界只依赖 C）。104026 ≤ C < 262144 时最坏预算为 `floor(C/4)`；`R < T` 等价于同时满足 `R < floor(0.8 × C)` 与 `R < S − 65536`，前者由 `R ≤ floor(0.16 × C)` 保证，后者对整数 S 等价于 `0.84 × S > 65536`，最小 S 为 78020。B 越大 S 越小，所以最大 B 是最坏情况；C = 104025 时最坏 S = 78019，C = 104026 时为 78020，之后最坏 S 单调不减。因此无需枚举所有 O。窗口 ≤ 65537 时任何正整数预算都不可能通过，因此不承诺“始终有效”。窗口以下不拒绝模型，是为了与现状和 Magpie 一致：宿主在那种情况下本来就会报错，插件不额外制造失败。
   - 拒绝方案“小窗口不下发预算”：宿主预留变为 0，阈值变大，但请求不再带上限，上游按自身默认输出，溢出风险反而无人预留。

5. **Magpie 手动 Max output 例外：作为有意差异记录。**（用户确认，依据评审 M5）
   `/models` 不暴露 `OutputSet`，连接器无法区分；一律收紧比一律放过更符合本 change 的目的（避免过早压缩），代价是管理员手动放大的输出上限在 DSH 默认路径下不会全部生效，可用会话显式 `maxTokens` 绕过。

6. **跨层验证用不变量测试（方案 A），不运行宿主 compaction 插件。**（用户确认）
   断言两项检查（压力预算 > 0、保留量 < 阈值），覆盖适用边界两侧、在线实测容量和改前失败组合。`resolveCompactSpec` 不是公开导出，搭建 agent/session 替身成本高。

## Risks / Trade-offs

- [宿主升级后 compaction 默认值改变或用户自定义] → 不变量测试仍会通过，但实际阈值会偏离；在常量注释和 dsh.yaml note 中写明“DSH 升级时复核 compaction-basic 默认 headroomTokens/thresholdRatio/retainRatio”。
- [经宿主发出的默认输出上限变小] → MiniMax M3.1 Flash 512,000 → 434,464；若出现 `max-tokens` 结束，可用显式 `maxTokens` 绕过。GPT-6 Astra/Luna 128,000 → 70,464，但 Magpie（同上 commit，`internal/provider/codex_request.go:264–265`）对 Codex 上游删除输出上限字段；以该 commit 的对应 Codex 路径为条件，实际生成不受影响，70,464 只是本地预留值，不是真实硬上限。在线 Magpie 版本与实际路由路径未验证。
- [只有 O 没有 C 的模型] → 仍按 O 预留，与现状一致。
- [与 dsh-plugin-subscriptions 0.9.10 不同] → 它不按公式预留：Codex 固定 `defaultMaxTokens` 128,000 且不发输出上限字段，另提供按模型的 `contextWindows` 设置；Claude 取 `min(配置 ?? 发布上限 ?? 32000, 发布上限)`；Grok/Copilot 只发显式值。272k Codex 模型在它那里同样只有 78,464 的压力预算，没有可直接照搬的解法。

## Migration Plan

1. 实现并通过包内 typecheck/test/build。
2. 插件版本 0.1.1 → 0.1.2，更新 `dsh.yaml` 条目版本与 note、CHANGELOG、README 输出预算说明。
3. `dsh build`，连续第二次无变化；由用户决定重启 DSH。
4. 重启后再次只读查询 `/models`，并确认受影响模型 `resolveModel` 的 `defaultMaxTokens`。
5. 回滚：回退本 change 的提交 → `dsh build` → 重启；无持久数据迁移。

## Open Questions

- 真实生成冒烟：在确认在线 Codex 路径确实删除输出上限字段后，`opencode-go/minimax-m3.1-flash` 是三个受影响模型中唯一预期在上游保留收紧字段的对象；否则先核验在线部署与路由，不排除 Codex 模型。是否执行、何时执行需用户同意，会消耗少量额度。
