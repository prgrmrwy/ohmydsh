## Why

AUTO 的判档规则目前只有一份 `src/rubric.json`，现行 spec 还要求它和改名前的规则文件逐字节相同。所以每读到一篇新的实践调研（例如 Anthropic 2026-09-25 的《Using Claude Code: Spending your effort》），只能二选一：要么覆盖现有规则，要么放弃不用。覆盖之后，用户就无法回到原来的判断方式，两套规则的效果也没法对比。

我们需要的是：每条调研结论都能保存成一份有名字、有来源、内容固定不变的判档预设，由用户自己选用。

## What Changes

- 新增**判档预设**（judgement preset）。它是包内置的命名规则集，每个预设包含：
  - Jev 问题文本 `rubric.json`
  - 元数据：id、中英标题与摘要、来源列表、证据说明
  - 可选的上下文行开关，取值只能来自固定的闭集，目前只有 `execution`
- 预设列表与元数据只写在 `src/presets/index.ts` 的一个带类型常量里。约束由包测试保证，运行时不做会抛错的校验：
  - id 唯一；
  - 判档标签集合必须等于引擎固定的标签集（depth 为 `lower/baseline/higher`，capability 为 `bounded/analytical/frontier/insufficient_context`），且每条 criterion 非空；
  - 上下文开关属于闭集。
- **发布后不可变**：测试以 sha256 锁定每个预设的 `rubric.json` 和上下文开关，`reasoning-depth` 直接复用现有 oracle 哈希。测试只能检测漂移，所以评审规则另写明：既有锁定项只读，只能追加新 id。
- 内置两个预设：
  - `reasoning-depth`（缺省）：现行 `src/rubric.json` 原样迁入，字节不变；`state` 字节不变；行为不变。
  - `effort-as-verification`：按文章结论重写 depth 判断依据，即"effort 管验证与边界情况，不管方法选错"，并启用 `execution` 上下文行。用户需要主动选择才会生效。
- 设置新增普通字段 `preset`，取值为已注册的预设 id，缺省 `reasoning-depth`。未知 id 按"非法普通字段"处理：回落到缺省值，并报告字段问题。设置页新增预设选择；「查看决策策略」改为展示所选预设的元数据、来源和 rubric 原文。
- 每次 Jev 判断（主会话、受管子会话、`route_subagent`、设置页测试连接）开始时只读一次预设，state、questions、结果校验和决策归属都用这一份；判断进行中切换预设不影响本次判断。只有启用了 `execution` 的预设，才在 `state` 中加一行固定文本，只说明调用路径（主会话或委派子任务），不断言有没有人在复核。
- 新写入的反馈绑定快照增加可选字段 `preset`，记录作出该决策时所用的预设 id。旧快照里没有这个字段，按"未知"处理。
- **BREAKING（包内结构与降级可见性）**：删除 `src/rubric.json`，规则文件改为 `src/presets/<id>/rubric.json`，升级不需要任何迁移。降级到 0.6.6 时，`preset` 设置被忽略，下次保存时丢弃；带 `snapshot.preset` 的新绑定会被旧版的严格读取跳过，这些反馈和用量在旧版里看不到。账本不被改写，重新升级后恢复。
- "无策略版本"不变量保持不变：预设是可以同时存在、由用户选择的命名方案，不是版本。预设不自动升级，不新增任何版本键。

## Capabilities

### New Capabilities

（无。预设属于 `auto-model-routing` 能力的一部分。）

### Modified Capabilities

- `auto-model-routing`：
  - 新增「判档预设注册表」「判档预设发布后不可变」「内置判档预设」「判档预设的采样与归属」「判档预设评估脚本」；
  - 修改「无策略版本」：规则文件由单一 `src/rubric.json` 改为不可变预设，迁移时字节等同；
  - 修改「Jev 判断请求与脱敏」：questions 取自所选预设，并增加可选的 `Execution` 行；
  - 修改「自动模型路由设置页」：新增 `preset` 字段与预设选择，策略说明改为展示所选预设；顺带修正期限场景里 6000 被误列为非法值的问题。
- `auto-allocation-feedback`：修改「评估记录可追溯」，新绑定快照增加可选 `preset`。

## Impact

- 代码：`packages/dsh-auto-model-routing/src/`
  - 新增 `presets/`（`index.ts` 与两个预设目录）；
  - 修改 `jev.ts`（`judgePolicy` 显式接收预设，删除 `QUESTIONS`）、`context.ts`（buildState）、`policy-host.ts`（按决策 id 记录预设）、`subagent-tool.ts`、`settings-host.ts`（测试连接）、`settings*.ts`、`feedback.ts`、`client/strategy-details.ts`、`client/settings-section.ts`、`client/locales.ts`（深度相关文案改为中性）。
- 测试：
  - 修改 `test/package-output.test.ts`：sha256 oracle 改为核对 `reasoning-depth/rubric.json`；
  - 新增预设约束与锁定测试、state 构造测试、预设采样测试、设置测试、eval 脚本测试（替换 fetch，不发付费请求）；
  - 修改所有直接 import `src/rubric.json` 的测试。
- 评估：
  - `eval/cases.json` 用 `depthFor` 按预设覆盖期望值，并新增边界情况类用例；
  - `eval/live.mjs` 增加 `--preset` 参数，state 改为复用构建产物里的 `buildState`，报告记录预设和期望值；每次只评一个预设，单次上限 20 次调用、$0.10 不变。重放稳定性检验不在单次运行范围内，真实付费调用仍需用户另行授权。
- 文档：新增 `docs/presets/README.md`（含只能追加的规则）与 `docs/presets/<id>.md`；删除临时草案 `docs/effort-blog-rubric-strategy-draft.md`，其内容并入 `effort-as-verification` 的文档；README 新增预设说明。
- 不受影响：
  - depth 偏移与 cap、家族策略数据（`effortStarts`、`childModels`）、子任务退化链；
  - 状态面板与决策提示的文本；
  - 子会话决策记录格式、用量报告的分组逻辑（按预设分组属于后续工作）。
