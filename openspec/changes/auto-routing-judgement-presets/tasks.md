路径都相对于 `packages/dsh-auto-model-routing/`，命令在该目录下运行（另行注明的除外）。WHAT 以 specs 为准，HOW 以 design.md 为准；测试名以 test-plan.md 为准，测试转绿后同步把 test-plan 对应行从 🔴 改为 🟢。

## 0. 基线

- [x] 0.1 在 worktree 内运行 `npm run typecheck && npm test`，记录基线；确认 test-plan 中 18 条 🟢 existing 测试都通过。

## 1. 迁移：`reasoning-depth` 与预设注册表（design D1–D3）

- [x] 1.1 编写失败测试 `spec Scenario "缺省预设与变更前规则逐字节相同"`（test/presets.test.ts）；确认失败原因是 `src/presets/reasoning-depth/rubric.json` 不存在。
- [x] 1.2 实现：`git mv src/rubric.json src/presets/reasoning-depth/rubric.json`，使 1.1 通过。
- [x] 1.3 重构：所有 import（`jev.ts`、`client/strategy-details.ts`、`eval/live.mjs`，以及 4 个测试）改为通过 `src/presets/index.ts` 引用；删除 `QUESTIONS`；全量测试保持通过。
- [x] 1.4 编写失败测试 `spec Scenario "内置预设满足注册表约束"`；这一组先只放 `reasoning-depth`，`effort-as-verification` 的期望留到 2.x 补上。确认失败原因是 `PRESETS` 尚未导出。
- [x] 1.5 实现：`src/presets/index.ts` 中的 `Preset` 类型、`PRESETS`、`DEFAULT_PRESET_ID`、`resolvePreset`，使 1.4 通过。
- [x] 1.6 重构；全量测试保持通过。
- [x] 1.7 编写失败测试 `spec Scenario "约束检查能发现不合格预设"`；确认失败原因是 `presetIssues` 不存在。
- [x] 1.8 实现：纯函数 `presetIssues(list)`，只供测试调用，运行时不调用，使 1.7 通过。
- [x] 1.9 重构；全量测试保持通过。
- [x] 1.10 编写失败测试 `spec Scenario "内置预设与锁定表一致"` 与 `spec Scenario "内容漂移使锁定测试失败"`，常量表放在测试文件内，`reasoning-depth` 引用 oracle；确认失败原因是比对函数与 `docs/presets/README.md` 不存在。
- [x] 1.11 实现：锁定比对函数，以及 `docs/presets/README.md`（含"只能追加新 id"的规则），使 1.10 通过。
- [x] 1.12 重构；全量测试保持通过。
- [x] 1.13 修改 `spec Scenario "源码与文案不含版本"` 的断言（`lib/rubric.json` 不存在、使用新的哈希路径），先确认它失败。
- [x] 1.14 实现：清理构建产物，使 `lib/rubric.json` 不再出现，让 1.13 通过（`npm run build` 会先清空 `lib`，主要核对 `npm pack` 的输出列表）。
- [x] 1.15 重构；全量测试保持通过。

## 2. `effort-as-verification` 预设（design D4、D9）

- [x] 2.1 编写失败测试 `spec Scenario "新预设文本含关键分界"`，并把 1.4 的期望补到两个预设；确认失败原因是该预设不存在。
- [x] 2.2 实现：`src/presets/effort-as-verification/rubric.json`（逐字使用 design D4 全文）以及注册表条目（中英标题、摘要、`evidence`、`sources`，`context: ["execution"]`），使 2.1 通过。
- [x] 2.3 重构；全量测试保持通过；把该预设的 `rubricSha256` 追加到锁定表。
- [x] 2.4 编写失败测试 `spec Scenario "每个内置预设都有文档"`；确认失败原因是 `docs/presets/*.md` 缺失。
- [x] 2.5 实现：编写 `docs/presets/reasoning-depth.md` 与 `docs/presets/effort-as-verification.md`（由草案改写），使 2.4 通过。
- [x] 2.6 重构：删除 `docs/effort-blog-rubric-strategy-draft.md`；全量测试保持通过。

## 3. 每次判断只采样一次预设，加上 Execution 行（design D5）

- [x] 3.1 在 `test/fake-jev.ts` 中加入"挂起凭据解析"钩子，`host-harness` 支持写入设置 `preset`；现有测试保持通过。
- [x] 3.2 编写失败测试 `spec Scenario "请求内容受限"`（改为 `reasoning-depth` 并断言无 `Execution:`）与 `spec Scenario "启用 execution 的预设加入固定行"`；确认后者失败的原因是 state 中没有 Execution 行。
- [x] 3.3 实现：`buildState` 增加可选参数 `execution`；`judgePolicy` 增加必填参数 `preset`；在 4 个调用点各自 `resolvePreset` 一次再向下传，使 3.2 通过。
- [x] 3.4 重构；全量测试保持通过（包括 `context.test.ts` 中 `reasoning-depth` 输出逐字节不变的断言）。
- [x] 3.5 编写失败测试 `spec Scenario "自主主任务不被断言为逐条复核"`；确认失败原因正确。
- [x] 3.6 实现：使 3.5 通过（如有需要，调整 Execution 固定文本，使其与 spec 完全一致）。
- [x] 3.7 重构；全量测试保持通过。
- [x] 3.8 编写失败测试 `spec Scenario "设置中的未知预设回落到缺省预设"`；确认失败原因正确。
- [x] 3.9 实现：`resolvePreset` 对未知 id 回落到缺省预设，并接入 `deps.settings()`，使 3.8 通过。
- [x] 3.10 重构；全量测试保持通过。
- [x] 3.11 编写失败测试 `spec Scenario "主判断进行中切换预设"`；确认失败原因正确（例如 questions 和 state 来自两次不同的读取，或者没有读取）。
- [x] 3.12 实现：主会话 pre-step 只捕获一次预设，使 3.11 中与请求相关的断言通过；快照断言留到 4.x 完成。
- [x] 3.13 重构；全量测试保持通过。
- [x] 3.14 编写失败测试 `spec Scenario "子任务在创建后、首次判断前切换预设"`；确认失败原因正确。
- [x] 3.15 实现：子任务在首次 pre-step 时捕获预设，创建时不捕获，使 3.14 通过。
- [x] 3.16 重构；全量测试保持通过。
- [x] 3.17 编写失败测试 `spec Scenario "预览进行中切换预设"` 与 `spec Scenario "预览与 fresh 子任务独立采样"`；确认失败原因正确。
- [x] 3.18 实现：`subagent-tool.ts` 独立捕获预设，使 3.17 通过。
- [x] 3.19 重构；全量测试保持通过。
- [x] 3.20 编写失败测试 `spec Scenario "测试连接使用所选预设"`（test/settings-host.test.ts）；确认失败原因正确。
- [x] 3.21 实现：`settings-host.ts` 的 `testDecision` 捕获所选预设并传入，使 3.20 通过。
- [x] 3.22 重构；全量测试保持通过。
- [x] 3.23 编写失败测试 `spec Scenario "新预设不改变引擎档位"`；确认它在没有 preset 设置时失败。
- [x] 3.24 实现：使 3.23 通过（预期不需要改动引擎，只要接线正确）。
- [x] 3.25 重构；全量测试保持通过。
- [x] 3.26 修改 `spec Scenario "源码不含本地分类与其它出站"`，把主机白名单扩展为包含预设 `sources` 的主机；先确认它失败。
- [x] 3.27 实现：调整白名单测试的数据来源，使其包含 `PRESETS` 中 sources 的主机，让 3.26 通过。
- [x] 3.28 重构；全量测试保持通过。

## 4. 主决策的预设归属（design D6）

- [x] 4.1 编写失败测试 `spec Scenario "快照记录作出决策时的预设"`，并补齐 3.11 中的快照断言；确认失败原因是快照中没有 `preset`。
- [x] 4.2 实现：用 `mainDecided`（按会话 id 存 `{id, decidedAt, preset}`）替换全局 `decidedAt`；快照 schema 增加 `preset`；在绑定处读取，使 4.1 通过。
- [x] 4.3 重构；全量测试保持通过（含 `新旧记录并存`）。
- [x] 4.4 编写失败测试 `spec Scenario "活跃决策跨越大量其它判断仍保留归属"`；确认在旧的 200 条 FIFO 逻辑下失败。如果 4.2 已经修好，就先在临时 stash 上复现失败，并记录在测试注释中。
- [x] 4.5 实现：在失败、取消、`invalidate()`、`agent/disposed` 时删除条目，使 4.4 通过。
- [x] 4.6 重构；全量测试保持通过。
- [x] 4.7 编写失败测试 `spec Scenario "非用户回合不重判"`（含快照中 preset 与决策 id 的断言）以及 `spec Scenario "切换预设不改变已绑定子任务与已作出的决定"`；确认失败原因正确。
- [x] 4.8 实现：使 4.7 通过（非用户回合沿用 `mainDecided` 中的原条目）。
- [x] 4.9 重构；全量测试保持通过。

## 5. 设置与设置页（design D7）

- [x] 5.1 修改 `spec Scenario "非法设置整体拒绝"`（999/8001/1500.5/未知 preset 拒绝；1000/6000/8000 接受）与 `spec Scenario "设置文件损坏"`（含未知 preset）；确认 preset 相关断言失败。
- [x] 5.2 实现：`settings.ts` 增加字段 `preset: z.enum(...)`，`DEFAULT_SETTINGS.preset`，使 5.1 通过。
- [x] 5.3 重构；全量测试保持通过。
- [x] 5.4 编写失败测试 `spec Scenario "选择并保存判档预设"`，并修改 `spec Scenario "策略说明来自规则文件与注册表"`（所选预设为 `effort-as-verification`，检查来源链接属性）；确认失败原因正确。
- [x] 5.5 实现：设置页预设选择器；`StrategyDetails` 接收已解析的预设，渲染元数据、来源链接与 rubric；对四个 locale key（`strategyDepth`、`strategyDepthBody`、`strategyIntro`、`autoIntro`）的中英文案做中性化，并更新 `client-locales` 的期望；使 5.4 通过。
- [x] 5.6 重构；全量测试保持通过（含 `独立保存结果与不泄漏`）。

## 6. eval（design D8）

- [x] 6.1 编写失败测试 `spec Scenario "未知预设提前拒绝"`（test/eval-live.test.ts，用 `node --import` 加载 fetch 桩）；确认失败原因是脚本不认识 `--preset`。
- [x] 6.2 实现：`live.mjs` 先解析 `--preset`，未知值直接退出，退出发生在读 key、发网络请求、创建输出文件之前；`lib/context.js` 缺失时提示先 build 并退出。使 6.1 通过。
- [x] 6.3 重构；全量测试保持通过。
- [x] 6.4 编写失败测试 `spec Scenario "报告记录实验条件"`；确认失败原因是报告缺少 `preset`、`expected`、`execution`，或 state 不是字符串。
- [x] 6.5 实现：`live.mjs` 改为 import `lib/context.js` 的 `buildState`，读取所选预设的 rubric，并输出新报告字段；`cases.json` 增加 8 条用例（按草案 §8.1 的 id 与期望，任务文本自写，不复制文章原题），给 `dev-debug` 加 `depthFor`，并给各用例加 `execution`；使 6.4 通过。
- [x] 6.6 重构；全量测试保持通过；更新 `eval/README.md` 与 `eval/README.zh.md`，说明 `--preset`、需要先 build、单次上限，以及不包含重放检验。**不执行任何付费调用。**

## 7. 文档、版本与发布元数据

- [x] 7.1 在 README.md 与 README.zh.md 中各新增「判档预设」一节：说明如何选择预设、两个内置预设、来源与证据边界、降级影响。
- [x] 7.2 将 package.json 版本升为 0.7.0，在 CHANGELOG 中记录新增能力、BREAKING（包内结构，以及降级后的可见性），并在 `dsh.yaml` 中同步该 local 包的版本说明（如有）。
- [x] 7.3 运行 `npm run typecheck && npm test`；确认全部通过，且 test-plan 每一行都是 🟢。

## 8. 仓库级验证（在 worktree 根目录执行）

- [x] 8.1 运行 `OPENSPEC_TELEMETRY=0 openspec validate auto-routing-judgement-presets --strict`（worktree 中的 `node_modules/.bin/openspec` 是悬空链接时，改用主 checkout 的 `node_modules/.bin/openspec`，并以 worktree 为 workdir）；确认退出码为 0。
- [ ] 8.2 运行 `npm test` 与 `npm run check:artifacts`；确认都通过。
- [ ] 8.3 运行两次 `node scripts/sync.mjs`（如需隔离，按仓库约定使用隔离 `DSH_HOME`）；确认第二次没有变更。
- [x] 8.4 生成 verify.md（anvil verify），对照 test-plan 审计全部行均为 🟢；合入、部署与重启 Host 都要另外经用户批准，不在本任务中执行。
