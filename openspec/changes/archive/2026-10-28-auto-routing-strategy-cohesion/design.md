## Context

`packages/auto-model-routing` 0.4.2 有两条链路：

- 默认链路（内部叫 policy-v2）：`policy-host.ts` 在 `agent/pre-step` 判断主会话 depth、在 `agent/request` 改写 effort；子任务在官方 fresh 创建工具的 async 生命周期内绑定精确 child，首次请求前判断 capability/depth 并持久化 route。
- legacy 链路：`router.ts` + `rubric.json` 四档 + `CHILD_MODELS` + `mainEfforts`/`childRoutes` 设置 + 回复栏四档标注 + `judgements.jsonl`。只有 `config.json` 显式写 `policy: "legacy"` 时生效（`index.ts:73,96`、`subagent-tool.ts:79`）。

家族知识当前分布：

| 知识 | 位置 |
|---|---|
| 主模型支持判定 `/^(claude\|gpt)-/i` | `support.ts:18` |
| transport → 家族、Magpie 前缀 | `policy-v2.ts:9-14,46` |
| 能力槽 | `policy-v2.ts:22-25` |
| 已知模型正则 + 起点表 | `policy-v2.ts:29`、`effort.ts:8-16` |
| `route_subagent` provider/family 枚举 | `subagent-tool.ts:44,47` |
| 设置页分页、策略说明 | `settings-contract.ts:5-6`、`client/strategy-details.ts:16-18` |
| 落盘 family 枚举 | `policy-store.ts:12` |

版本概念：`settings.policy`；`jev.ts:12` 的 `policyVersion`（规则哈希）、`jev.ts:23` 的 `rubricVersion`；`policy-v2.ts:26` 的 `mappingVersion`；`policy-store.ts` 的 `version: 1` 与 `policy-host.ts:117` 的恢复版本门禁；`feedback.ts:7` 快照字段；`usage-report.ts:191` 分组。

本机 `config.json` 只含 `childRoutes`（无 `policy`），即实际运行默认链路，`childRoutes` 无效果。

## Goals / Non-Goals

**Goals:**
- 家族知识只存在于 `src/strategies/`；新增家族 = 新增一个策略文件 + 注册（PR）。
- 删除 legacy 链路与全部版本概念，默认链路的可观察行为（请求配置、子任务 route、状态与反馈语义）不变。
- 旧配置、旧状态与旧账本可读，不破坏已绑定子会话的恢复。

**Non-Goals:**
- 本地 JSON 策略、覆盖或禁用机制。
- 家族 id `codex` → `gpt` 改名（注册表 id 保持 `codex`，label 为 GPT）。
- 修改 Jev 规则内容、depth 偏移规则、effort 上限、允许列表门禁、fork 支持。
- 修改环境级指令 `instructions/dsh-home.md` 与 `tests/agent-instructions-dispatch.test.mjs`（其“必须先调用 `route_subagent`”规则仍成立：工具仍存在且在 MANUAL 下返回 `routed: false`）。

## Decisions

### D1 策略用 TS 数据文件，不用 JSON

`src/strategies/claude.ts`、`codex.ts` 各导出一个 `as const satisfies FamilyStrategy` 对象；`src/strategies/index.ts` 定义 `FamilyStrategy` 类型、`createRegistry(strategies)` 与默认 `registry`。

- 选 TS 而非 JSON：本期不开放本地加载，TS 有类型检查与 `satisfies` 字面量校验，不需要额外的 schema 和运行时加载器。以后做本地扩展时再加 JSON + zod，`createRegistry` 的校验可以直接复用。
- depth 偏移、effort 上限与自动 effort 序列不放进策略：它们是引擎不变量（spec「AUTO 决策与执行」）。放进策略会让同一个 depth 在不同家族含义不同。
- 不设任何版本字段（用户明确要求）。快照只记录策略家族 id；包的发布版本号只是 npm 元数据，不进入运行时记录。
- 不提供本地加载器、覆盖优先级或回调扩展点（review S1）。

### D2 注册表是唯一查询入口与匹配规则

`Registry` 只暴露纯函数：

```
familyOfMainModel(model)          -> FamilyStrategy | undefined  // 支持判定：去最后一个 / 之前部分，忽略大小写比前缀
familyOfChild(provider, model)    -> FamilyStrategy | undefined  // 该 provider 下按子模型前缀识别（大小写敏感）
childModel(familyId, provider, c) -> string | undefined          // transport 前缀 + 能力槽
effortStart(model)                -> Effort | undefined          // 去最后一个 / 之前部分，大小写敏感查全体 effortStarts
providers()                       -> string[]                    // transports 键并集
ids()                             -> string[]
labels()                          -> string[]
```

三种匹配有意用了不同的归一化，目的是逐项保持现有行为（review M3；用 0.4.2 构建产物实测的输出见 spec「effort 起点按模型名查找且保持原结果」）：

- 支持判定：现状是 `/^(claude|gpt)-/i`，作用于最后一段（`support.ts:17-18`），所以忽略大小写。
- effort 起点：现状是一条大小写敏感的已知模型正则，作用于最后一段（`policy-v2.ts:28-30`），并且不看 provider 和家族。所以 `opencode-go/gpt-6-luna` 的起点是 high，`CLAUDE-OPUS-5-5` 用目录默认值。
- 子模型家族识别：现状只在 Magpie 下按 `claude/`、`codex/` 前缀识别，本地 transport 直接用 provider 作为家族（`policy-v2.ts:9-14`）。新规则“该 provider 下按前缀识别；空前缀的 provider 只属于一个家族”能覆盖这两种情况。

`effort.ts` 的 `STARTING_POINTS` 与 `targetEffort` 删除。`policyEffort` 的起点改为 `registry.effortStart(model) ?? catalog.defaultEffort`。0.4.2 的已知模型正则恰好等于两张起点表的键集合（review 已核对），所以结果逐项相同。

以下位置只通过注册表取家族信息：

- `support.ts`
- `routing.ts`（由 `policy-v2.ts` 改名）
- `policy-host.ts`：包括 `delegation` 的 AsyncLocalStorage 类型、provider 判断（`:53`）和 family 推断（`:55`）
- `policy-store.ts`：zod 枚举改为构造时传入的 `registry.providers()` 与 `registry.ids()`
- `subagent-tool.ts`
- `settings-host.ts`：目录与允许列表的 provider 过滤（`:20,35`）改为 `registry.providers()`
- `client/strategy-details.ts`
- `client/index.ts`：锁定态文案

`apply(ctx, config)` 的测试 `Config` 增加可选 `strategies`，缺省使用内置策略。这是 spec「新增家族只需新增策略」测试注入合成策略的接缝，测试不需要改源码。

### D3 构造期校验，失败即插件加载失败

`createRegistry` 校验以下各项（review C1）：

- id 唯一；
- 模型前缀忽略大小写后互不包含；
- `effortStarts` 的键全局唯一；
- 起点值合法；
- 能力槽齐全；
- **同一 provider 下**子模型前缀互不包含，且空前缀的 provider 只属于一个策略。

不同 provider 之间可以使用相同前缀：内置 `claude:''` 与 `codex:''` 合法，两个 Magpie provider 都用 `claude/` 也合法。

内置注册表在模块加载时构造，错误会在测试和 `apply` 时立即暴露。不做“跳过坏策略继续运行”：内置数据出错就是代码缺陷，应当 fail closed。

### D4 legacy 删除范围

**删除：**

- 源码：`router.ts`、四档 `rubric.json`、`judgements.ts`、`client/route-picker.ts`；`settings-validation.ts` 中与映射相关的函数；`settings.ts` 的映射合并与校验；`settings-section.ts` 的映射分页；`label.ts` 的四档菜单分支；`endpoints.ts` 中 `endpoint()` 的 router 部分（状态读取改由 policy host 提供）；`index.ts` 中 legacy 的两个 hook 以及 Router、JudgementBook 的构造；`subagent-tool.ts` 的 legacy 分支。
- 脚本与评估：`scripts/label-report.mjs`（同时从 `package.json` 的 `files` 移除）、`eval/run.mjs`、`eval/cases.json`、`eval/baseline.json`。
- 对应测试：`router.test.ts`、`label-report.test.ts`、`eval-runner.test.ts`、`route-picker.dom.test.ts`、`effort.test.ts` 的 tier 部分、`settings-states.dom.test.ts`、`settings.test.ts` 与 `settings-section.dom.test.ts` 的映射用例、`host.integration.test.ts` 的 legacy 用例（`jev_tier_drives_effort`、`judgement_*`、`label_*`、`family_mapping_*` 等）。

**改名与改写：**

- `policy-v2-rubric.json` 改名为 `rubric.json`，内容逐字节不变。
- `eval/policy-v2-live.mjs`、`eval/policy-v2-cases.json` 去掉名称中的版本前缀；报告删除 `rubricVersion` 字段，不以其它名称替代。
- `scripts/magpie-live-acceptance.mjs` 不再写入或返回 `policy: 'policy-v2'`。
- `scripts/policy-v2-host-probe.mjs` 改名为 `scripts/host-probe-children.mjs`，临时目录前缀同步改掉。

**保留：**

- `state.ts` 继续读取 `previous`，但不再写入。
- `context.ts` 的 `buildState` 去掉 `previous` 参数，固定输出 `Previous user-turn tier: none` 作为首行。这就是默认链路的现状：`policy-host.ts:91` 从未传入 `previous`。这样 Jev 收到的输入逐字节不变。

替代方案“保留 legacy，但把开关改成描述性的名字”已被用户否决，因为它会保留两套策略并存的结构。

### D5 版本删除与兼容

- **`settings.policy`**：从 schema 中删除。读取时与 `mainEfforts`、`childRoutes` 一起归入 `deprecated`，不进入 `issues`，`configStatus` 也不会因此变为 `invalid`。保存时只写普通字段。
- **`PolicyStore` 读取**（review C3）：使用严格 schema，额外只允许 `version: z.literal(1)`、`policyVersion: z.string()`、`mappingVersion: z.string()` 三个历史键。解析后显式剥掉这三个键，再交给严格的 canonical schema 校验身份，并检查 `childId` 是否相符。其它未知键、形状错误、身份不符一律抛错。
- **`PolicyStore` 写入**：canonical strict schema，不含历史键；保留现有“写入 `task` 键会抛错”的测试。`policy-host.ts:234` 重写记录时自然去掉这三个历史键。
- **恢复门禁**：`policy-host.ts:117` 的版本比较删除。review 已核对：pending 记录只在本进程内存中由 `agent/created` 写入，所以这里的比较在正常路径上是冗余的。`:114`（pending 不在内存就拒绝）与 `:115`（状态不是 recommended 就拒绝）保留。
- **反馈账本**（review C4）：
  - 绑定快照新增 `strategy?`；`policyVersion`、`mappingVersion` 改为可选，只用于读取旧行。
  - 反馈事件与事实事件的 `version` 改为可选，读取时只接受原值（2 和 1）。
  - 新写入的行都不带 `version`，其它未知键仍按损坏行跳过。
  - `strategy` 由 `registry.familyOfMainModel(actual.model)?.id` 得到；找不到时不写该字段。
- **用量报告**：按 spec 分组，旧分组标识保持原值，不做映射，以免伪造；去掉 `schema: 1`。
- **状态目录**：`state/auto-model-routing/policy-v2/` 不迁移，只作为 `index.ts` 中一个具名常量 `CHILD_DECISIONS_DIR` 保留。迁移会引入真实的数据搬移和失败窗口，收益只是一个目录名。
- **状态与 label 响应**：
  - 状态响应删除 `policy`、`history` 键。
  - client 原来以 `view.policy === 'policy-v2'` 判断的分支，改为无条件渲染当前格式。
  - `label` 端点不再返回 `policy`，并把绑定投影为公开形状：去掉快照中的 `policyVersion`、`mappingVersion`，不为历史绑定补 `strategy`（review R2-M1）。`FeedbackBook` 内部读取与账本原行保持不变，用量报告仍能按历史字段分组。client 以响应中是否有 `depth` 判断分配视图，`{}` 渲染为空。曝光观察的启动条件随之改为 `depth` 存在。
- **决策对象**（review M4）：字段保持原样，包括 `tier`（等于 depth 或 capability，它不是版本字段）。spec 中的场景都是部分匹配，不要求删除 `tier` 字段，也不要求它改变语义。

### D6 `reason` 闭集收窄

`continued` 与 `jev-failed` 只由 `router.ts` 产生；默认链路只产生 `jev` 与 `no-effort-support`（`policy-host.ts:158,173`）。spec 改为 `jev | no-effort-support`，与实现现状对齐。

### D7 发布版本与回滚

包的 npm 版本从 0.4.2 升到 0.5.0（删除配置字段和 `label` 参数，属于对外行为变化）。这只是发布元数据。`dsh.yaml` 同步 version 与 note：去掉“legacy四档仅显式回滚”，改为说明回滚方式。CHANGELOG 新增 0.5.0 条目。

**回滚**（review M1）：`dsh.yaml` 中的 local 条目只改 version 并不会换代码，因为 sync 对 local 包总是安装当前源码（`scripts/sync.mjs:1352,1378`）。可执行的回滚是把该条目临时改为：

```yaml
source: remote
spec: dsh-auto-model-routing@0.4.2
version: 0.4.2
```

0.4.2 已发布在 npm 上。改完后 `dsh build`，再由用户重启 Host，最后用 `dsh --dump-config` 或 profile 中 `node_modules/dsh-auto-model-routing/package.json` 的版本号确认已切换。

回滚后的数据边界：

- 0.5.0 写入或重写过的子会话记录没有 `version`、`policyVersion`、`mappingVersion`，0.4.2 读取时会 fail closed。这包括在 0.5.0 下继续使用过的旧子会话，这些子会话需要新建。
- 0.5.0 写入的反馈绑定、反馈事件和事实行，0.4.2 读不到。受影响的是反馈入口与用量报告。
- 在 0.5.0 下保存过设置时，`childRoutes` 等旧字段已经被移除。

升级前，实施任务会把 `state/auto-model-routing/` 与 `plugins/dsh-auto-model-routing/config.json` 整体复制到带时间戳的备份目录。回滚时可以选择恢复备份，但要接受备份之后的新数据会丢失。任何情况下都不删除绑定标记来绕过 fail closed。

## Risks / Trade-offs

- **[行为等价无法逐一证明]**：test-plan 把现有默认链路测试列为回归集合，只允许改 import 路径、去掉写入的 `policy` 配置、去掉对版本字段的断言，期望值不改。回归集合包括：`policy-host.integration`、`policy-v2`、`policy-v2-jev`、`subagent-tool` 的默认分支、`host.integration` 中 policy 与 feedback 相关部分、`toast`、`lock`、`label-button` 的分配部分、`feedback`、`policy-store`、`usage-report`。另外加两类测试：一是 spec 中以 0.4.2 构建产物实测输出为固定期望的等价表测试；二是升级、降级兼容 fixture 矩阵，覆盖旧配置、旧记录、旧账本、旧状态文件。
- **[用户本机 `childRoutes` 失效]**：它在默认链路下本来就没有效果。设置页显示“不再生效”，保存时清除，不需要迁移。
- **[有人依赖 `policy: legacy` 回滚]**：本机未使用。按 D7 用 remote pin 回滚，README 和 CHANGELOG 中写明。
- **[公开包遗漏或残留文件与链接]**：`package.json` 的 `files`、两份 README、`docs/feedback-evaluation.md`、`docs/` 中指向改名文件的链接，都列入 tasks 逐项改写。历史验收文档（`docs/policy-v2-development.md`、`docs/jev-policy-v2-validation.md`、`docs/magpie-live-acceptance.md` 等）保留原有事实，只在文首加一行“历史记录，命名与路径以 0.4.x 为准”，并修正其中失效的链接。`content.test` 增加对包内 Markdown 相对链接的检查。
- **[规则文件改名导致 Jev 请求漂移]**：spec 要求改名前后 sha256 相同，test-plan 中加断言。
- **[主 spec 的 Purpose 与权威说明过期]**（review M2）：OpenSpec 合并时不改 Purpose。归档前由 tasks 显式改写 `openspec/specs/auto-model-routing/spec.md` 第 5–7 行（去掉 legacy 回滚与“前七条”的说明）和 `openspec/specs/auto-routing-usage-report/spec.md` 第 5 行的分组描述，并检查合并后的主 spec 中不再有 legacy 或版本选择方面的义务。未改动的 requirement「手动隔离与失败可见」中“新判断”一词指“新的一次判断”，不是指新策略，保留。
- **[构建产物残留]**（review R2-M2）：`tsc` 不清理输出目录，`tsdown` 配置为 `clean: false`，所以在已有 0.4.2 产物的工作区构建时，`lib/router.js`、`lib/policy-v2.js` 等会留在包里。包的 `build` 脚本改为先删除 `lib/`，再执行 `tsc`，最后执行 `tsdown`（`tsdown` 保持 `clean: false`，避免删掉 `tsc` 产物）。删除只用 Node 内置的 `fs.rmSync` 删固定的包内 `lib` 路径，不引入依赖。验收时从含旧产物的 `lib/` 出发执行构建与 `npm pack --dry-run`，检查文件列表。
- **[OpenSpec strict 对长 requirement 报 warning]**：`openspec validate --strict` 只因长度 warning 退出 1（条数随修订变化，以实际输出为准），没有 ERROR；非 strict 通过。按 review S2 如实报告 strict 的退出码，不为了消掉 warning 而改变行为。

## Migration Plan

1. 在 worktree 内完成实现与测试，包内 `npm test` 与根 `npm test` 均通过；根 `tests/auto-model-routing-sync.test.mjs` 中的 manifest 版本同步改为 0.5.0。
2. 本机部署前备份 `state/auto-model-routing/` 与插件配置（D7），然后连续运行两次 `dsh build`，第二次应无变化。是否重启 Host 由用户决定。
3. 首次打开设置页可以看到“旧映射不再生效”，保存一次后配置文件中的 `childRoutes` 被移除。
4. 回滚方式见 D7。

## Open Questions

- 没有阻塞问题。`codex` → `gpt` 改名和本地策略加载留给后续 change。
