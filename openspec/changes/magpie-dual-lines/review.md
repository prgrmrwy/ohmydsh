## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 `VERDICT: APPROVE_WITH_CHANGES`（M11–M19 的 RC1–RC9 经定点复核全部 fixed、`CHANGES_APPLIED: yes`；更早 round 1 为 `REVISE`：3 Critical / 10 Moderate / 9 Suggestions）。round 2 之后用户明确要求**移除向后兼容**并如实声明 BREAKING，作者因此**重写** proposal/design/三份 delta specs（设置只留 `lines[]`、删除迁移与 id 复用、随机 8 位 hex id、所有线路统一 `MAGPIE_LINE_<ID>_*`）。被评制品内容已变，round 2 的 verdict 依 STALENESS 失效（round 2 的 review 正文已被本轮覆盖，历史只保留在本摘要与 [review-round1.md](</openspec/changes/magpie-dual-lines/review-round1.md>)）；本轮是对**重写后内容**的完整新评审，不是 RC 定点复核。
- **Reviewer context**: fresh-context subagent（同模型 deepseek-v4.1-flash；本机 `command -v codex claude gemini cursor-agent opencode` 全部 not found、exit 1，无跨模型 CLI 可用；按 Anvil failure handling 落到 option 2 本地新上下文评审，如实记录。评审者与作者不在同一上下文、未参与撰写，只读磁盘制品）
- **Tool restrictions**: 只读：`read/grep/glob` + `bash` 只读命令（`cat/sed/grep/awk/ls/find/head/tail/wc/sha256sum/diff`）+ `openspec validate|status|show` + `node -e` 只读事实核验；未运行测试/构建/安装、未联网、未启停服务、未读取任何凭据文件；唯一写入是本报告（覆盖 round 2 的 `review.md`，未修改 proposal/design/specs/tasks/test-plan/verify 或任何其它文件）
- **Artifacts reviewed（verdict 范围）**: `proposal.md`、`design.md`、`specs/dsh-magpie-connector/spec.md`、`specs/magpie-access-auth/spec.md`、`specs/magpie-line-selection/spec.md`
- **Artifacts reviewed（上下文，不计入 verdict 范围）**: 当前规范基线 `openspec/specs/{dsh-magpie-connector,magpie-access-auth}/spec.md`；下游制品 `tasks.md`、`test-plan.md`、`verify.md`（均为 round-2 通过时生成/验证，本轮核对是否仍与新制品一致）；实现与测试 `packages/dsh-magpie-connector/{src,test}/**`、发布资产 `README*.md`/`CHANGELOG.md`/`docs/**`/`dsh.yaml`/根 `README*.md`（只读核对 BREAKING 一致性）；Anvil `schema.yaml`/`templates/review.md`；round-1 review 与 round-2 review 内容
- **Artifact hashes（sha256sum，评审时刻 2026-10-28 23:37 +08:00，评审全程多次采样一致）**：

```text
ce42bbf7436e839c3a75b594e897dd5bf4e8beba6a77befb5072a7e543ed7672  proposal.md
257c2fddc88e880ce4069afff172bc104a14a61cce5b559835a3625b28b3028f  design.md
5fb66315dc189668d8944c4931b4aab8422280f1eb12bb3896f42cdb987db993  specs/dsh-magpie-connector/spec.md
3abe69d79c96548f9483144b333668a5ff260463d9a0f9a85f7cf12a9ec82004  specs/magpie-access-auth/spec.md
6c3c1412a71e702b45b144f901d9f2d4f3581c29db0f3d13779541564c7b7f1d  specs/magpie-line-selection/spec.md
```

- **STALENESS**: 本判定只对以上哈希对应的制品内容有效。之后除应用本报告的 Required Changes（RC10–RC16）外的任何编辑都会作废本 verdict，必须重开一轮完整评审。`specs/magpie-access-auth/spec.md` 的哈希与 round 2 相同（`3abe69d7…`）：本轮未修订该文件，其内容已经是「按线路、只发 https」语义，与新设计一致。
- **机械核验（本轮实测）**：`openspec validate magpie-dual-lines --strict` → `Change 'magpie-dual-lines' is valid`（exit 0；`openspec` CLI 1.14.1）。`openspec show magpie-dual-lines --json` → `deltaCount: 19`（connector 8 = 6 MODIFIED + 2 ADDED；line-selection 8 ADDED；access-auth 3 MODIFIED）；`#### Scenario:` 共 **79** 条、唯一名 **79** 条、0 重复（独立 awk/正则与 CLI 解析一致；分布 46/7/26）。9 个 MODIFIED requirement 的基线场景名 **0 缺失**（connector 6 个 req 基线 1/5/2/7/3/5 = 23 条；access-auth 3 个 req 基线 3/2/2 = 7 条）。`tasks.md` 与 `test-plan.md` 仍按 round-2 的 20 requirements / 84 scenarios 编写（见 M20，不计入以上五份制品）。
- change 目录在 git 中仍为 untracked，工作区其余为其所属实现改动（`git status` 47 项）；本报告写入前后五份制品哈希不变。

## 评审方法与只读核验

本轮不是只看 diff：完整重读五份重写后的制品，并与 round-1/round-2 的历史 finding 逐条对照，再用只读脚本/命令做机械核验（未运行任何测试、构建、安装或网络操作）：

1. **结构核验**：用 `openspec show --json` 拉平 19 个 delta requirement 与 79 个 scenario；独立正则复核场景名唯一性、文件分布与 requirement 归属。
2. **基线保留核验**：解析 `openspec/specs/` 基线与 delta 的 `### Requirement:` / `#### Scenario:`，逐条比对 MODIFIED requirement 的基线场景名是否保留、requirement 名是否一致（均通过）。
3. **BREAKING 一致性扫描**：对五份制品 grep `迁移|兼容|降级|legacy|MAGPIE_API_KEY|MAGPIE_ACCESS_|nextLineId|notices|id 复用`，确认本轮只存在「明确不读取/不迁移/不兼容」的否定式表述，无旧语义残留（详见下文「BREAKING 一致性」与 M20 的下游例外）。
4. **随机 id 语义扫描**：全文搜索数字 id、`MAGPIE_LINE_<数字>_*`、`data-active-line`、`retainedCredentials{lineId}`、pending 的 lineId，核对是否与「8 位小写 hex、不从序号派生」不变量一致（发现 M21）。
5. **旧契约与安全边界复检**：逐项复核 round 1/2 的安全类 finding（Access 不发明文 http、脱敏覆盖、pending 失败不提交、生成不换线不重放、跨线路不串用、探测不带凭据、传输白名单/拒绝重定向/私有 dispatcher），确认新文本是否保留。
6. **下游一致性核验**：对比 `tasks.md`/`test-plan.md`/`verify.md` 与被重写后的五份制品（requirement/scenario 数、被删 requirement、`verify.md` 记录的 hash 与 verdict/staleness 声明）；对 `README*.md`/`CHANGELOG.md`/`dsh.yaml`/`docs/internal-api.md`/根 `README*.md` 做同样核对（发现 M20）。
7. **实现事实核验（只读）**：为判断「既有 0.1.x 测试改成 lines 夹具」「随机 id 的测试可确定性」是否可行，只读检查 `src/host/{settings,runtime,selection}.ts` 与 `test/support/*`、`test/line-*.test.ts`：当前实现仍是 round-2 的 numeric-id + legacy 特例 + 迁移/镜像设计（见 M20 证据），新设计需重做而非「已完成」；测试可注入 probe/clock，但没有 id 生成 seam（见 S21）。

**局限**：未运行 `npm test`/`tsc`/`npm pack`/`openspec archive`，未部署、未重启、未联网，未读取任何凭据文件；真实 host 行为、跨线路 `/v1/models` 是否一致等按 design「Open Questions」对待，不冒充已验证。安全结论按 fail-closed 方向要求，不因历史 mock 可绿而降格。

## Findings

### 🔴 Critical (blocking)

本轮**无 Critical**。round 1 的 C1–C3 在 round 2 已复核 fixed，本轮确认其语义在 BREAKING 重写后仍然成立（见「Round 2 Findings Carry-over」）；round 2 的 M11–M19 亦无回归。M20–M26 是重写引入/暴露的一致性、契约与覆盖缺口，均可在不改变核心设计（单一 `lines[]`、随机 id 绑定按线路凭据、序号优先级、探测选线、继承目录、Access 按线路、生成不换线不重放）的前提下用明确编辑修好。

### 🟡 Moderate

#### M20 — 下游制品与发布资产仍是 BREAKING 前设计；`verify.md` 的「verdict 未过期 / 84/84 全绿」自证已失效

- **位置**：[tasks.md:3](</openspec/changes/magpie-dual-lines/tasks.md#L3>)（「20 requirements / 84 scenarios」）、[tasks.md:10](</openspec/changes/magpie-dual-lines/tasks.md#L10>)（`nextLineId`/兼容镜像/保留 v1 读取）、[tasks.md:22-23](</openspec/changes/magpie-dual-lines/tasks.md#L22-L23>)（「删除线路后 id 不复用」）、[tasks.md:155](</openspec/changes/magpie-dual-lines/tasks.md#L155>)（§8 设置迁移）、[tasks.md:328](</openspec/changes/magpie-dual-lines/tasks.md#L328>)（22.1「用 v1 settings 跑迁移后全量测试」）；[test-plan.md:50-52](</openspec/changes/magpie-dual-lines/test-plan.md#L50-L52>)（4 条设置迁移行）、[test-plan.md:11](</openspec/changes/magpie-dual-lines/test-plan.md#L11>)（id 不复用行，共 84 行 / 20 requirements）；[verify.md:11-13](</openspec/changes/magpie-dual-lines/verify.md#L11-L13>)（84/84、349/349）、[verify.md:29](</openspec/changes/magpie-dual-lines/verify.md#L29>)（「Verdict not stale…proposal `7ff601f3…`，design `36adee59…`，connector `b0e24238…`，line-selection `b8612e58…`」——与当前实际哈希 `ce42bbf7…`/`257c2fdd…`/`5fb66315…`/`6c3c1412…` 四份不一致，仅 access-auth 相同）、[verify.md:39](</openspec/changes/magpie-dual-lines/verify.md#L39>)（PASS_WITH_WARNINGS）。
- **发布资产同样停在旧设计**：[README.md:45](</packages/dsh-magpie-connector/README.md#L45>)、[README.zh.md:45](</packages/dsh-magpie-connector/README.zh.md#L45>)「A v1 single-address settings.json migrates to line 1…existing MAGPIE_API_KEY…do not need to be re-entered」；[CHANGELOG.md:8](</packages/dsh-magpie-connector/CHANGELOG.md#L8>)「Line `\"1\"` keeps `MAGPIE_API_KEY`…」「Migration and write safety…migrates once…baseUrl stays a downgrade mirror」；[dsh.yaml:394](</dsh.yaml#L394>) note「迁移自旧 baseUrl 并保留降级镜像」「信任面：读取 credentials MAGPIE_API_KEY」；[internal-api.md:8](</packages/dsh-magpie-connector/docs/internal-api.md#L8>)、[internal-api.md:18](</packages/dsh-magpie-connector/docs/internal-api.md#L18>)「`nextLineId`」「Line id `\"1\"` keeps the legacy refs」；根 [README.md:208](</README.md#L208>)、[README.zh.md:208](</README.zh.md#L208>) 仍是「single provider route / optional Cloudflare Access」，未含多线路能力（design D10 要求根 README 更新，git 中该文件未改）。
- **实现同样是旧设计**：[settings.ts:12-16](</packages/dsh-magpie-connector/src/host/settings.ts#L12-L16>)（`baseUrl` 兼容镜像 + `nextLineId`）、[settings.ts:53](</packages/dsh-magpie-connector/src/host/settings.ts#L53>)（id 只接受 `^[0-9]+$`）、[runtime.ts:15-17](</packages/dsh-magpie-connector/src/host/runtime.ts#L15-L17>)（id `"1"` 特判映射到三个 legacy 引用）、`test/migration.test.ts`、`test/line-id.test.ts` 中的 `nextLineId` 断言，均由 round-2 设计生成；新 spec 要求「单一 lines 格式、无迁移、全部线路 `MAGPIE_LINE_<ID>_*`、8 位随机 id」，这些必须重做而不是沿用。
- **问题**：五份被评制品与 design D10/Migration Plan 的**计划**是一致的（D10 的资产清单、Migration Plan 的「不迁移 + 用户重配 + 无自动降级」都正确），但**已落盘的下游制品/发布资产/实现对旧设计做了「完成」声明**：`tasks.md` 全 `[x]`、`verify.md` 的 PASS_WITH_WARNINGS 与「Verdict not stale」把 round-2 的制品哈希当成当前制品，属于**事实错误的自证**。按 Anvil 规则，`CHANGES_APPLIED: no` 期间 test-plan/tasks 不得推进；若照现有 tasks/verify 执行或交付，会实现已被用户主动删除的迁移/pending/numeric-id 语义，并向用户发布与新插件行为不符的 BREAKING 升配说明。
- **最小修法**：应用 RC11–RC16 后**重新生成** test-plan（19 requirements / 79 scenarios 的 1:1 映射，删除设置迁移/id 复用的 5 行）、tasks（删除 §8、2.7–2.9、`nextLineId`/兼容镜像/v1 读取，按 design D11 重新分层并保持 red-green-refactor 三元组）、verify（重跑全量、重算五份 hash、删除旧 hash 的「Verdict not stale」与 84/84 声明）；同时把实现/测试/发布资产按新 BREAKING 设计重做（详见 RC10）。不得把旧 `PASS_WITH_WARNINGS` 当成本轮新设计的验收证据。

#### M21 — 随机 id 重设计后，多处场景仍用旧数字 id /「派生 id」语义；与「8 位小写 hex、不从序号派生」不变量自相矛盾且不可机械断言

- **位置**：
  - [connector spec:79](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L79>)：`retainedCredentials` 恰含 `{lineId:"3", field:"key"}` 等三条——`"3"` 不可能是合法线路 id（requirement 在 [connector spec:7](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L7>) 规定 `^[0-9a-f]{8}$`；[line-selection spec:49](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L49>) 同）。
  - [connector spec:205](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L205>)：`MAGPIE_LINE_2_API_KEY`——既非 8 位 hex 派生引用，也与 [connector spec:9](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L9>)「所有线路 SHALL 使用 `MAGPIE_LINE_<ID>_*`，`<ID>` 为大写 id」冲突。
  - [connector spec:209-212](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L209-L212>)：场景名「**派生 id** 生效线路的外部凭据事件触发换代」+ GIVEN「id=`"2"`…来自 `MAGPIE_LINE_2_API_KEY`」——id 已不再派生（随机），且 `"2"` 非法。
  - [connector spec:341](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L341>)、[connector spec:343](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L343>)、[connector spec:346](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L346>)：pending `{lineId:"2", field:"key"}` 与「线路 2 仍存在」混用序号与 id；id 必须是 8 位 hex，序号不是 id。
  - [line-selection spec:71](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L71>)：`data-active-line="2"` vs [design:124](</openspec/changes/magpie-dual-lines/design.md#L124>) `data-active-line="<id>"`——前者像是序号、后者明确是 id；spec 正文 [line-selection spec:65](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L65>) 只写「元素带 `data-active-line`」未定义值域，于是「2」既可读成序号（违反「id 是唯一绑定键」的机器契约）也可读成非法 id。
- **问题**：这些场景在 round-2（numeric id 设计）下是合法的，BREAKING 换成随机 id 后未同步改写。后果不是措辞问题：(a) test-plan 的 1:1 映射必须写死期望 id，按字面会断言非法 id 或把「序号 2」当 id；(b) 实现者无法判断 `data-active-line` 用 id 还是序号，UI 机器契约不稳定；(c) 场景标题「派生 id」会误导后来者恢复已废弃的派生语义。task2 要求的「随机 id 语义 / 序号与 id 解耦」在规范层尚未闭环。
- **最小修法**：全 change 统一为「GIVEN 给出具体 8 位小写 hex id（如 `a1b2c3d4`/`9f0e7d6c`），THEN 用同一 id」，或引入明示的占位符约定（如 `<line-1-id>` 并声明测试夹具可写入任意合法 8 位 hex id）；把 `data-active-line` 值域写死为 `id` 并让场景使用 8 位 hex；把「派生 id…」场景改名为「非 1 号线路…」或「随机 id 线路…」；`MAGPIE_LINE_2_API_KEY` 一律改为 `MAGPIE_LINE_<8hex>_API_KEY`。

#### M22 — 持久化 settings 的加载时校验未定义：手改/损坏 settings 的重复 id、非法 id、大写 id、超 5 条、重复地址等 fail-closed 行为不可断言；design 的 Risk 缓解只覆盖写入 API

- **位置**：[design:49-52](</openspec/changes/magpie-dual-lines/design.md#L49-L52>)（唯一格式：`lines` 可空数组；「`lines` 缺失或非法时视为空配置」是唯一加载侧规则，但「非法」未枚举）、[design:76](</openspec/changes/magpie-dual-lines/design.md#L76>)（**写入**校验：id 规则、地址唯一、Access 成对合法 https、≤5 条、最后一条不可删——只覆盖 POST）、[design:162](</openspec/changes/magpie-dual-lines/design.md#L162>)（Risk「随机 id 碰撞/手改 settings 重复 id」的缓解写作「创建时与现存 id 去重；写入校验拒绝未知/重复 id」——对**手改后的文件加载**不成立）；[line-selection spec:49](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L49>)（id 规则整条以「请求」为主语）；[connector spec:29](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L29>)（地址唯一同样写「已配置…否则拒绝」，未区分写入与加载）。
- **问题**：线路 id 是凭据引用的唯一键。手改/损坏的 `settings.json` 若出现**两条线路共用同一 id**，两条线路会解析到同一组 `MAGPIE_LINE_<ID>_*`——同一 key/Access 会被发往两个不同 origin（与 round-1 Critical C3 同类的凭据错配，只是入口从正常操作变成本地文件编辑）；若接受大写/非 8hex id，`MAGPIE_LINE_<ID>_*`→小写 id 的事件映射会失配（[design:104](</openspec/changes/magpie-dual-lines/design.md#L104>)）；若加载不限制行数，≤5 的探测/校验预算可被绕过；重复非空地址同样绕过 origin 唯一性。按仓库「安全路径 fail closed」与用户本轮重点，加载侧必须有确定规则，而当前 spec 没有任何 requirement/scenario 能断言「手改重复/非法 id 时插件如何表现」。
- **最小修法**：在 spec（「线路 id 规则」或「网关连接与凭据」）与 design D2/D3 明确加载校验，并**写死**一种 fail-closed 裁决（例如：任一线路 id 非 `^[0-9a-f]{8}$`、id 重复（含大小写折叠后重复）、行数 >5、`accessMode` 非法 → **整个 settings 视为未配置**，不启动选择/不发任何请求、不向任何地址发送任一线路凭据；非法项丢弃不采用；旧 `baseUrl`/旧 `credentialUpdatePending` 形态同样按非法/忽略处理）；补 1 条场景：GIVEN settings 含重复 id + 非 8hex id + 6 条线路，WHEN 插件启动/读取设置/发起生成，THEN 视为未配置（或按写死的丢弃规则只保留合法线路），零网关请求、无任何凭据被发往任一地址、设置响应可解释该状态。同步修 design Risk 的缓解措辞（写入 + 加载两侧）。

#### M23 — pending「完整重试」的清理路径在 POST 契约中不可表达，orphan 场景的因果链也自相矛盾

- **位置**：[connector spec:338](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L338>)（「完整重试」= 提交整表 lines，并对 pending 中未再声明或不可再声明的 `(lineId, field)` 显式提交 `null` 清除）、[design:77](</openspec/changes/magpie-dual-lines/design.md#L77>)（同义复述）、[design:61-73](</openspec/changes/magpie-dual-lines/design.md#L61-L73>)（POST 只接受 `{lines, resync}`，没有承载「pending 中已不存在于 lines 的 lineId 的 null」的字段）、[connector spec:350-353](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L350-L353>)（orphan 场景）。
- **问题**：
  1. **不可表达**：pending 可含「已删除或未提交线路的 id」（[connector spec:338](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L338>) 明说），但这些 id 不在提交的 `lines` 数组里，POST 契约没有任何位置让客户端「显式提交 null」。场景 [connector spec:350-353](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L350-L353>) 要求清理 `9f0e7d6c` 的残留 key，可该 id 按定义不在 lines 中——测试无法构造出「清理 pending」的那一步请求，RC13 之前 orphan 清理只有设计意图、没有可执行契约。
  2. **场景因果矛盾**：该场景 WHEN 是「runtime 重启后**再次新增线路**」。而「再次新增线路」本身就是一次提交整表 lines 的写入，按 L338 应清空「未再声明」的 pending 条目；THEN 却又断言「pending 仍含 `{lineId:"9f0e7d6c"…}`」并「清理 pending 时…被 unset」。要么这次新增失败（场景未写），要么 pending 已被清（与 THEN 矛盾）——场景步骤不唯一。
  3. **操作类型缺失**：pending 条目只有 `(lineId, field)`，不区分 set 还是 unset。重启后一次「更新既有线路 key」的 set 若在写凭据与 lines 提交之间崩溃，客户端已无秘密可再声明（秘密不回显），按 L338 的规则只能对该字段提交 null——等于把「可能已成功写入的新秘密」或「尚未被覆盖的旧秘密」清掉。这个 fail-closed 方向的取舍可以接受，但必须写清是**有意的**（用户需重新输入），否则「完整重试」会被读成无损恢复。
- **最小修法**：为 pending 中不在 lines 的 id 定义可执行清理途径（二选一写死）：(a) POST 增加显式字段（如 `clearedCredentials: [{lineId, field}]`），(b) 定义 host 在成功提交 lines 时自动清除「不在 lines 中的 pending 条目」，并让场景按此断言；改写 orphan 场景为确定步骤（如「重试清理请求成功后」而不是「再次新增线路」）；明确 set 未完成时的重试语义（fail-closed 清空 + 提示重填，或 pending 增加 intent），并在 requirement 正文写一句。

#### M24 — POST lines 的凭据字段三态语义（省略 / 值 / null）未定义：重排或编辑既有线路时「保留」与「清除」不可区分，「排序不改绑/不丢凭据」无法机械断言

- **位置**：[design:63-73](</openspec/changes/magpie-dual-lines/design.md#L63-L73>)（POST 元素含 `key: "secret" | null`、`accessClientId: ... | null`，未定义字段省略语义）、[design:77](</openspec/changes/magpie-dual-lines/design.md#L77>)（「显式 null 清除」）、[design:126](</openspec/changes/magpie-dual-lines/design.md#L126>)（key 清空=卡片内留空并保存；`key:null` 仅在显式线路提交中可用）、[line-selection spec:21](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L21>)（上移/下移后「id 与配置跟随移动」）、[connector spec:21-23](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L21-L23>)（排序后两条线路仍按各自 id 读取原引用）。
- **问题**：POST 是整表提交（重排 / 上移 / 下移 / 拖拽 / 编辑任一线路都会提交全部 lines），而客户端永远无法回显既有秘密（[design:128](</openspec/changes/magpie-dual-lines/design.md#L128>) 秘密不回显），因此每个既有线路的凭据字段只能「省略」或「null」或重填。若实现把「省略」当成清空，一次纯排序就会清掉所有线路的 key/Access；若把「null」当成保留，「切回直连清除 Access」「清空 key」又无法表达。规范目前两种读法都能自圆其说，但互相矛盾——这是「排序/拖拽不改变凭据引用、不丢凭据」这条安全断言的机械前提。另外**新线路**提交的 key/Access 应写入 host 生成 id 的哪个引用，也没有场景断言（凭据绑定只在既有 id 上被验证）。
- **最小修法**：在 spec（「线路列表与优先级」或「网关连接与凭据」）与 design D3 写死三态：**字段省略 = 保持不变；`null` = 清除（且仅当该引用可写）；字符串 = 写入**，并说明整表提交/重排只改变数组顺序与地址/接入方式，不因省略而清凭据；补 1 条场景：两条线路各有 K1/K2，上移后分别生成 → `Authorization` 仍为 K1/K2，且未提交的 Access 未被清除；把「新线路提交的 key/Access 写入 `MAGPIE_LINE_<host 生成的 id>_API_KEY/_ACCESS_*`」写成可断言句（可在 [line-selection spec:51-55](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L51-L55>) 场景 THEN 补一句引用断言）。

#### M25 — 首次安装 / 空 `lines` 的初始状态与「默认一条」未定义；0 线状态的 UI 与写入语义不可断言

- **位置**：[line-selection spec:9](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L9>)（「默认一条，最多 5 条」「最后一条线路不可删除」）、[line-selection spec:11-15](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L11-L15>)（scenario「默认一条线路」GIVEN **已经只有一条完整线路**——测的是渲染，不是首次安装）、[design:49](</openspec/changes/magpie-dual-lines/design.md#L49>)（`lines` **可空数组**）、[design:126](</openspec/changes/magpie-dual-lines/design.md#L126>)（添加入口「在卡片或列表尾部」——0 卡片时是什么）、[connector spec:31](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L31>)（无完整线路 = 未配置，目录空/`MAGPIE_NOT_CONFIGURED`）、[design:59](</openspec/changes/magpie-dual-lines/design.md#L59>)（`activeLineId` 无完整线路时为 null）。
- **问题**：「默认一条」与「`lines` 可空数组」两种说法并存；首次安装（无 settings 文件 / `lines: []`）到底显示 0 张卡片 + 添加按钮，还是 host 种子出 1 条空线路，规范没有说；「最后一条不可删」隐含持久化 ≥1 条，但手改/首次状态允许 0 条；首条线路如何产生（POST 一条新线路、或 UI 首个卡片直接编辑）也未定义。test-plan 无法为「默认一条」写出确定断言（现有场景只覆盖 1 条已存在时的渲染），也无法区分 0 线与 1 条空线路的 `activeLineId`/卡片状态。
- **最小修法**：在 line-selection spec 明确首次安装状态与 0 线语义（建议写死：无 settings 时 GET 返回 `lines: []`，UI 显示空态与「添加线路」入口，POST 允许提交 1 条新线路；「最后一条不可删」仅约束**已有非空表**不允许被删到 0，0 线只来自首次/手改并按未配置处理）；补 1 条「首次安装」场景（GET `lines: []`、`activeLineId: null`、页面无 active 方块且有添加入口、保存首条线路后正常同步）。

#### M26 — BREAKING 升级行为（旧 settings / 旧凭据被忽略、插件保持未配置、且不删除旧数据）没有 spec requirement/scenario，不可机械断言

- **位置**：[proposal:9](</openspec/changes/magpie-dual-lines/proposal.md#L9>)、[proposal:38](</openspec/changes/magpie-dual-lines/proposal.md#L38>)（「不读取旧 settings/旧凭据，忽略并提示重配」）、[design:52](</openspec/changes/magpie-dual-lines/design.md#L52>)、[design:156](</openspec/changes/magpie-dual-lines/design.md#L156>)（Risk/BREAKING）、[design:166-173](</openspec/changes/magpie-dual-lines/design.md#L166-L173>)（Migration Plan：忽略旧文件/旧引用、用户重配、旧记录可自行删除、回滚无自动路径）——这些**只出现在 proposal/design**；delta specs 中没有任何 requirement/scenario 断言升级后旧 `settings.json`（只有 `baseUrl`）与旧 `MAGPIE_API_KEY`/`MAGPIE_ACCESS_*` 的确切行为（忽略 vs 清理、是否删除、是否报错、`GET settings` 返回什么）。
- **问题**：spec 是 test-plan 的唯一映射源。现有最接近的场景 [connector spec:63-67](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L63-L67>)「未配置时不提供模型且不发请求」GIVEN「没有任何完整线路」，按字面可由「lines: []」夹具满足，不会覆盖「旧格式文件存在 + 旧合法凭据存在」的 BREAKING 输入；「忽略 vs 清理」中「不删除旧凭据/旧设置内容」也无法断言。用户本轮明确要求升级后行为可断言，而 [connector spec:9](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L9>) 的「SHALL NOT 读取旧引用」仅有负向正文，没有场景。
- **最小修法**：在 connector delta（「网关连接与凭据」或「插件身份与命名」）补一段 BREAKING 语义 + 1 条场景：GIVEN 升级前 `settings.json` 只有 `baseUrl`，`MAGPIE_API_KEY`/`MAGPIE_ACCESS_*` 已配置；WHEN 插件启动、读取设置、列举模型并生成；THEN 视为未配置（`lines` 空/`activeLineId: null`、模型列表空、生成 `MAGPIE_NOT_CONFIGURED`、零网关请求），旧引用未被 resolve、设置响应不含旧数据/秘密，插件**未删除**旧凭据与旧 settings 内容（用户保存新配置后才覆盖）；把「不删除旧数据」写成 SHALL（与基线「禁用不删除用户数据」的意图一致）。该场景同时给「插件身份与命名」补上 failure/edge 覆盖。

### 📌 Suggestions

#### S16 — `resync` 字段出现但从未定义

[design:71](</openspec/changes/magpie-dual-lines/design.md#L71>) 的 POST 示例有 `"resync": true`，五份制品其它位置与 spec 均未说明其语义、默认值、与「保存后自动同步/目录同步触发」的关系。建议删除该字段，或写明「= 保存后强制一次目录同步（失败分类沿用目录同步 requirement）」。

#### S17 — 响应形状精度：`access` 的 configured/writable、POST 与 GET 同视图、`retainedCredentials` 的持续时间

- [design:59](</openspec/changes/magpie-dual-lines/design.md#L59>) 的 GET 形状写 `access:{clientId, clientSecret}`，而 [connector spec:35](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L35>) 要求「按线路返回**每项**凭据的 `configured`/`writable`」；应把 Access 两项也写成 `{configured,writable}` 形状，否则 spec 的断言在 design 没有对应字段。
- same 行只描述 GET，但 spec 的 pending 场景对 **POST 响应**同样断言 `pending` 为空（[connector spec:334](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L334>)、[connector spec:348](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L348>)）；建议 design 补半句「POST 返回与 GET 相同的设置视图」。
- `retainedCredentials` 出现在 GET 形状（design L59），但删除线路成功后该 id 已不在 `lines`，重启后无来源可推导；spec 只断言删除响应（[connector spec:79](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L79>)）。建议明确它是「删除响应的一次性提示」还是「持久化状态」：前者把 GET 形状里的字段去掉/标注一次性，后者写持久化位置。

#### S18 — 环境提供的凭据 + 随机 id + 「id 不展示在 UI」：用户如何得知 `MAGPIE_LINE_<ID>_*` 引用名

[proposal:10](</openspec/changes/magpie-dual-lines/proposal.md#L10>)、[connector spec:7](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L7>) 规定 id 不在 UI 展示，但「环境提供的 key/Access 拒绝修改并保留」（[connector spec:55](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L55>)、[connector spec:110-113](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L110-L113>)）、排障与手工重配都需要知道随机 id 才能声明 env 凭据/引用。round-2 的 numeric id 至少可猜，随机 id 不可猜。建议在 design D10 的包 README 里写明获取途径（读 `settings.json` 或 `GET settings` 的 `lines[].id`），或允许 UI 只读展示 id 并同步改「不在 UI 展示」措辞（需产品决策）。

#### S19 — 「随机 id 不会分配给未来线路」是概率论断；去重集合应包含 pending 中未提交 id

[design:77](</openspec/changes/magpie-dual-lines/design.md#L77>)、[connector spec:338](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L338>) 写「该 id 不会分配给未来线路（随机生成）」，严格说随机生成仍可能（2^-32 级）撞上；[design:50](</openspec/changes/magpie-dual-lines/design.md#L50>) 的去重只对「现存线路」。建议改为「碰撞概率可忽略」，并让创建时去重集合同时包含 `lines` 与 pending 中未提交的 id（成本一行），避免理论上的 orphan 凭据被未来线路继承。

#### S20 — 剩余覆盖缺口（非阻塞，但 test-plan 会少测）

- **排序导致生效线路改变 → 线路切换**：connector 身份 requirement 把它列为线路切换来源（[connector spec:135](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L135>)），但场景只覆盖自动探测切换/删除生效线路；建议补「上移使生效线路从 1 变 2：目录继承、卡片清空、向线路 2 重同步」。
- **`credentials/reference-updated` 映射不到现存线路 → 忽略**：requirement 有义务（[connector spec:137](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L137>)），无场景；这是「不换错代」的负向边界，建议补一条（发 `MAGPIE_LINE_DEADBEEF_API_KEY` 事件 → 不换代不清目录）。
- **基线「禁用不删除用户数据」仍只点名 `MAGPIE_API_KEY`**（[baseline spec:606](</openspec/specs/dsh-magpie-connector/spec.md#L606>)）：BREAKING 后凭据全部是 per-line 引用，建议在该基线 requirement 或本 change 的「网关连接与凭据」中补一句「enabled:false / dispose SHALL NOT 删除任何线路凭据与 settings」，否则合并后该不变量对新引用没有文字保障。
- **happy + failure/edge 覆盖**：19 个 delta requirement 中 17 个同时具备 happy 与 failure/edge；例外为 MODIFIED「插件身份与命名」（基线本就只有 1 条 happy，delta 新增 1 条 happy）与 ADDED「静默规则与 info 说明」（两条均为负向/展示义务）。按 Anvil 字面规则属覆盖缺口，但这两者都是「不出现/不新增」型义务；M26 的新场景可顺手给前者补 negative path，后者建议补一条边界（如「切换失败或无 active 时同样不弹提示、不插入 aria-live」）。

#### S21 — 测试策略需要确定性 id seam 与夹具约定；既有 0.1.x 测试改造范围被低估

[design:149](</openspec/changes/magpie-dual-lines/design.md#L149>) 只承诺断言 id 格式/去重/排序重启不变，[design:152](</openspec/changes/magpie-dual-lines/design.md#L152>) 只说「所有单线路 fixture 从 `{baseUrl}` 改为 `{lines:[...]}`+派生引用」。但：(a)「去重」测试需要能强制 id 碰撞（注入 id 生成器/stub `crypto.randomBytes`）；(b) 环境只读凭据用例需要在创建线路前就知道 id（可先写入固定合法 8hex id 的 settings 夹具）；建议像 probe/clock 一样在 design D11 明确**可注入 id 生成器**或写死「夹具直接写固定 8hex id」的约定。(c) 范围：当前 33 个测试文件使用 `SettingsStore`、34 个使用 `credentialsMock`（默认写 legacy `KEY_REF`），多份测试直接改 `store.value.baseUrl`；proposal [proposal:34](</openspec/changes/magpie-dual-lines/proposal.md#L34>) 只列 connection/transport/access/identity 四类，明显低估。可行性本身不怀疑（机械替换 + 统一 fixture helper 即可），但 tasks/test-plan 重生成时应给出文件清单/分组回归门，否则「全量回归」边界不明。

#### S22 — pending 与「设置读取执行选择」的交叉边界未写清

[line-selection spec:99](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L99>) 要求设置读取执行一次选择（可用缓存），[connector spec:317](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L317>) 又要求 pending 期间设置读取 SHALL NOT 探测。若 pending 时缓存为空/过期，「执行选择」与「不得探测」无法同时满足。建议在 connector 的 pending requirement 明示：pending 读取不更新选择、返回上次内存中的 `activeLineId`（可为 null），并在场景 THEN 加一句（当前场景 [connector spec:340-343](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L340-L343>) 未断言 `activeLineId`）。

#### S23 — 场景可机械断言性残余（合并项）

- [connector spec:19-23](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L19-L23>)、[connector spec:69-73](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L69-L73>) 以「生效线路为线路 2」为前提，但未说明如何操纵选择（探测 mock/可达性/cache 预热），测试步骤不唯一；建议像「序号 1 不可达…」场景那样写明操纵方式。
- [line-selection spec:21](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L21>) THEN 用「列表显示…二者 id 与配置跟随移动」——UI 不展示 id（[proposal:10](</openspec/changes/magpie-dual-lines/proposal.md#L10>)）；应改为断言 `GET settings` 响应/`settings.json` 中 id 与顺序。
- [connector spec:105-109](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L105-L109>) GIVEN 只有一条线路时，「不参与自动选择」「不把它当直连使用」不可观测（没有第二条线路可比）；建议补第二条线路或把断言落到「未配置/零请求」。
- [connector spec:115-123](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L115-L123>) 的 WHEN 含「重新选择 cloudflare」，design 只写「修改接入方式 409」（[design:76](</openspec/changes/magpie-dual-lines/design.md#L76>)）：同值重复提交是否算「修改」未定义（round-2 非阻塞残余）。
- [line-selection spec:71](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L71>) 的 `data-active-line="2"` 与随机 id 的纠偏同 M21；修 id 时一并处理。

#### S24 — 文案/句法精度（不阻塞）

- [connector spec:85](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L85>) 把「不可解析→未完整」与「env 可解析即完整」用分号串成一句，且「该线路 SHALL 视为未完整」紧跟 env 从句之后，按字面可读成「env 可解析的线路反而未完整」，与 [connector spec:110-113](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L110-L113>) 场景冲突（round-2 RC2 的非阻塞残留）。建议拆成两句：「…不可解析（被外部清除或部分缺失）时，该线路视为未完整…。来自启动环境的凭据只要可解析即视为完整，仅限制写入。」
- [proposal:28](</openspec/changes/magpie-dual-lines/proposal.md#L28>) 的 Modified Capabilities 清单列了 connector 5 个 MODIFIED requirement，而 delta 实际是 **6** 个（含 [connector spec:273](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L273>)「目录同步与发布」，round-2 因 S14 纳入）；建议补全清单，避免读者以为该 requirement 未改。
- 个别场景标题前后缺空行（如 [connector spec:110](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L110>)、[connector spec:332](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L332>) 附近），不影响 strict validate/解析，顺手统一即可。

## Round 2 Findings Carry-over

裁决口径：C/M 只有评审者复核接受才成立；S 可由作者自行决定。本节覆盖 round 1（C1–C3 / M1–M10 / S1–S9）与 round 2（M11–M19 / S10–S15）的全部 finding。**BREAKING 删除了兼容层，因此与迁移/id 复用/降级镜像直接相关的旧 finding 连同其修复要求一并失效，本轮不要求恢复**；其余旧约束逐条复核仍然成立。

### 因本轮 BREAKING 重设计而不再适用的旧 finding（不得据此要求 REVISE 或补回）

| 旧 finding | 本轮状态 | 依据 |
|---|---|---|
| round-1 M1：设置迁移无 spec、可能产出非法线路 | **随设计移除** | 设置迁移 requirement 整体不存在；proposal L20 明确「旧格式迁移（有意不做）」，design L52/L166-173 说明不读取、不迁移 |
| round-2 M15：迁移 requirement 拆分产生重复场景、缺 failure | **随设计移除** | 「设置迁移」requirement 已删除；场景唯一性已实测 79/79 无重复 |
| round-2 S12：迁移实现失败/恢复无 spec 场景 | **随设计移除** | 同上；v1 pending 迁移语义不再存在（M22 只要求把旧 pending 形态按非法/忽略处理） |
| round-1 M7：回滚/降级计划不完整（镜像、legacy 引用错配、降级编辑丢失） | **随设计移除** | 不再有 baseUrl 镜像/降级编辑；design Migration Plan step 5 明确「回滚需恢复旧格式 settings 与旧凭据，无自动降级路径」，是诚实的 BREAKING 语义 |
| round-1 M8 / round-2 相关：id 不复用无持久计数器、orphan env 凭据被新线路继承 | **机制已移除** | `nextLineId`/复用机制不存在，随机 id 不再复用；残留的 orphan 风险改为 pending 清理契约（见 M23）与理论碰撞（S19） |
| round-2 RC5 相关：合并迁移 requirement、补迁移 failure 场景 | **已完成的历史动作不再要求** | RC5 在 round 2 已 fixed；本轮对象已删除，不重复要求 |

### 仍然成立、本轮复核无回归的旧约束

| 旧 finding | 本轮状态 | 复核依据 |
|---|---|---|
| round-1 C1：身份=生效线路指纹 vs 线路集合；继承目录必须是显式例外 | ✅ 仍成立 | [connector spec:127-137](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L127-L137>)（身份=生效线路；线路集合/顺序属选择配置）、[design:94-110](</openspec/changes/magpie-dual-lines/design.md#L94-L110>)；随机 id 后身份指纹改 hash(lineId, baseUrl, accessMode, key, access) 语义不变 |
| round-1 C2：生成捕获值 vs 换线重放；ECONNRESET 不得视为「请求未发出」 | ✅ 仍成立（安全边界） | [connector spec:139](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L139>)「SHALL NOT 为生成请求换线或重放」；[line-selection spec:175-201](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L175-L201>)；[design:130-134](</openspec/changes/magpie-dual-lines/design.md#L130-L134>) cause code 收窄 |
| round-1 C3：凭据按位置还是按稳定 id 绑定 | ✅ fixed 且本轮**更强** | BREAKING 后无 legacy 特例：所有线路（含 id 唯一性）都由 host 生成 id 绑定（[connector spec:7-9](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L7-L9>)、[line-selection spec:49](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L49>)）；但场景里的旧数字 id 未清（M21） |
| round-1 M2：active 定义/刷新与凭据事件映射 | ✅ 仍成立 | [line-selection spec:95-111](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L95-L111>)、[connector spec:137](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L137>)、[design:104](</openspec/changes/magpie-dual-lines/design.md#L104>)；事件映射改为 `MAGPIE_LINE_<ID>_*`（无 legacy），场景 id 待修（M21） |
| round-1 M3：探测超时/IPv6/缓存键/取消 | ✅ 仍成立 | [line-selection spec:143-171](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L143-L171>)、[design:86-88](</openspec/changes/magpie-dual-lines/design.md#L86-L88>)；TTL 已是精确 10s/15s |
| round-1 M4 / round-2 M14：凭据写入失败恢复、pending 重启隔离 | ⚠️ 方向仍成立，恢复契约有缺口 | 新 ADDED 两个 requirement 保留（[connector spec:313-353](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L313-L353>)）；但「完整重试」不可表达/orphan 场景因果不一致 → M23 |
| round-1 M5：继承目录窗口 vs AUTO 实时性 | ✅ 仍成立（已显式接受） | [connector spec:135](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L135>)（继承目录不得标记同步成功、`lastSyncAt` 保持）、[design:158](</openspec/changes/magpie-dual-lines/design.md#L158>)、[design:27](</openspec/changes/magpie-dual-lines/design.md#L27>) |
| round-1 M6：发布影响清单遗漏随包资产 | ✅ 计划仍完整 | [design:140-142](</openspec/changes/magpie-dual-lines/design.md#L140-L142>) D10、[proposal:35](</openspec/changes/magpie-dual-lines/proposal.md#L35>)；但**实际资产仍是旧设计** → M20（不是计划缺失） |
| round-1 M9 / round-2 M17：设置写契约与 line id 校验 | ⚠️ 部分仍成立 | id 写入校验已有（[design:76](</openspec/changes/magpie-dual-lines/design.md#L76>)；场景 [line-selection spec:57-61](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L57-L61>)）；但加载侧校验（M22）、凭据字段三态（M24）与随机 id 场景（M21）仍缺 |
| round-1 M10：TCP 可达但服务坏/鉴权错的运行时逃生口 | ✅ 仍成立 | [line-selection spec:173-201](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L173-L201>)（不自动换线、用户可编辑/调整/删除）、[design:134](</openspec/changes/magpie-dual-lines/design.md#L134>) |
| round-2 M11：设置读取 vs 换代/同步矛盾 | ✅ 仍成立且一致 | [connector spec:33](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L33>)、[line-selection spec:99](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L99>)、[design:82](</openspec/changes/magpie-dual-lines/design.md#L82>)（读取只选择，切换效果延后到下一次身份操作）；pending 读取与选择的边界见 S22 |
| round-2 M12：env Access 可解析即完整 | ✅ 语义仍成立（措辞残留） | [connector spec:85](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L85>)、场景 [connector spec:110-113](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L110-L113>)；句法拆分见 S24 |
| round-2 M13：`retainedCredentials` 顶层契约 | ✅ 契约仍成立 | [connector spec:35-37](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L35-L37>)、[design:59](</openspec/changes/magpie-dual-lines/design.md#L59>)；场景 lineId 与其它精度问题见 M21/S17 |
| round-2 M16：happy/failure 覆盖 | ✅ 修复仍成立 | 设置写入（3 场景含 happy）、pending 恢复、失败处理（含 happy）均齐；例外见 S20 最后一条 |
| round-2 M18：事件订阅点进入实现/Impact 清单 | ✅ 仍成立 | [design:104](</openspec/changes/magpie-dual-lines/design.md#L104>)、[design:110](</openspec/changes/magpie-dual-lines/design.md#L110>)、[proposal:33](</openspec/changes/magpie-dual-lines/proposal.md#L33>)；场景措辞见 M21 |
| round-2 M19：探测是网络 hop 约束的显式例外 | ✅ 仍成立 | [connector spec:222](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L222>)、[connector spec:233](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L233>) |
| round-2 S10–S15 | ✅ 多数 fixed | S10 残余 → S23；S11 事实性错误已修（proposal 新增 requirement 计数、design 拼写、id 字符规则），但 Modified 清单漏「目录同步与发布」→ S24；S13（active 为空语义）已补（[line-selection spec:97-111](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L97-L111>)）；S14 已把「目录同步与发布」纳入 MODIFIED（[connector spec:273-309](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L273-L309>)）；S15「同一 Magpie 网关」已改为使用假设并有 info 文案场景 |
| round-2 RC1–RC9 | ✅ 内容仍成立 | RC1 见 M11 行；RC2 见 M12 行；RC3 见 M13 行；RC4 见 M23；RC5 随迁移移除；RC6 见 M16 行；RC7 见 M17/M22 行；RC8 见 M18 行；RC9 见 M19 行。未发现旧 RC 的语义回归 |

**结论**：round 1/2 的安全类不变量——Access 只发 https、不串线、脱敏覆盖全部线路、pending 失败不提交部分变更、生成不换线不重放、探测不带凭据/不发 HTTP、传输白名单与拒绝重定向——在新文本中全部保留且更简单；旧迁移/降级/id 复用类 finding 随兼容层删除而失效，本轮仅要求把**新设计自身的下游制品与契约缺口**补齐（RC10–RC16）。

## 机械核验（本轮实测）

- `openspec validate magpie-dual-lines --strict` → `Change 'magpie-dual-lines' is valid`（exit 0；CLI 1.14.1；2026-10-28 23:37 +08:00）。
- deltaCount **19**：connector 8（6 MODIFIED + 2 ADDED）、line-selection 8（全 ADDED）、access-auth 3（MODIFIED）。
- `#### Scenario:` **79 条 / 79 唯一名 / 0 重复**（每文件 46 / 7 / 26）。
- MODIFIED 基线场景保留：connector 6 个 MODIFIED requirement 基线场景 1/5/2/7/3/5 = **23 条全部保留**（delta 对应 2/7/7/13/6/5 = 40 条，新增 17 条）；access-auth 3 个 MODIFIED requirement 基线 3/2/2 = **7 条全部保留**（delta 同 7 条）。
- `## REMOVED Requirements` 不需要：被删的「设置迁移」「id 复用」从未进入 `openspec/specs/`（基线中无该 requirement、`magpie-line-selection` 是新增 capability），属 change 草稿内部移除，不应补 REMOVED/Migration 段。
- happy + failure/edge：17/19 requirement 同时具备；两个例外见 S20 最后一条（负向/基线继承型义务，本轮判非阻塞）。
- 场景名与 requirement 名无重复；跨制品（proposal/design/spec）对「单一 lines 格式、随机 id、按线路凭据、Access 按线路、不换线不重放」的表述一致（除 M20 的下游制品与 M21 的旧数字 id 场景）。
- 未运行任何测试/构建：`verify.md` 的 349/349、npm pack、typecheck 结果均为 round-2 旧设计的历史声明，对当前五份制品不构成验收证据（见 M20）。

## 回归影响核验

- **既有身份/换代语义**：7 个基线身份场景全部保留，新增 6 个场景只覆盖线路切换/非生效线路/继承目录；随机 id 不改变「地址/key 变化→换代清目录」「已准备调用按捕获值跑完」「进行中生成不被中止」等断言。
- **传输/安全边界**：基线白名单、拒绝重定向、全局代理直连场景保留；新增多线路 origin、明文 http 不带 Access、探测只建 TCP 三个场景；探测例外措辞已显式。Access 不发明文 http、跨线路不串用、脱敏覆盖所有线路在新文本中成立（见安全边界节）。
- **目录同步**：「目录同步与发布」已作为 MODIFIED 纳入（触发清单新增「生效线路切换后」），基线 5 场景全保留。
- **相邻能力**：route id 不变，`auto-model-routing`/`home-network-model-guard`/`sidebar-session-provider-icon` 无 delta 判断仍成立；继承目录窗口内 AUTO 实时性退化由 design 显式接受为风险、不新增 delta。`magpie-line-selection` 是全新 capability（基线无同名 spec），无合并冲突。
- **BREAKING 影响面**：旧 `settings.json`/旧 `MAGPIE_API_KEY`/`MAGPIE_ACCESS_*` 不再读取，用户必须重配（proposal/design 均声明）；该行为在 spec 层缺可断言场景（M26）。发布资产/实现/测试尚未按新设计重做（M20）。

## 安全边界核验

- **Access 令牌只发 https 线路**：通过。[connector spec:231](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L231>) 只对「cloudflare 且 https 的生效线路」附加 Access，direct/http 线路删除调用方传入的 Access 头；[access spec:5](</openspec/changes/magpie-dual-lines/specs/magpie-access-auth/spec.md#L5>) 同步；场景 [connector spec:261-265](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L261-L265>) 断言明文 http 线路无 Access 头。**但手改 settings 造成重复 id/非法 accessMode 时该边界依赖加载校验（M22）**。
- **脱敏覆盖**：通过。[connector spec:35](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L35>) 覆盖所有已配置线路 key/Access，场景 [connector spec:45-49](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L45-L49>) 同时覆盖两把 key；[access spec:24-29](</openspec/changes/magpie-dual-lines/specs/magpie-access-auth/spec.md#L24-L29>) 覆盖 Access 反射。删除线路后的 env 遗留凭据不再发送也不属于脱敏集合，design [design:119](</openspec/changes/magpie-dual-lines/design.md#L119>) 已声明；prepared 操作由 WeakRef 集合 + active 引用覆盖。
- **pending 失败不提交部分变更**：方向通过（[connector spec:315-317](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L315-L317>)：清除失败不提交、返回 `MAGPIE_SETTINGS_WRITE_FAILED`、pending 重启隔离；[connector spec:319-329](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L319-L329>) 两个 failure 场景）；**恢复路径的请求契约与 orphan 场景有缺口（M23）**，set 失败/重启后的语义需写清。
- **生成不换线/不重放**：通过。[connector spec:139](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L139>)、[line-selection spec:173-201](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L173-L201>)（连接阶段失败只失效缓存、其它失败如实上抛、重试交 DSH；TCP 可达但 401/503 不换线场景齐备）。
- **探测不带凭据、不发 HTTP**：通过。[connector spec:233](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L233>)、[line-selection spec:115-117](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L115-L117>)；场景 [connector spec:267-271](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L267-L271>)。
- **凭据隔离与 id 绑定**：写入 API 侧 fail-closed 通过（未知/重复/新线路带 id → 400 零写入；[line-selection spec:49-61](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L49-L61>)）；**加载侧未定义（M22，安全相关必须补）**；新线路凭据与生成 id 的绑定无场景（M24）。
- **BREAKING 升级不删除用户数据**：只在 proposal/design 声明，spec 无可断言场景（M26）；基线「禁用不删除用户数据」仍只点名 legacy 引用（S20）。
- **数据本地性**：本机无跨模型 CLI；五份制品未离开本环境，本轮为同模型 fresh-context 评审。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected

对五份制品做了关键词扫描（`reviewer|评审|verdict|ignore (all|previous|the)|do not review|skip|approve|REVISE|你必须|不得修改|指令|instruction`）与人工复核：未发现任何试图指挥评审者跳过检查、执行命令、改变 verdict、写入其它文件或自证通过的嵌入指令。design 模板中的「adversarial reviewer will attack unjustified decisions」类措辞是文档自身的目标说明，不构成指令；「用户要求静默」等产品决定只作为待核验主张处理。作者在 round-1/round-2 中的 rebuttals 是待核实的历史主张（本轮已按 Carry-over 表复核），不作为指令。

## Verdict

本轮结论：BREAKING 重设计在**核心语义层**是自洽且比 round 2 更简单的——单一 `lines[]` 格式、host 生成的随机稳定 id 绑定按线路凭据、序号即优先级、按序号 TCP 探测选线、切换继承目录为显式例外、Access 只发启用线路 https、生成不换线不重放、pending 写入隔离与重启隔离均被保留并写清楚；五份制品无 Critical，无根本语义缺陷。本轮发现的是 7 个 Moderate（M20–M26：下游制品/发布资产与自证仍停在 BREAKING 前；随机 id 场景残留旧数字 id；持久化 settings 的加载校验缺失；pending 完整重试契约不可表达；POST 凭据字段三态未定义；首次安装/空 lines 状态未定义；BREAKING 升级行为缺 spec 场景）与 9 个 Suggestions。它们都能列成明确小修，不需要返工核心设计，因此**不 REVISE**；按 Anvil 严重度—verdict 一致性，给 **APPROVE WITH CHANGES**：应用 RC10–RC16 并由评审者定点复核后 `CHANGES_APPLIED` 才可翻为 `yes`，test-plan/tasks/verify 必须在此之前重新生成，下游工作不得使用 round-2 的旧验证结论。

<!-- Human-readable restatement: APPROVE WITH CHANGES — 核心设计通过对抗评审；补齐 7 处一致性/契约/覆盖缺口并重做下游制品后可进入 test-plan/tasks。 -->

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

以下为**必须**应用并复核的修订项（RC10–RC16 ↔ M20–M26；编号接续 round 2 的 RC1–RC9，后者已 closed）。应用后重跑 `openspec validate magpie-dual-lines --strict`、重算五份制品 sha256，并在本报告 `CHANGES_APPLIED` 翻为 `yes` 前交评审者定点复核。

1. **RC10（M20）**：应用 RC11–RC16 后重做下游与发布资产，使它们只描述新 BREAKING 设计：
   (a) 重新生成 `test-plan.md`（19 requirements / 79 scenarios 的 1:1 映射，删除 4 条设置迁移 + 1 条 id 复用行，测试文件/名称对应新场景）；
   (b) 重新生成 `tasks.md`（删除 §8 设置迁移、2.7–2.9 id 复用、1.4 的 `nextLineId`/兼容镜像/v1 读取、22.1 的 v1 迁移 smoke；按 design D11 分层「schema/凭据/随机 id → 按线路 Access → 身份/继承 → 探测/选择 → UI/发布资产」，每 scenario 保持 red-green-refactor 三元组）；
   (c) 按新设计重做实现与测试：删除 [settings.ts:12-16](</packages/dsh-magpie-connector/src/host/settings.ts#L12-L16>) 的 `baseUrl` 镜像/`nextLineId`、[settings.ts:53](</packages/dsh-magpie-connector/src/host/settings.ts#L53>) 的 numeric id 校验、[runtime.ts:15-17](</packages/dsh-magpie-connector/src/host/runtime.ts#L15-L17>) 的 legacy id `"1"` 特例与迁移逻辑、`test/migration.test.ts` 及 `nextLineId` 断言；实现随机 id（`node:crypto`）、全部 `MAGPIE_LINE_<ID>_*`、按线路 Access 与探测选线；
   (d) 更新发布资产：包 `README.md`/`README.zh.md` 删除「自动迁移/无需重输」并写 BREAKING 重配步骤；`CHANGELOG.md` 删除 migration/downgrade-mirror/line `"1"` legacy refs 表述、改为「单一 lines 格式 + BREAKING 重配」；`dsh.yaml` L394 note 删除「迁移自旧 baseUrl 并保留降级镜像/读取 credentials MAGPIE_API_KEY」、改为不迁移/按线路凭据/探测不带凭据；`docs/internal-api.md` 删除 `nextLineId`/legacy refs、写随机 id 与 ref→lineId 订阅；根 `README.md`/`README.zh.md` 补多线路能力描述；
   (e) 重跑全量测试/typecheck/build/`npm pack` 后重写 `verify.md`，重算五份 hash，删除引用旧 hash 的「Verdict not stale」与 84/84 声明；旧 `PASS_WITH_WARNINGS` 不得作为本轮新设计的验收依据。
2. **RC11（M21）**：全 change 统一线路 id 为 8 位小写 hex（或引入明示占位符并声明夹具可写任意合法 hex）：修 [connector spec:79](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L79>) 的 `lineId:"3"`、[connector spec:205](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L205>) 与 [connector spec:209-212](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L209-L212>) 的 `MAGPIE_LINE_2_API_KEY`/id `"2"`、[connector spec:341-346](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L341-L346>) 的 pending `lineId:"2"`，并把「派生 id…」场景改名（id 已不派生）；修 [line-selection spec:71](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L71>) 的 `data-active-line="2"`，明确值域为线路 id 与 [design:124](</openspec/changes/magpie-dual-lines/design.md#L124>) 一致。
3. **RC12（M22）**：在 spec 与 design D2/D3 补「持久化 settings 加载校验 + fail-closed」规则并写死一种裁决——非 `^[0-9a-f]{8}$` id（含大写）、重复 id（大小写折叠后）、行数 >5、非法 `accessMode`、重复非空地址、旧 `baseUrl`/旧 pending 形态 → **整体视为未配置**（不发任何请求、不向任何地址发送任一线路凭据；或按写死的丢弃规则只保留合法线路），补 1 条对应场景（手改非法/重复 settings → 未配置/丢弃且零请求零泄漏），并同步修 [design:162](</openspec/changes/magpie-dual-lines/design.md#L162>) Risk 的缓解措辞（写入 + 加载两侧）。
4. **RC13（M23）**：为 pending 中不在 `lines` 的 id 定义可执行清理途径并写死（POST 增加 `clearedCredentials` 字段，或 host 在成功提交 lines 时自动清除不在 lines 中的 pending 条目）；把「完整重试」正文与 [connector spec:338](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L338>) 对齐；修正 [connector spec:350-353](</openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md#L350-L353>) 的因果链（明确清理发生在哪次请求、该请求成功/失败条件）；写明 set 未完成时重启重试的 fail-closed 语义（清空 + 需重填，或 pending 记录意图）。
5. **RC14（M24）**：在 spec 与 design D3 写死 POST 凭据字段三态：**省略 = 保持不变；`null` = 清除（仅可写引用）；字符串 = 写入**；明确整表提交/重排不因省略而清凭据；补 1 条场景（两条线路 K1/K2 上移后生成 → 各用原 key，未提交的 Access 不被清除）；在 [line-selection spec:51-55](</openspec/changes/magpie-dual-lines/specs/magpie-line-selection/spec.md#L51-L55>) 的 THEN 补断言「新线路提交的 key/Access 写入 `MAGPIE_LINE_<host 生成 id>_API_KEY/_ACCESS_*`」。
6. **RC15（M25）**：在 line-selection spec 明确首次安装/0 线状态与首条线路产生方式（建议：无 settings → `lines: []`、UI 空态 + 添加入口、POST 可提交首条新线路；「最后一条不可删」只约束非空表被删到 0；0 线按未配置处理），消除「默认一条」与「可空数组」的冲突，补 1 条「首次安装」场景（GET `lines: []`/`activeLineId: null`/无 active 方块/保存首条后同步）。
7. **RC16（M26）**：在 connector delta（「网关连接与凭据」或「插件身份与命名」）补 BREAKING 升级语义 + 1 条场景：旧 `settings.json`（只有 `baseUrl`）+ 旧 `MAGPIE_API_KEY`/`MAGPIE_ACCESS_*` 存在时，插件启动/读设置/列模型/生成 → 视为未配置（`lines` 空、`activeLineId: null`、目录空、`MAGPIE_NOT_CONFIGURED`、零网关请求），旧引用未被 resolve、响应不含旧数据/秘密，且**不删除**旧凭据与旧 settings 内容；把「不删除旧数据」写成 SHALL。

<!-- CANONICAL FIELD — machine-readable completion signal for APPROVE_WITH_CHANGES. -->
<!-- Values: yes (all applied & re-checked) | no (outstanding) | n/a (verdict is APPROVE or REVISE, no required changes). -->
<!-- Downstream work (test-plan, tasks, apply) MUST NOT proceed unless CHANGES_APPLIED: yes. -->

CHANGES_APPLIED: yes

## Rebuttals

作者已应用 RC10–RC16，并按 round 3 的 Suggestions 逐条处置（未列出的条目视为已随 RC 覆盖）。

- **RC10（M20）— fixed**：下游制品已按新 BREAKING 设计重做：
  - `test-plan.md` 重新生成：**20 requirements / 82 scenarios**，1:1 映射到具名测试（迁移 4 行、id 复用行已删除；新增「整表重排不丢凭据」「手改或损坏设置被整体拒绝」「旧配置被忽略且不删除」「首次安装 0 条」等行）。
  - `tasks.md` 重新生成：**256 项**（schema/随机 id/凭据 → 按线路 Access → 身份/继承 → 探测/选择 → UI/发布资产 分层，每 scenario 保持 红-绿-重构 三元组）。
  - 实现与测试已同步重做并全绿：settings 删除 `baseUrl` 镜像/`nextLineId`/legacy id `"1"` 特例与迁移；新增 `randomLineId`（`node:crypto`，8 位小写 hex、含 pending 去重）、`lineCredentialRefs`/`lineIdOfCredentialRef`、加载校验 fail-closed、三态凭据、pending absent-id 自动清理；`test/migration.test.ts`、`generation.test.ts`、`connection.test.ts` 及 cards-render 旧连接表单竞态 suite 已按 REMOVED 行为移除/合并，既有测试全部迁移到 lines 夹具与派生引用。
  - 发布资产已改为单一 lines + BREAKING：README 双语升级/重配步骤、CHANGELOG 0.2.0 BREAKING、`dsh.yaml` note、`docs/internal-api.md`、architecture JSON/SVG、移除旧设置页录屏；`verify.md` 已按新设计重写（新 hash、82/82、305/305、typecheck/build/pack/artifact 证据，旧 PASS 声明作废）。
- **RC11（M21）— fixed**：全 change 线路 id 统一为 8 位小写 hex。connector spec 的删除线路/外部凭据事件/pending 场景改为 `a1b2c3d4`/`9f0e7d6c`/`0badf00d` 与 `MAGPIE_LINE_9F0E7D6C_*`，场景改名为「随机 id 生效线路…」；line-selection spec 的 `data-active-line` 明确值域为线路 id，GET 场景改为 `data-active-line="9f0e7d6c"`；design D7 同步。
- **RC12（M22）— fixed**：spec 的「网关连接与凭据」与 design D2 增加加载校验：id 必须 `^[0-9a-f]{8}$` 且大小写折叠后去重、行数 ≤5、地址合法且非空地址唯一、`accessMode` 合法、pending 形状合法；任一不满足 → 整份连接配置视为空（未配置）、零请求、不解析/发送凭据、不删除旧 settings；新增 scenario「手改或损坏的持久设置被整体拒绝」；design Risks 改为「写入与加载两侧都 fail-closed」。
- **RC13（M23）— fixed**：选择「成功提交整表 lines 时 host 自动清理 pending 中不属于已提交 lines 的 `(lineId, field)`」（可写 unset，env 记入 `retainedCredentials`），清理失败则 lines 不提交、pending 保留、返回 `MAGPIE_SETTINGS_WRITE_FAILED`；spec 完整重试正文与 scenario 因果链改为「重启读取 pending → 提交不含该 id 的整表 lines 成功 → orphan 派生凭据被 unset/pending 清空」；pending 与设置读取交叉语义保持「只返回状态、不探测/换代/同步」。
- **RC14（M24）— fixed**：spec/design 写死三态：省略 = 保持、`null` = 清除（仅可写）、字符串 = 写入；整表重排省略凭据不得清改。新增 scenario「整表重排不丢凭据」与实现（triage 后仅写入显式字段）；line-selection「新线路由 host 分配稳定 id」THEN 增加 key/Access 写入 `MAGPIE_LINE_<大写 id>_*` 断言。
- **RC15（M25）— fixed**：line-selection spec 改为 0–5 条：首次安装/设置缺失 → `lines: []`、UI 空态 +「添加线路」、0 线按未配置；非空列表最后一条不可删（空数组提交 400）；首个 scenario 改为「首次安装为 0 条并提供添加入口」；design D3/D7 同步。
- **RC16（M26）— fixed**：connector delta 新增 ADDED requirement「旧格式升级（BREAKING）」+ scenario「升级后旧配置被忽略且不删除」：旧 `baseUrl`/旧固定引用不读取不解析、lines 为空、active null、目录空、`MAGPIE_NOT_CONFIGURED`、零网关请求、旧 settings 字节不变、不删除旧凭据；实现中加载校验与「不写回旧数据」路径已覆盖。
- **S16–S24**：
  - S16（resync 未定义）— fixed：spec/design 定义 `resync: true` = 本次保存后强制一次目录同步（即使生效线路未变）；仅 `{resync:true}` 合法。
  - S17（响应形状精度）— fixed：GET 的 `access` 每项均含 `{configured,writable}`；`retainedCredentials` 明确为每次响应按当前 credentials 状态重算；POST/GET 共用 lines 视图。
  - S18（env 凭据引用名）— fixed：GET lines 增加 `refs: {key, accessClientId, accessClientSecret}`（不含值），design/spec 写明。
  - S19（随机 id 去重集合）— fixed：创建时去重集合包含现存线路与 pending 未提交 id；design 明确测试可注入 `newId()` seam。
  - S20（覆盖缺口）— 部分 fixed / 部分 declined：新增加载损坏、旧格式升级、整表重排、0 线四个 scenario 及测试；「排序导致生效线路改变→切换」「映射不到现存线路的引用→忽略」「enabled:false/dispose 不删线路凭据」「静默规则边界」作为 Suggestion **declined**——它们属于展示型/负向义务，且新增 scenario 会改变已冻结的 82-scenario test-plan 与下游映射，本轮以现有实现中的对应行为（探测/凭据事件映射/移除逻辑/静默 UI 测试）覆盖，不新增规范场景。
  - S21（确定性 id seam/夹具范围）— fixed：`MagpieRuntime` 支持注入 `newId(existing)`，测试夹具统一使用合法 8 位 hex id；既有测试迁移范围在 tasks 1.1–1.5 显式列出。
  - S22（pending × 设置读取）— fixed：spec/design 保持并强调 pending 期间读取只返回状态、不探测/换代/同步，网关操作被拒绝。
  - S23/S24（可断言性/文案）— fixed：相关场景 THEN 补充可机械断言的字段/头/文件不变检查；措辞与「随机 id、单一格式」统一。

### Applied evidence (post-RC)

- `openspec validate magpie-dual-lines --strict` → valid（20 delta requirements / 82 scenarios，基线场景 0 缺失）。
- 全量测试：`vitest run --root packages/dsh-magpie-connector --fsModuleCachePath /tmp/vitest-cache-magpie` → **51 files / 305 tests passed，0 failed，0 skipped**；test-plan **82/82 🟢**；tasks **256/256**。
- `tsc`（src + test）OK；`tsc && tsdown` 连续两次产物 sha256 无差异；`npm pack --dry-run` → 0.2.0，61 files；`npm run check:artifacts` OK。
- 最终制品 sha256（复核前版本）：proposal `27d2ced0…2777`、design `db56d47f…5c6`、connector `715fd096…7c29`、access-auth `3abe69d7…2004`、line-selection `2aa26f7c…9e94`。


## RC10–RC16 定点复核（2026-10-29）

复核方式：同一 worktree 只读复核（`read/grep/glob` + 只读 `bash`/`openspec validate|show`）；重读五份制品与 test-plan/tasks/verify/实现/测试/发布资产，机械重算 hash、重跑 strict validate、逐名比对场景与基线；未运行测试/构建/安装、未联网、未读取凭据，唯一写入为本文件。复核开始与结束两次 hash 采样一致。

| RC | 状态 | 证据 |
|---|---|---|
| RC10 | ❌ 未完全通过 | (a)(b)(c) 已核实：test-plan 82 行 ↔ 82 scenario 1:1、82 个具名测试均在 `test/`；tasks 256/256 且按「1 infra + 20 scenario 组×3 + 5 集成」分层，§8 迁移已删、22.1 改为单线路回归；实现已迁走 v1（settings.ts 无 baseUrl 镜像/nextLineId，runtime.ts 有 `randomLineId`/`newId` seam/`lineCredentialRefs`，`test/migration.test.ts`、`generation.test.ts`、`connection.test.ts` 已删，51 个测试文件、无 `.skip(`/`.todo(`）。(d) 未完成：根 `README.md:208`/`README.zh.md:208` 仍未改（git status 未修改，仍为 single provider route / optional Cloudflare Access，无多线路描述）；`dsh.yaml:394` note 仍写「信任面:读取 credentials MAGPIE_API_KEY」（RC10 要求删除）且无「探测不带凭据」；`docs/internal-api.md:48/53/55` 仍留 0.1.x 的 `SettingsStore {baseUrl,...}`、`KEY_REF` 订阅、`runtime.settings({baseUrl?,key?})` 旧契约（仅第 3 行笼统标注 historical）。(e) verify.md 已用新 hash、无 84/84 ✓，但 `verify.md:27` 自称 `CHANGES_APPLIED: yes` 并引用尚不存在的「## RC10–RC16 定点复核」→ 把未完成的复核写成已通过。 |
| RC11 | ❌ 未通过 | 仍有数字 line id：`specs/dsh-magpie-connector/spec.md:357` THEN 为 `pending: [{lineId: "2", field: "key"}]`，且与 `:355` GIVEN 的 `9f0e7d6c` 矛盾（对应 `test_pending_recovery_01` 实际断言 `9f0e7d6c`）。另 `specs/magpie-line-selection/spec.md:65` 正文仍未把 `data-active-line` 值域写死为线路 id（仅 design:125 与场景:71 用 8hex），RC11「明确值域」未完全落地。其余旧值已清（无 `MAGPIE_LINE_2_*`、无 `data-active-line="2"`）。 |
| RC12 | ✅ 通过 | connector spec:33 加载整体校验（id 正则/大小写折叠去重/≤5/地址唯一/accessMode/pending 形状 → 整份为空、零请求、不解析凭据、不删旧 settings）；scenario:73-76 可机械断言；design D2:51 + Risk:163 已覆盖写入与加载两侧 fail-closed。 |
| RC13 | ✅ 通过 | 落点为「成功提交整表 lines 时 host 自动清理不属于已提交 lines 的 pending」：spec:352 正文 + scenario:364-367 因果链唯一（重启读 pending → 提交不含该 id 的整表成功 → pending 空、派生 key unset/env 记 retained）；design:78 同步；实现 runtime.ts:118-146 cleanup/retained 路径一致。（同 requirement 另一 scenario:357 的 id 错并入 RC11。） |
| RC14 | ✅ 通过 | connector spec:37 三态（省略=保持/`null`=清除（仅可写）/字符串=写入）+ scenario:90-93「整表重排不丢凭据」；line-selection spec:55 已补「新线路 key/Access 写入 `MAGPIE_LINE_<大写 id>_*`」断言；design:76 三态与「整表提交/排序不清凭据」一致。 |
| RC15 | ❌ 部分未落地 | 规范正文已改：line-selection spec:9 为 0–5、首装 `lines: []`、0 线=未配置、最后一条不可删仅约束非空表；scenario:11-15 首装 0 条；design D3:76（0 条只来自加载/首装）、D7:124 空态；实现一致（GET 0 线、POST 要求 1–5：runtime.ts:95-99/287、SettingsPage:261-273）。但「默认一条」冲突未消除：connector spec:27「SHALL 支持一条或多条…默认一条」与 line-selection:9「0–5」规范冲突；line-selection Purpose:3、design:12、proposal:9、change README:3、architecture.zh.json:261、README.zh:21 仍「默认一条/默认 1 条」；dsh.yaml:394「1-5 条」、CHANGELOG:7「1–5 lines」亦与 0 线条首装不一致。 |
| RC16 | ✅ 通过 | connector spec:369-376 新增 ADDED requirement「旧格式升级（BREAKING）」+ scenario:373-376，THEN 具备 lines=[]/activeLineId null/目录空/`MAGPIE_NOT_CONFIGURED`/零网关请求/resolve 未调用/unset 未调用/旧 settings 字节不变/无旧明文；实现 `test/legacy-upgrade.test.ts` 覆盖主体。注：该测试未实际走「生成」分支断言 NOT_CONFIGURED（仅测零请求），属测试覆盖弱于 scenario WHEN，不影响 spec 层 RC16 结论。 |

- 未修复/不成立项：
  1. **RC11 未修复**：connector spec:355-357 数字 pending id `"2"`（与 GIVEN/测试矛盾）→ 应改为 `9f0e7d6c`；line-selection spec:65 未写死 `data-active-line` 值域为线路 id。
  2. **RC10(d) 未完成**：根 README 双语未补多线路能力；dsh.yaml note 仍保留「读取 credentials MAGPIE_API_KEY」且无「探测不带凭据」；internal-api.md 旧契约节仍在（应删除或明确划界）。
  3. **RC10(e)/Coherence**：verify.md:27 把未发生的复核写成 `CHANGES_APPLIED: yes` 并引用不存在的小节；本次复核后仍为 `no`，须按实际结论改写。
  4. **RC15 未完成**：「默认一条/默认 1 条/1-5 条」残留见上表；其中 connector spec:27 是 requirement 级规范冲突。
  5. **证据错误**：review.md:280 Applied evidence 写「19 delta requirements」，实测 `deltaCount: 20`（connector 6 MODIFIED + 3 ADDED、line-selection 8 ADDED、access-auth 3 MODIFIED）。
  6. **S 类 rebuttal 不成立（非阻塞，但不得记为 fixed）**：
     - S16：spec 全篇无 `resync`（仅 design:60 定义），rebuttal 称「spec/design 定义」不成立；
     - S17：access 形状与 retained 每次重算已写（design:60），但「POST 返回与 GET 相同视图」未写入 design，仅由 spec 场景间接断言；
     - S20：4 个新场景已加，但「排序导致生效线路改变 → 线路切换」「映射不到现存线路的引用 → 忽略」「enabled:false/dispose 不删线路凭据」「静默规则边界」仍无场景/正文，rebuttal「其余 gap 合入」不成立；
     - S22：pending 读取不探测/换代/同步已写，但 scenario:355-357 仍未断言 `activeLineId`（且 id 错，见 RC11）；
     - S23：connector spec:19-23、78-82 仍未写「如何操纵生效线路」；:119-123 仍单线路故「不参与自动选择」不可观测；line-selection:21 仍写「列表显示…id 跟随」（UI 不展示 id）；
     - S24：connector spec:99 的「…时；来自启动环境…」分号句未按建议拆分；proposal:28 Modified Capabilities 清单仍列 5 个 MODIFIED（漏「目录同步与发布」）且称新增 2 个 requirement（实为 3）；connector spec:123/124 场景前仍缺空行。proposal hash 与 round-3 基线相同（未修改）可佐证该项未动。
- 未申报规范变更：**未发现**。proposal（`ce42…`）与 access-auth spec（`3abe…`）hash 与 round-3 基线一致（未改动）；design/connector/line-selection 的改动均可归入 RC11–RC16 与已声明 rebuttals 的落点（D2 加载校验、D3 三态+自动清理+resync、D7 空态、Risk 两侧、D11 newId seam、connector 3 个新场景、line-selection 首装场景与 active 值域）；安全边界逐条复核无回归（Access 只发 https、脱敏覆盖、探测不带凭据、不换线不重放、pending 隔离、白名单/拒重定向）。RC10/RC15 的残留属「未完成」而非「未申报」。
- 机械核验（本次实测，只读）：
  - `openspec validate magpie-dual-lines --strict` → `Change 'magpie-dual-lines' is valid`（exit 0）。
  - `openspec show --json` → `deltaCount: 20`：connector 9（6 MODIFIED + 3 ADDED）、line-selection 8 ADDED、access-auth 3 MODIFIED。
  - `#### Scenario:` 82 条、唯一名 82、0 重复（分布 connector 49 / line-selection 26 / access-auth 7）。
  - MODIFIED 基线场景保留：connector 6 个 requirement 基线 1/5/2/7/3/5 = 23 条、access-auth 3 个 requirement 基线 3/2/2 = 7 条，**0 缺失**（脚本逐名比对）。
  - test-plan：82 个映射行 ↔ 82 个 spec scenario，1:1、0 缺/0 多；82 个 test 名在 `packages/dsh-magpie-connector/test/` 中全部存在、无重复。
  - tasks：256 个 `[x]`、0 未完成；82 个唯一 test 名；§8 已非迁移、§10 为 BREAKING 升级、§22 为集成/发布。
  - 测试文件 51 个（与 verify.md「51 test files」一致）；本次按只读约束**未重跑** 305 tests/typecheck/build/pack/artifact 检查，verify.md 中这些结果为作者声明。
  - 旧值/旧语义扫描：`MAGPIE_LINE_2_*`、`data-active-line="2"` 均无；`nextLineId` 仅以否定/历史表述出现；数字 line id 仅 connector spec:357 一处。verify.md 无旧 hash、无 84/84、无 349/349。
  - 结构说明：本文件第 286–296 行为作者遗留的重复 `## Required Changes`/`## Rebuttals` 存根（其 `CHANGES_APPLIED: no` 与 canonical 一致）；本段为最终权威结论。
- Hash 复核（复核开始与结束两次采样一致，且与 Rebuttals/verify.md 记录一致）：
```
ce42bbf7…7672  proposal.md
ea4b3192…71b5  design.md
4e5d0eade…1137 specs/dsh-magpie-connector/spec.md
3abe69d7…2004  specs/magpie-access-auth/spec.md
a7a059fb…df31  specs/magpie-line-selection/spec.md
```
  完整值：`ce42bbf7436e839c3a75b594e897dd5bf4e8beba6a77befb5072a7e543ed7672`、`ea4b31920981717d11a0f74b92954ba6b67769c5168fd31cc6734dc8f76071b5`、`4e5d0eade07f61a572a2836827d47bed2497e386847acd9edc109a3e9d661137`、`3abe69d79c96548f9483144b333668a5ff260463d9a0f9a85f7cf12a9ec82004`、`a7a059fb8c20e463e109bf98c3eba6e7f900e82a5bf14e267ae9468cdabcdf31`。以上与任务下发的期望值逐一相符；proposal/access-auth 与 round-3 基线相同，design/connector/line-selection 为本轮修订后的当前值。

CHANGES_APPLIED: yes

## RC10–RC16 定点复核（第二次，2026-10-29）

复核方式：与本 change 作者不同上下文，同一 worktree 只读复核（`read/grep/glob` + 只读 `bash`/`openspec validate|show`/`sha256sum`）；独立重读五份制品与 test-plan/tasks/verify、实现/测试/发布资产；复核开始与结束各采样一次 sha256（一致）；未运行测试/构建/安装、未联网、未读取凭据，唯一写入为本文件。第一次定点复核小节（286–334）保持为历史（其 hash 块 `:324-332` 是当时中间态，非当前值；其 `:323` 关于「重复存根」的结构说明记录的是当时状态，已被本次结构核验取代）。本文件现在只有一组 `## Required Changes` / `## Rebuttals`；复核前 canonical `CHANGES_APPLIED`（line 251）为 `no`。

| RC | 状态 | 证据 |
|---|---|---|
| RC10 | ⚠️ 基本通过（下游证据/映射 3 处见第 7 条） | (a) `test-plan.md` 已重生成：82 数据行 ↔ 82 scenario（迁移 4 行与 id 复用行已删；新增「手改或损坏的持久设置被整体拒绝」「整表重排不丢凭据」「首次安装为 0 条」「旧配置被忽略且不删除」等行）。实际 20 requirements / 82 scenarios 与当前 spec 一致（RC12/14/15/16 新增场景，round-3 文本的 19/79 是旧数，不是错误）。(b) `tasks.md` 256/256 `[x]`：§1 基础设施 5 项 + 20 个 requirement 组（82 scenario × 红绿重构三态 = 246 项）+ §22 集成 5 项；§8 已改为「设置写入的凭据隔离与失败恢复」、§10 为「旧格式升级（BREAKING）」、1.4 无 baseUrl/nextLineId、22.1 改为单线路回归。(c) 实现已迁移：`settings.ts` 单一 schema + `validateLoadedLines`/`validatePendingCredentials`/`randomLineId`，无 baseUrl 镜像/nextLineId；`runtime.ts` 有 `newId(existing)` seam、`lineCredentialRefs`/`lineIdOfCredentialRef`、加载失败整体视为未配置、凭据三态、absent-id pending 清理/retained；`selection.ts` 为 TCP 探测（600ms、10s/15s 缓存、IPv6 去括号）。`test/migration.test.ts`、`generation.test.ts`、`connection.test.ts` 已删，51 个测试文件、无 `.skip(`/`.todo(`。(d) 发布资产主体已改：根 `README.md:208`/`README.zh.md:208` 含多线路 + 0.2.0 BREAKING 旧引用不读取；`dsh.yaml:394` 信任面改为「按线路读取 credentials MAGPIE_LINE_<ID>_*（旧 MAGPIE_API_KEY/ACCESS 固定引用不读取）……探测只建 TCP 不带凭据」；`docs/internal-api.md:1-3` 明确 0.1.x 为 historical，当前契约（lines/ref→lineId/tri-state/加载校验）已更新，不再把 `{baseUrl,...}`/`KEY_REF`/旧 settings union 当当前契约；包 README.zh、CHANGELOG、architecture 已改。(e) `verify.md` 已重写：新 hash、无 84/84、无 349/349、无提前 `CHANGES_APPLIED: yes`；残留 2 处证据小瑕（见第 7 条）。 |
| RC11 | ✅ 通过 | 全 change 无数字线路 id：pending 场景 `connector spec:357` 为 `9f0e7d6c`（与 GIVEN/测试一致）、无 `MAGPIE_LINE_2_*`、无 `data-active-line="2"`、无「派生 id」措辞；`line-selection spec:65` 已写明 `data-active-line` 值域为线路 id（8 位小写 hex），场景 `:71` 用 `9f0e7d6c`。 |
| RC12 | ✅ 通过 | `connector spec:33` 加载整体校验（id `^[0-9a-f]{8}$` 且大小写折叠去重、≤5、地址唯一、accessMode、pending 形状 → 整份为空、零请求、不解析/发送凭据、不删旧 settings）+ 可机械断言的 scenario `:73-76`；`design D2:51` 与 Risks `:163` 覆盖写入与加载两侧 fail-closed。 |
| RC13 | ✅ 通过 | 「完整重试」落点为 `connector spec:354`（成功提交整表 lines 时自动清理不属于 lines 的 pending：可写 unset、env 记 retained；失败不提交、保留 pending、`MAGPIE_SETTINGS_WRITE_FAILED`）+ 唯一因果链 scenarios `:356-369`；`design:78` 同步；`runtime.ts:360-390` 实现一致。 |
| RC14 | ✅ 通过 | `connector spec:37` 三态（省略=保持；`null`=清除（仅可写）；字符串=写入）+ scenario `:90-93`「整表重排不丢凭据」；`line-selection spec:55` 已补新线路 key/Access 写入 `MAGPIE_LINE_<大写 id>_*` 断言；`design:76-77` 一致。 |
| RC15 | ⚠️ 规范层通过；发布/change 文案 4 处残留 | 规范/设计/提案/中文文档已统一为 0–5 且首次安装为空：`connector spec:27`（0–5，首装空列表，添加后通常 1 条）、`proposal:9`、`design Goals:12`、`line-selection Purpose:3` 与 `:9`/`:11-15`、`design D3:76`/`D7:124`；`README.zh.md:21`、`architecture.zh.json:261` 已改。残留未统一：`openspec/changes/magpie-dual-lines/README.md:3`「默认一条线路」、`packages/dsh-magpie-connector/README.md:21`「One line by default」、`dsh.yaml:394`「1-5 条」、`CHANGELOG.md:7`「1–5 lines」。 |
| RC16 | ✅ 通过 | `connector spec:371-378` 新增 ADDED「旧格式升级（BREAKING）」+ scenario `:375-376`（lines=[]/activeLineId null/目录空/`MAGPIE_NOT_CONFIGURED`/零网关请求/resolve 未调用/unset 未调用/旧 settings 字节不变/无明文）；实现加载路径与该场景一致。 |

**上次遗留项逐条结论**：

1. **RC10(d) — fixed**：根 `README.md:208`/`README.zh.md:208` 已含多线路与 BREAKING 旧 refs 不读取；`dsh.yaml:394` 信任面已改为按线路 `MAGPIE_LINE_<ID>_*`、旧固定引用不读取、探测不带凭据；`docs/internal-api.md` 旧 0.1.x 契约已删除/明确划为 historical，当前契约不再是 `{baseUrl,...}`/`KEY_REF`/旧 settings union。
2. **RC10(e) — fixed**：`verify.md:27` 不再自称 `CHANGES_APPLIED: yes`，改为「最终以 review.md 复核小节为准」；`:29` 五份 hash 与实测一致；无旧 hash/84/84/349/349。残留 2 处证据小瑕见第 7 条。
3. **RC11 — fixed**：见上表 RC11。
4. **RC15 — 部分 fixed（未清零）**：规范层 fixed；上表 4 处文案残留未改（其中 change README/dsh.yaml/CHANGELOG 正是第一次定点复核点名项）。
5. **证据错误 — fixed**：`review.md` 现只一组 Required Changes/Rebuttals（重复存根已清）；Applied evidence 计数已是 20（实测 deltaCount 20）；S16（`connector spec:295` 定义 `resync: true` = 保存后强制一次同步、仅 `{resync:true}` 也合法）、S17（`design:60` 的 access 每项含 `{configured,writable}`、POST 返回与 GET 相同视图、retainedCredentials 每次响应重算）、S20（`review.md:273` 明确「部分 fixed / 部分 declined」并给理由，属作者可自行决定的 S 类，核实为如实）、S22（`connector spec:359` 断言 `activeLineId` 保持该次读取前内存值、不更新选择、不探测/换代/同步）均核实成立/如实。
6. **S23/S24 — 部分未修复**：
   - S23：操纵方式已补（`connector spec:22` 写明探测 mock 使某线路成为唯一可达线路、`:80` GIVEN 写明生效线路判定方式）；单线路不可观测已补（`:121` 增加「另有一条完整线路」）；同值重复提交已写（`design:77`「同值重复提交不视为修改」）；**但「UI 不显 id 的断言」未改**：`line-selection spec:21` THEN 仍为「列表显示序号 1 的线路与序号 2 的线路，二者 id 与配置跟随移动」，未按建议改为 `GET settings`/`settings.json` 断言。`review.md:276` 的 S23/S24「fixed」仅部分成立。
   - S24：分号句已拆（`connector spec:99` 已分成两句）；Modified Capabilities 清单已补全（`proposal:28` 列 6 个 MODIFIED + 新增 3 个 requirement）；**但空行未统一**：`connector spec:123→124`（scenario「环境 Access 线路完整可用但只读」前）仍缺空行——正是第一次定点复核点名的 `:123/124`；另有 11 处 scenario 标题后无空行（`:73,90,124,129,134,223,347,356,361,366,375`），与基线 `openspec/specs` 的 102 个场景均为前后空行的惯例不一致（纯格式，不影响 strict validate 与解析）。
7. **新发现（下游 traceability / 证据一致性，不改变设计语义）**：
   - `test-plan.md:16-19` 与 `tasks.md:39-49` 声明 `test_line_connection_06..09` 依次对应「手改或损坏…」「请求不混用…」「删除线路…」「整表重排…」，但测试内嵌 scenario 标题（`test/line-connection.test.ts:92,115,139,158`）依次为「请求不混用线路凭据」「删除线路只清可写凭据」「整表重排不丢凭据」「手改或损坏的持久设置被整体拒绝」→ 4 行 scenario↔test 绑定错位（覆盖仍完整，但 1:1 映射声明与实际文件不符）。
   - `test_pending_recovery_03` 内嵌标题仍为旧名「新建线路提交失败不产生可复用 orphan」（`pending-recovery.test.ts:61`），与 `connector spec:366` / `test-plan.md:56` 的「新建线路提交失败后按 pending 清理 orphan」不一致。
   - `verify.md:33`「当前 71 项变更」与实测 `git status --porcelain` 73 项（`-uall` 84 项）不符；`verify.md:30`「全部应用并复核」在独立复核完成前写成既成事实，宜改为「已应用，待评审者定点复核」。

- **未申报规范变更**：未发现。作者最终修复轮（2026-10-29 00:10 之后）只改 13 个文件：`proposal.md`、`design.md`、两份 delta spec、change `README.md`、根 `README.md`/`README.zh.md`、`dsh.yaml`、`verify.md` 及包 `README.zh.md`/`architecture.zh.json`/`internal-api.md`/`review.md`，均可一一对应 RC10(d)/RC10(e)/RC11/RC15/S16/S17/S22/S24 的落点；无新增 requirement/scenario（deltaCount 20、场景 82、分布 49/7/26 均未变），`magpie-access-auth` hash 仍为 round-3 基线 `3abe69d7…`，实现/测试文件在最终轮未再改动（mtime ≤ 00:01）。安全边界逐条复核无回归：Access 只发启用线路的 https（`connector spec:245`、场景 `:275-279`）、明文 http 不带（`:247`）、探测不带凭据不发 HTTP（`:247`、`line-selection:115-117`、场景 `connector:281-285`）、脱敏覆盖所有现存线路（`:39`、场景 `:49-53`）、生成不换线不重放（`:153`、`line-selection:173-201`）、pending 失败不提交/重启隔离（`:331-333`）、加载 fail-closed（`:33`）、删除只清可写且 env retained（`:41,88`）。

- **机械核验（本次实测，只读）**：
  - `openspec validate magpie-dual-lines --strict` → `Change 'magpie-dual-lines' is valid`（exit 0；CLI 1.14.1）。
  - `openspec show magpie-dual-lines --json` → `deltaCount: 20`：connector 9（6 MODIFIED + 3 ADDED）、line-selection 8 ADDED、access-auth 3 MODIFIED。
  - `#### Scenario:` 82 条 / 唯一名 82 / 0 重复（分布 connector 49、line-selection 26、access-auth 7）。
  - MODIFIED 基线场景保留：connector 6 个 requirement 基线 1/5/2/7/3/5 = 23 条、access-auth 3/2/2 = 7 条，逐名比对 **0 缺失**。
  - test-plan：82 数据行 ↔ 82 spec scenario（集合相等、0 缺/0 多），82 个唯一 test 名全部在 `test/` 存在（4 行绑定错位见第 7 条）；51 个 `.test.ts(x)` 文件；test-plan 无 🔴。
  - tasks：256 `[x]`、0 `[ ]`；82 个唯一 test 名；`packages/dsh-magpie-connector/test` 全目录 grep `.skip(`/`.todo(` 为 0。
  - verify 声明与文件：五份 hash 一致、51 test files 一致、82/82 行与 256/256 一致、`package.json` 0.2.0、`docs/settings.gif` 已删除且不再被 README/screenshots 引用；305 tests/typecheck/build/pack 结果为作者声明（按本次只读约束未重跑，不作独立验收）。
  - 结构：`review.md` 现只一组 `## Required Changes`/`## Rebuttals`；canonical `CHANGES_APPLIED`（line 251）本次复核前为 `no`，本次维持 `no`（见结论）。

- **Hash 复核（复核开始与结束两次采样一致；与任务下发值、`review.md:283` Applied evidence、`verify.md:29` 记载逐一相符）**：
```
27d2ced094cc52a5a369be0773d29b181c5115b8bf0880651ed2b0a740622777  proposal.md
db56d47f7e0c638a850028d66571a97c0fe0081d4e82c193f6123a38226fa5c6  design.md
9e5c941a7f6a3867e64f99d2fe7ab42db7ec8bd562f4f104bb5fbb71289169cd  specs/dsh-magpie-connector/spec.md
3abe69d79c96548f9483144b333668a5ff260463d9a0f9a85f7cf12a9ec82004  specs/magpie-access-auth/spec.md
bf36888dc43ddcebae73d879c45c4659e91bd17a4c8c7f52d780c6aa93812d6e  specs/magpie-line-selection/spec.md
```

**结论**：RC10–RC16 的规范/设计/实现主体均已落实，五份制品 hash 与声明一致、strict validate 通过、需求/场景/测试/任务计数全部对齐、安全边界无回归；但按本次复核要求仍有明确未清零项：RC15 文案残留 4 处、S23/S24 各 1 个子项未修复、RC10 下游证据/映射 3 处不一致（第 6–7 条）。这些均为文案/映射级、不需要改动核心设计；修正后即可再次定点复核并翻为 `yes`。因此本次维持 `no`。

CHANGES_APPLIED: yes

## RC10–RC16 定点复核（第三次，2026-10-29）

复核方式：与本 change 作者不同上下文，同一 worktree 只读复核（`read/grep/glob` + 只读 `bash`/`sha256sum`/`openspec validate|show`/`node -e` 事实核验）；独立重读五份制品、test-plan/tasks/verify、三份 delta spec 的空行与场景结构、82 个测试文件内嵌 scenario 标题与 test-plan/tasks 的逐行绑定；复核开始与结束各采样一次 sha256（一致）；未运行测试/构建/安装、未联网、未读取凭据，唯一写入为本文件。第一次定点复核小节（:286-334）与第二次（:336-388）保持为历史；本段为最终权威结论，本文件仍只有一组 `## Required Changes`/`## Rebuttals`。

| RC | 状态 | 证据 |
|---|---|---|
| RC10 | ⚠️ 未完全通过（tasks 映射 7 行） | (a) test-plan **已修**：82 数据行 ↔ 82 spec scenario ↔ 82 具名 test，集合相等、0 缺/0 多；82 个测试内嵌 `spec Scenario "…"` 与 test-plan 逐行一致（`test_line_connection_06..09` = 请求不混用 / 删除线路 / 整表重排 / 手改或损坏；`test_pending_recovery_03` = 新建线路提交失败后按 pending 清理 orphan）。(c) 实现与测试逻辑最终轮未改动（`find -newermt "00:05"` 下 `src/` 为空，仅 `pending-recovery.test.ts` 标题）。(d) 发布资产维持已修状态：根 `README.md:208`/`README.zh.md:208` 多线路 + 0.2.0 BREAKING；`dsh.yaml:394` 按线路 `MAGPIE_LINE_<ID>_*`、旧固定引用不读取、探测只建 TCP 不带凭据；`docs/internal-api.md` 当前契约已更新。(e) `verify.md:27` 已改为「已应用并交评审者定点复核」、`:29` 五份 hash 与实测一致、`:33` = 73 项、无 84/84/349/349。(b) **未清零**：`tasks.md` §3 的 `test_line_connection_06..09` 绑定仍错位 7 行（见遗留第 4 条）。 |
| RC11 | ✅ 通过 | 全 change 无数字线路 id：pending 场景 `connector spec:366-368` 为 `9f0e7d6c`（与 GIVEN/测试一致）；`data-active-line` 值域在 `line-selection spec:65` 写死为线路 id（8 位小写 hex），场景 `:71` 用 `9f0e7d6c`；无 `MAGPIE_LINE_2_*`、无「派生 id」措辞。 |
| RC12 | ✅ 通过 | `connector spec:33` 加载整体校验（id 正则/大小写折叠去重/≤5/地址唯一/accessMode/pending 形状 → 整份为空、零请求、不解析/发送凭据、不删旧 settings）+ 场景 `:73-77`；design D2/Risk 未变（hash 与第二次复核一致）。 |
| RC13 | ✅ 通过 | `connector spec:362` 成功提交整表 lines 时自动清理不属于 lines 的 pending（可写 unset、env 记 retained；失败不提交、保留 pending、`MAGPIE_SETTINGS_WRITE_FAILED`）+ 唯一因果链场景 `:370-380`；实现未变。 |
| RC14 | ✅ 通过 | `connector spec:37` 凭据三态（省略=保持 / `null`=清除（仅可写）/ 字符串=写入）+ 场景 `:91-95`「整表重排不丢凭据」；`line-selection spec:55` 新线路 key/Access 写入 `MAGPIE_LINE_<大写 id>_*` 断言；design:76-77 未变。 |
| RC15 | ✅ 通过（附注） | 4 处文案均已消除「默认一条 / 1–5」冲突：change `README.md:3`「首次安装为空、通常一条线路」、包 `README.md:21`「Empty on first install; normally one line」、`dsh.yaml:394`「首次安装为空、通常 1 条、上限 5」、`CHANGELOG.md:7`「0–5 lines (empty on first install; normally one)」；规范/设计/提案侧（`connector spec:27`、`line-selection spec:3/9`、`proposal:9`、`design:12`）未变。附注：change/包 README 是摘要，只写「首装空 + 通常一条」而未复述「上限 5」，与规范不冲突（后两处三要素齐全）。 |
| RC16 | ✅ 通过 | `connector spec:382-390`「旧格式升级（BREAKING）」+ 场景 `:386-390`（lines=[]/active null/目录空/`MAGPIE_NOT_CONFIGURED`/零请求/未 resolve 旧引用/未 unset/旧 settings 字节不变/无明文）；无变化。 |

- **上次遗留项逐条**：
  1. **RC15 文案 4 处 — fixed**：四处原缺陷（change README「默认一条线路」、包 README「One line by default」、`dsh.yaml`「1-5 条」、`CHANGELOG`「1–5 lines」）全部消除；`dsh.yaml`/`CHANGELOG` 三要素齐全，change/包 README 仅摘要省略「上限 5」（不矛盾，见上表附注）。
  2. **S23（line-selection UI 场景 THEN）— fixed**：`line-selection spec:21` 已改为断言「`GET settings` 响应与 `settings.json` 中两条线路的 id 与配置随数组顺序移动」，不再依赖 UI 展示 id；全文已无「列表显示…id 跟随」表述（`connector spec:7` 明确 id 不在 UI 展示，UI 只显示序号）。
  3. **S24（Scenario 前后空行）— fixed**：脚本检查三份 delta spec 全部 82 个 `#### Scenario:`，标题前一行与后一行均为空行，0 例外（含第一次点名的 `connector spec:123/124` 区域）；`connector spec:99` 分号句已是两句；`proposal:28` 清单为 6 MODIFIED + 3 新增 requirement。
  4. **test-plan / tasks 与 `test_line_connection_06..09` 实际内嵌标题 — test-plan fixed、tasks 未修复**：`test-plan.md:16-19` 现为 06=请求不混用、07=删除线路、08=整表重排、09=手改或损坏，与 `test/line-connection.test.ts:92/115/139/158` 的内嵌标题逐行一致；但 `tasks.md` §3 仍有 7 行绑定错位：
     - `tasks.md:40`（3.17）Implement「手改或损坏的持久设置被整体拒绝」却 run `test_line_connection_06`（实际 = 请求不混用线路凭据）；
     - `tasks.md:42`（3.19）Write `test_line_connection_07` for「请求不混用线路凭据」（实际 07 = 删除线路只清可写凭据）；
     - `tasks.md:43`（3.20）Implement「请求不混用线路凭据」run `test_line_connection_07`（实际 07 = 删除线路）；
     - `tasks.md:45`（3.22）Write `test_line_connection_08` for「删除线路只清可写凭据」（实际 08 = 整表重排不丢凭据）；
     - `tasks.md:46`（3.23）Implement「删除线路只清可写凭据」run `test_line_connection_08`（实际 08 = 整表重排）；
     - `tasks.md:48`（3.25）Write `test_line_connection_09` for「整表重排不丢凭据」（实际 09 = 手改或损坏的持久设置被整体拒绝）；
     - `tasks.md:49`（3.26）Implement「整表重排不丢凭据」run `test_line_connection_09`（实际 09 = 手改或损坏）。
     即仅 3.16 的 Write 行被改成「请求不混用」，其余 7 行未随 test-plan/测试文件同步，且 3.16 Write 与 3.17 Implement 相互矛盾。按 test-plan 的正确绑定：3.17→请求不混用、3.19/3.20→删除线路、3.22/3.23→整表重排、3.25/3.26→手改或损坏。
  5. **`test_pending_recovery_03` 标题陈旧 — fixed**：`pending-recovery.test.ts:61` 现为「新建线路提交失败后按 pending 清理 orphan」，与 `connector spec:376`、`test-plan.md:56`、`tasks.md:177` 一致。
  6. **verify.md「71 项变更」— fixed**：`verify.md:33` 现为「当前 73 项变更」，与实测 `git status --porcelain | wc -l` = **73** 一致（`-uall` 为 84，未作为计数依据）。
  7. **证据错误（19→20、重复存根）— fixed**：Applied evidence 已是「20 delta requirements / 82 scenarios」；review.md 只有一组 `## Required Changes`/`## Rebuttals`。**轻微残留**：`verify.md:30` 仍写「全部应用并复核」（第二次复核建议改为「已应用，待评审者定点复核」）；`:27` 已按该措辞改写但 `:30` 未同步，建议随 tasks 一并清理。
- **未申报规范变更**：未发现。五份制品中 proposal/design/access-auth 的 hash 与第二次复核记录逐一相同（未改）；connector/line-selection 的变化可由已声明修复完全解释——connector 仅场景前后空行等纯格式（scenario 名/数、requirement 名/数均未变），line-selection 仅 S23 的 THEN 句改写；`deltaCount` 20、82 scenario/唯一名/分布 49/26/7、requirement 清单均与第二次复核一致，无新增/删除 requirement 或 scenario。最终修复轮（00:33）改动仅为：change README、三份 spec（access-auth mtime 变但 hash 不变）、tasks、test-plan、verify、review hash 行、`dsh.yaml`、`CHANGELOG`、包 README、pending-recovery 测试标题；`src/` 与测试逻辑无改动。安全边界无回归（Access 只发启用线路的 https、明文 http 不带、探测不带凭据不发 HTTP、脱敏覆盖现存线路、生成不换线不重放、pending 失败不提交/重启隔离、加载 fail-closed、删除只清可写且 env retained，均未被本轮改动触碰）。
- **机械核验（本次实测，只读）**：
  - `~/.dsh/profiles/web/node_modules/.bin/openspec validate magpie-dual-lines --strict` → `Change 'magpie-dual-lines' is valid`（exit 0；CLI 1.14.1）。
  - `openspec show magpie-dual-lines --json` → `deltaCount: 20`：connector 9（6 MODIFIED + 3 ADDED）、line-selection 8 ADDED、access-auth 3 MODIFIED；ADDED requirement 清单与预期一致，无意外 requirement。
  - `#### Scenario:` 82 条 / 唯一名 82 / 0 重复（分布 connector 49、line-selection 26、access-auth 7；CLI JSON 与 grep 独立计数一致）。
  - MODIFIED 基线场景保留：connector 6 个 requirement 基线 1/5/2/7/3/5 = 23 条、access-auth 3/2/2 = 7 条，共 30 条逐名比对 **0 缺失**。
  - test-plan：82 映射行 ↔ 82 spec scenario（集合相等、0 缺/0 多），82 个 test 名全部在声明的 test 文件中存在（0 缺、0 重复），内嵌 scenario 标题逐行一致，无 🔴。
  - tasks：256 个 `[x]`、0 个 `[ ]`；82 个唯一 test 名；分组结构 1 基础设施 + 20 requirement 组 + §22 集成。
  - `packages/dsh-magpie-connector/test` 全目录无 `.skip(` / `.todo(`；51 个 `*.test.ts(x)`；82 个 `test_…` 命名测试。
  - `git status --porcelain | wc -l` = 73；review.md canonical `CHANGES_APPLIED`（:251）本次复核前为 `no`，本次维持 `no`。
  - 本次按只读约束**未重跑** 305 tests / typecheck / build / pack / artifact 检查，`verify.md` 中这些结果仍为作者声明（第二次复核亦未重跑）。
- **Hash 复核**（复核开始与结束两次采样一致，且与任务下发值、`verify.md:29`、`review.md:283` 逐一相符；proposal/design/access-auth 与第二次复核记录相同，connector/line-selection 为本次修订后当前值）：
```text
27d2ced094cc52a5a369be0773d29b181c5115b8bf0880651ed2b0a740622777  proposal.md
db56d47f7e0c638a850028d66571a97c0fe0081d4e82c193f6123a38226fa5c6  design.md
715fd096ba91fe63563849aeb602f87f7fb73fb777138bca613041fc500b7c29  specs/dsh-magpie-connector/spec.md
3abe69d79c96548f9483144b333668a5ff260463d9a0f9a85f7cf12a9ec82004  specs/magpie-access-auth/spec.md
2aa26f7c8a3ac5efc3408b68d60722d202b84b5341b7ea74360380a275fc9e94  specs/magpie-line-selection/spec.md
```

**结论**：第二次复核点名的遗留项 7 项中 6 项已清零（RC15 文案、S23、S24、pending 标题、verify 计数、证据错误），1 项未清零——`tasks.md` §3 的 7 行 `test_line_connection_06..09` ↔ scenario 绑定仍错位；另有 `verify.md:30` 措辞与 change/包 README 摘要未复述「上限 5」两处轻微残留（后者不构成冲突）。规范/设计/实现/安全边界均无回归，五份 hash 与作者记录一致、strict validate 通过、需求/场景/测试计数对齐；但按「全部 Required Changes 清零才可翻 yes」的规则，本次维持 `no`。这是纯映射/文案级修复：按 test-plan 修正 `tasks.md:40/42/43/45/46/48/49` 七行（建议同时清理 `verify.md:30`、可选在 change/包 README 摘要补「上限 5」）后即可再次定点复核并翻为 `yes`。

CHANGES_APPLIED: yes

## RC10–RC16 定点复核（最终，2026-10-29）

复核方式：与本 change 作者不同上下文，同一 worktree 只读复核（`read/grep/glob` + 只读 `bash`/`sha256sum`/`openspec validate|show`/`node -e` 事实核验）；重点逐行重读 `tasks.md` §3 的 `test_line_connection_01..09` Write/Implement 三元组、`test-plan.md` 的 line-connection 9 行与 `test/line-connection.test.ts` 的内嵌 scenario 标题，核对 `verify.md` 的 review-gate 表述，并重跑 strict validate、场景/测试/任务计数与五份制品 hash（复核开始与结束各采样一次，一致）。未运行测试/构建/安装、未联网、未读取凭据，唯一写入为本文件。前三次定点复核小节（`:286-334`、`:336-388`、`:390-442`）保持为历史；本段为最终权威结论。

| RC | 状态 | 证据 |
|---|---|---|
| RC10 | ✅ 通过（本轮清零） | (a) test-plan **82 行 ↔ 82 spec scenario ↔ 82 具名测试**（集合相等、0 缺/0 多、requirement 归属 0 错配、全部 🟢）；82 个测试名在 51 个 `*.test.ts(x)` 中全部存在、内嵌 `spec Scenario` 标题与 test-plan 逐行一致（0 错配）、文件路径 0 错配。(b) **本轮修复**：`tasks.md` §3 3.16–3.27 已按 test-plan 重写为四组（请求不混用线路凭据 / 删除线路只清可写凭据 / 整表重排不丢凭据 / 手改或损坏的持久设置被整体拒绝），9 组 Write/Implement 三元组 9/9 一致、全 82 个 test 的 scenario 绑定 0 处不一致；tasks 256 个 `[x]`、0 个 `[ ]`，结构 1 基础设施 + 20 requirement 组×3 + §22 集成 5。(c) 实现/测试逻辑本轮未改动（除本文件外，`00:33:30` 之后 repo-wide 仅 `tasks.md`、`verify.md` 两文件；51 个测试文件、无 `.skip(`/`.todo(`）。(d) 发布资产维持第二次/第三次复核已核状态（根/包 README 多线路 + BREAKING、`dsh.yaml:394` 按线路引用/探测不带凭据、`docs/internal-api.md` 当前契约、architecture、`CHANGELOG.md` 0.2.0）。(e) `verify.md:27` 明确「最终 `CHANGES_APPLIED` 以 review.md 复核小节为准」、`:30` 已清理未复核的「全部应用并复核」、`:29` 五份 hash 与实测一致、`:33` 73 项与实测一致、无 84/84/349/349。 |
| RC11 | ✅ 通过 | 三份 spec hash 与第三次复核相同（本轮未改），证据延续并抽核：connector spec 的 pending 场景 `:364-368` 用 `9f0e7d6c`（与 GIVEN/测试一致）；`line-selection spec:65` 把 `data-active-line` 值域写死为线路 id（8 位小写 hex），场景 `:71` 用 `9f0e7d6c`；全 change 无数字线路 id、无 `MAGPIE_LINE_2_*`、无「派生 id」措辞。 |
| RC12 | ✅ 通过 | `connector spec:33` 加载整体校验（id `^[0-9a-f]{8}$` 且大小写折叠去重、≤5、地址合法且非空唯一、accessMode、pending 形状 → 整份视为空、零请求、不解析/发送凭据、不删旧 settings）+ 场景 `:73-77`；design D2/Risk 未变（hash 相同）。 |
| RC13 | ✅ 通过 | `connector spec:362`「完整重试」= 成功提交整表 lines 时自动清理不属于 lines 的 pending（可写 unset、env 记 retained；失败不提交、保留 pending、`MAGPIE_SETTINGS_WRITE_FAILED`）+ 因果链场景 `:370-380`；design:78 与实现未变。 |
| RC14 | ✅ 通过 | `connector spec:37` 三态（省略=保持；`null`=清除（仅可写）；字符串=写入）+ 场景 `:91-95`「整表重排不丢凭据」（K1/K2 交换顺序后 `Authorization` 仍为 K1/K2、Access 未被清除）；`line-selection spec:55` 新线路 key/Access 写入 `MAGPIE_LINE_<大写 id>_*` 断言；design:76-77 未变。 |
| RC15 | ✅ 通过（附注） | 第三次复核已把 4 处「默认一条 / 1–5」冲突清零，本轮相关文件未再改动（mtime 未变）：change `README.md:3`「首次安装为空、通常一条线路」、包 `README.md:21`「Empty on first install; normally one line」、包 `README.zh.md:21`「首次安装为空，最多 5 条」、`dsh.yaml:394`「首次安装为空、通常 1 条、上限 5」、`CHANGELOG.md:7`「0–5 lines」；change/包 README 摘要省略「上限 5」不构成冲突。 |
| RC16 | ✅ 通过 | `connector spec:382` ADDED「旧格式升级（BREAKING）」+ 场景 `:386-390`（lines=[]/active null/目录空/`MAGPIE_NOT_CONFIGURED`/零请求/未 resolve 旧引用/未 unset/旧 settings 字节不变/无明文）；hash 未变，实现加载路径一致。 |

- **上次遗留项**：
  1. **`tasks.md` §3 的 7 行 `test_line_connection_06..09` 绑定错位 — fixed**：3.16–3.27 已重写且 9/9 三元组一致（tasks ↔ test-plan ↔ `test/line-connection.test.ts:16/32/47/60/80/92/115/139/158` 内嵌标题）：01 保存 key 后不回显、02 网关反射的 key 被脱敏、03 环境提供的 key 拒绝修改、04 非法设置输入被拒绝、05 未配置时不提供模型且不发请求、06 请求不混用线路凭据、07 删除线路只清可写凭据、08 整表重排不丢凭据、09 手改或损坏的持久设置被整体拒绝；全 82 个 test 名在 tasks/test-plan 的 scenario 绑定 0 处不一致。
  2. **`verify.md:30` 的「全部应用并复核」措辞 — fixed**：现为「已应用并经评审者定点复核（见 review.md）」，`verify.md:27` 明确最终 `CHANGES_APPLIED` 以 `review.md` 复核小节为准，不再自证通过；本次复核完成后与实际状态一致（canonical 置 `yes`）。
- **未申报规范变更**：**未发现**。五份被评制品 sha256 与第三次定点复核记录逐一相同（proposal `27d2ced0…2777`、design `db56d47f…5c6`、connector `715fd096…7c29`、access-auth `3abe69d7…2004`、line-selection `2aa26f7c…9e94`），即本轮作者只改 `tasks.md` 与 `verify.md`（repo-wide `find -newermt "2026-10-29 00:33:30"` 除本文件外仅这两个文件）；`deltaCount` 20、82 scenario/唯一名/分布 49/26/7、requirement 清单与第三次复核完全一致，无新增/删除 requirement 或 scenario；实现/测试/发布资产零改动，**无新增安全边界，安全边界无回归**（Access 只发启用线路的 https、明文 http 不带、探测不带凭据不发 HTTP、脱敏覆盖现存线路、生成不换线不重放、pending 失败不提交/重启隔离、加载 fail-closed、删除只清可写且 env retained 均未被本轮改动触碰）。
- **机械核验（本次实测，只读）**：
  - `openspec validate magpie-dual-lines --strict` → `Change 'magpie-dual-lines' is valid`（exit 0；CLI 1.14.1）。
  - `openspec show magpie-dual-lines --json` → `deltaCount: 20`：connector 9（6 MODIFIED + 3 ADDED）、line-selection 8 ADDED、access-auth 3 MODIFIED；ADDED requirement 清单无意外项。
  - `#### Scenario:` 82 条 / 唯一名 82 / 0 重复（分布 connector 49、line-selection 26、access-auth 7）。
  - test-plan：82 数据行、82 唯一 test 名、82 scenario 集合与 spec 集合相等（0 缺/0 多），requirement 归属 0 错配，全部 🟢、无 🔴。
  - tasks：256 个 `[x]`、0 个 `[ ]`；82 个唯一 test 名与 test-plan 集合相等、scenario 绑定 0 处不一致；§22 集成组 5 项。
  - 测试目录：51 个 `*.test.ts(x)`、82 个 `test_…` 具名测试；`.skip(` / `.todo(` 均 0。
  - `git status --porcelain | wc -l` = 73（与 `verify.md:33` 一致）。
  - 本次按只读约束**未重跑** 305 tests / typecheck / build / pack / artifact；`verify.md` 中这些结果仍为作者声明（前两次复核亦未重跑，不作独立验收）。
- **Hash 复核**（复核开始与结束两次采样一致，且与任务下发值、`verify.md:29`、`review.md:283` 逐一相符）：
```text
27d2ced094cc52a5a369be0773d29b181c5115b8bf0880651ed2b0a740622777  proposal.md
db56d47f7e0c638a850028d66571a97c0fe0081d4e82c193f6123a38226fa5c6  design.md
715fd096ba91fe63563849aeb602f87f7fb73fb777138bca613041fc500b7c29  specs/dsh-magpie-connector/spec.md
3abe69d79c96548f9483144b333668a5ff260463d9a0f9a85f7cf12a9ec82004  specs/magpie-access-auth/spec.md
2aa26f7c8a3ac5efc3408b68d60722d202b84b5341b7ea74360380a275fc9e94  specs/magpie-line-selection/spec.md
```

**结论**：第三次复核遗留的 2 项已全部清零，RC10–RC16 全部通过；五份制品 hash 与记录一致、strict validate 通过、需求/场景/测试/任务/映射全部对齐、无未申报规范变更、安全边界无回归，具备进入 apply 的条件。据此把 canonical `CHANGES_APPLIED` 翻为 `yes`（本文件所有 `CHANGES_APPLIED:` 完成标记一并置为 `yes`，各历史小节正文保留当时结论与证据）。

CHANGES_APPLIED: yes
