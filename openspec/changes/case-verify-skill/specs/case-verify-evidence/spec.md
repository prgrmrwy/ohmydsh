## Purpose

规定 case-verify checking 目录的数据模型和校验规则。oracle 在用户确认后冻结；计划与 trail 只描述“要验什么”；执行事实以只追加的观察记录保存，带精确证据。状态、统计和续跑范围都由脚本根据观察记录计算，门禁据此拦截缺少证据的判定和失真的报告。

## ADDED Requirements

### Requirement: checking 目录布局与格式识别
checking 目录 SHALL 由以下内容组成：

- `oracle.json`、`plan.json`、`trails/<id>.json`、`observations.jsonl`、`report.md`；
- 子目录 `oracle-sources/`、`evidence/`、`scratch/`、`gates/`。

结构化元数据 SHALL 使用 JSON 或 JSONL；report、gates 及 evidence/scratch 中的图片、DOM、日志等不受此格式限制。

每个门禁和数据脚本 SHALL 先识别目录格式：如果目录中存在 `plan.yaml` 或 `trails/*.yaml`，但不存在 `plan.json`，SHALL 以非 0 退出，并提示“旧格式 checking 目录不受支持”，不打印 traceback。

#### Scenario: 新格式目录被接受
- **GIVEN** 一个包含 `plan.json` 和 `trails/T1.json` 的 checking 目录
- **WHEN** 运行 `validate_trail_gate.py --checking-dir <dir>`
- **THEN** 门禁按 JSON 解析 trail 并输出检查结果，不报格式错误

#### Scenario: 旧格式目录被拒绝
- **GIVEN** 一个只有 `plan.yaml` 和 `trails/T1.yaml` 的 checking 目录
- **WHEN** 运行任一门禁
- **THEN** 退出码非 0，stderr 包含“旧格式 checking 目录不受支持”，且不包含 `Traceback`

### Requirement: oracle 经用户确认后冻结
阶段 1 规范化得到的检查点 SHALL 写入 `oracle.json`，结构为 `{"schema": 1, "items": [...]}`。每个 item 的必需字段如下：

- `id`：在文件内唯一；
- `title`、`input`、`expected`：非空字符串；
- `precondition`、`entry_point`、`reviewer_notes`：字符串或 null；
- `provenance`：`spec` 或 `independent`；
- `source`：来源名称，例如 `plan-ac`、`xmind` 或 adapter 名；
- `path`：字符串数组，表示来源树中的路径，可以为空；
- `priority`：`P0`、`P1` 或 `P2`；
- `expected_source`。

用户确认后，SHALL 运行 `validate_oracle.py --freeze`。它校验 oracle schema，在 `plan.json.meta.oracle_freeze` 写入 `{sha256, at}`，并将 `meta.active_plan_rev` 清空。每次重新冻结（即使内容相同）都使当前计划失效；旧观察保持原样。

`--fragment` 只校验片段 schema，不要求已有 plan 或冻结记录；普通 oracle schema 校验也不要求冻结。`--freeze` 允许首次冻结和对已改动 oracle 的重新冻结，不先要求旧哈希匹配。mock/trail 规划门禁只要求当前 oracle 与冻结哈希一致，不要求计划已确认。`confirm.py` 要求 oracle 已冻结且哈希匹配。观察追加、当前状态计算及执行门禁还要求 active plan_rev 与当前执行输入匹配。上述前置检查均失败时非 0，指出缺少的确认；不得悄悄重新冻结或确认。

#### Scenario: 首次片段校验不依赖冻结
- **GIVEN** 一个合法的 oracle 片段，尚不存在 plan.json
- **WHEN** 运行 `validate_oracle.py --fragment <file>`
- **THEN** 退出码为 0，且不创建 plan.json

#### Scenario: 冻结后记录哈希
- **GIVEN** 一份合法 oracle 和初始 plan
- **WHEN** 运行 `validate_oracle.py --checking-dir <dir> --freeze`
- **THEN** `meta.oracle_freeze.sha256` 等于当前 oracle 字节的 sha256，`meta.active_plan_rev` 为 null

#### Scenario: 冻结后被修改
- **GIVEN** oracle 已冻结，之后改动了某个 expected，未重新冻结
- **WHEN** 追加观察或运行执行门禁
- **THEN** 非 0 退出，提示 oracle 在冻结后被修改

#### Scenario: 重新冻结使当前计划失效
- **GIVEN** 已有生效计划和 pass 观察，用户修改 oracle 并再次确认
- **WHEN** 运行 `--freeze`
- **THEN** 冻结成功，active_plan_rev 为 null；观察文件字节保持不变；再次追加前必须确认计划和执行策略

#### Scenario: 非法 oracle
- **GIVEN** `oracle.json` 中有两个 item 的 `id` 相同，或者某个 item 的 `priority` 为 `P5`
- **WHEN** 运行 `validate_oracle.py --checking-dir <dir>`
- **THEN** 退出码非 0，报出冲突的 id，或者该 item 的索引和字段名

### Requirement: 计划与 trail 只描述待验内容并追溯 oracle
`plan.json` 和 `trails/<id>.json` SHALL 保留原有的计划字段，包括：

- trail 级：设备、parallel_group、conflicts_with、mock_setup、steps；
- checkpoint 级：focus、verify、automation、数据场景、surface、expected_source、expected_unverified、input_method，以及各 verify 类型自己的字段。

它们 SHALL NOT 包含执行结果字段。也就是说，trail 不得有 `status` 或 `blocked_reason`，checkpoint 不得有 `result` 或 `result_detail`，`plan.json` 的 `trails[]` 不得有 `status`。

每个 checkpoint SHALL 带两个字段：

- `oracle_ids`：字符串数组；
- `origin`：`oracle` 或 `derived`。

`origin: oracle` 的 checkpoint SHALL 至少引用一个 oracle id。所有被引用的 id SHALL 存在于 `oracle.json` 中。外部文档地址字段名为 `meta.external_doc_url`。

#### Scenario: 合法追溯
- **GIVEN** checkpoint `T1-S1-C1` 的 `origin` 为 `oracle`，`oracle_ids` 为 `["AC-1", "xmind-3"]`，两个 id 都在 oracle 中
- **WHEN** 运行 trail 门禁
- **THEN** 不产生追溯类错误

#### Scenario: 引用不存在的 oracle
- **GIVEN** 某个 checkpoint 的 `oracle_ids` 包含 `AC-9`，而 oracle 中没有这个 id
- **WHEN** 运行 trail 门禁
- **THEN** 门禁失败，报出 trail 文件名、checkpoint id 和 `AC-9`

#### Scenario: oracle 来源却没有挂载
- **GIVEN** 某个 checkpoint 的 `origin` 为 `oracle`，但 `oracle_ids` 是空数组
- **WHEN** 运行 trail 门禁
- **THEN** 门禁失败，提示该 checkpoint 要么挂载 oracle，要么改为 `derived`

#### Scenario: 计划中残留执行结果
- **GIVEN** 某个 checkpoint 带有 `result` 字段
- **WHEN** 运行 trail 门禁
- **THEN** 门禁失败，提示执行结果只能记录在 `observations.jsonl` 中

### Requirement: 流程确认点以可校验记录落盘
skill SHALL 保留原有流程：1 oracle 前置处理、2 mock 探测、3 trail 规划、4 执行策略选择、5 浏览器执行、6 报告。oracle 用户确认后才能进入 mock 阶段；依赖 missing/unknown mock 的场景必须先由用户决定才能规划；计划展示后等待用户确认，再询问执行策略；两者齐备才能执行。`--plan-only` 展示计划后退出，不执行。

计划确认与执行策略选择合并落盘：用户先确认计划、再选择策略后，运行 `confirm.py --selected swarm|single_agent`。脚本校验已冻结的 oracle、mock gate、trail gate，以及策略约束（recommendation 为 single_only 时拒绝 swarm），然后追加 `meta.plan_revisions[]` 的一项 `{plan_rev, input_sha256, selected, at}`，并令 `meta.active_plan_rev` 指向新 plan_rev（从 1 严格递增，每次确认都生成新编号，绝不复用）。

执行输入的哈希 SHALL 覆盖以下完整集合：
- 当前 oracle.json 的解析后完整对象；
- plan.json 的完整对象，唯独去除 `meta.oracle_freeze`、`meta.plan_revisions`、`meta.active_plan_rev`、`meta.external_doc_url`；
- trails/ 下全部 JSON 文件的文件名和解析后完整对象，按文件名排序。

上述集合用标准 JSON 规范化（`sort_keys=True, separators=(',', ':'), ensure_ascii=False`，UTF-8 编码）求 sha256；拒绝重复 JSON 键、NaN 和 Infinity。plan 的索引 SHALL 与磁盘 trails 文件一一对应，checkpoint id 在当前计划内全局唯一。确认记录包含实际选择的策略，计划或 oracle 任一变化均导致哈希不匹配；仅更新外部报告 URL 不失效。

当前状态读取时，如果 active_plan_rev 为空或输入哈希不匹配，SHALL 以非 0 提示需要确认计划，而不是使用旧状态。重新确认后，只有该 plan_rev 下的观察参与当前状态，因此所有 checkpoint 都回到 pending，包括未改动的 checkpoint 和 derived checkpoint。`--continue` 只在执行输入未变且 active_plan_rev 有效时复用确认。

脚本记录只证明确认已落盘，不能证明确由人确认；SKILL.md SHALL 禁止模型代替用户确认。这不是浏览器操作权限隔离机制。

#### Scenario: 确认齐备后可以记录观察
- **GIVEN** oracle 已冻结、mock/trail 门禁通过，用户已确认计划并选择 single_agent
- **WHEN** 运行 `confirm.py --selected single_agent` 后追加合法观察
- **THEN** active_plan_rev 为新编号，观察追加成功且记录同一 plan_rev

#### Scenario: 未确认计划时不能记录观察
- **GIVEN** active_plan_rev 为 null，或者某个 trail 在确认之后被修改
- **WHEN** 运行 `observe.py append`
- **THEN** 非 0 退出，提示需要确认计划；观察日志字节不变

#### Scenario: 策略不可用时不能确认
- **GIVEN** recommendation 为 single_only
- **WHEN** 运行 `confirm.py --selected swarm`，或省略 selected 参数
- **THEN** 非 0 退出，不新增 revision，也不改变 active_plan_rev

#### Scenario: 仅修改 plan 的执行字段也会失效
- **GIVEN** 计划已确认，之后只修改 plan 中 trails 的顺序或 agent_assignments
- **WHEN** 追加观察
- **THEN** 非 0，提示执行输入已变化

#### Scenario: 外部报告 URL 更新不影响确认
- **GIVEN** 当前计划有效，之后仅更新 meta.external_doc_url
- **WHEN** 追加合法观察
- **THEN** 追加成功，plan_rev 不变

#### Scenario: 同内容重新确认也必须重跑
- **GIVEN** 当前计划已有 pass 观察，输入没有变化
- **WHEN** 用户再次确认并运行 confirm.py
- **THEN** 生成新的 plan_rev，全部 checkpoint 为 pending，旧观察原样保留

#### Scenario: 重挂 oracle 后旧通过不可继承
- **GIVEN** C 挂载 O-1 且已有 pass；同一个 oracle 文件中已有 O-2
- **WHEN** 将 C 改挂 O-2，重新确认计划与策略
- **THEN** 所有 checkpoint 为 pending，C 的旧 pass 不参与当前状态

#### Scenario: derived 断言变化后必须重跑
- **GIVEN** derived checkpoint D 已 pass
- **WHEN** 修改 D 的断言后重新确认
- **THEN** D 和其他 checkpoint 全部为 pending

### Requirement: 观察记录只经追加脚本写入
每次对 checkpoint 做出判定时，SHALL 通过 `observe.py append --expected-plan-rev <n>` 向 `observations.jsonl` 写入一行 JSON。执行者开始检查或被派发时固定该 revision，父 agent 必须原样保留返回结果所属 revision，不得用最新 revision 重新标记旧结果。参数为必填，脚本在已有排它锁内将 expected_plan_rev 与有效 active_plan_rev 比较；缺失、不相等、active 为空时拒绝且日志字节不变。freeze/confirm 前停止旧执行者只是流程纪律，不能替代此比较。

`observe.py` 负责以下内容：
- 分配 `obs_id`，在目录内唯一；
- 写入 `at`，格式为 ISO 8601；
- 写入 `plan_rev`，取当前有效的 active_plan_rev（调用者不得覆盖）；
- 为每条证据写入 `sha256`。

以下操作 SHALL 在同一把排它文件锁内完成：读取已有日志、校验记录（包括 `supersedes`）、分配 `obs_id`、追加完整的一行。追加只发生在文件末尾，不改动已有字节；失败时不留下残行。

每条记录包含以下字段：

- `checkpoint_id`：必须存在于 trails 中；
- `loop`：正整数；
- `batch`：字符串或 null；
- `env`：对象，建议键为 `app_version`、`remote_version`、`role`、`shape`，也允许自由键；
- `status`：`pass`、`fail`、`manual`、`skipped`、`partial` 或 `blocked`；
- `actual`：字符串；
- `evidence`：数组，每项为 `{path, kind, scope, sha256}`。`kind` 取 `screenshot`、`dom`、`network` 或 `log`；`scope` 取 `exact` 或 `shared-step`；`sha256` 由脚本计算；
- `limits`：字符串数组；
- `supersedes`：一个已有的 `obs_id`，或 null。

校验失败时，SHALL 以非 0 退出，并且不写入任何内容。

#### Scenario: 追加保留已有内容
- **GIVEN** `observations.jsonl` 已有 2 行
- **WHEN** 用一条合法记录运行 `observe.py append`
- **THEN** 文件变为 3 行，前 2 行的字节与追加前完全相同，第 3 行带有新分配的 `obs_id` 和 `at`

#### Scenario: 并发追加
- **GIVEN** 两个进程同时对同一个 checking 目录各追加一条合法观察
- **WHEN** 两次 `observe.py append` 都结束
- **THEN** 两次都成功；文件新增 2 行，每行都是合法 JSON；两条记录的 `obs_id` 不同

#### Scenario: 迟到旧 worker 结果被拒绝
- **GIVEN** worker 在 plan_rev 1 开始检查；同内容重新确认已产生 plan_rev 2
- **WHEN** 用 expected-plan-rev 1 提交旧结果
- **THEN** 非 0，日志字节不变；缺少该参数或冻结后 active 为空也拒绝

#### Scenario: 新 revision 真正重跑成功
- **GIVEN** 当前 plan_rev 2，worker 在本 revision 下重新执行
- **WHEN** 以 expected-plan-rev 2 提交合法结果
- **THEN** 追加成功，记录 plan_rev 2

#### Scenario: 非法记录不写入
- **GIVEN** 一条 `status` 为 `ok` 的记录，或者一条 `checkpoint_id` 不存在的记录
- **WHEN** 运行 `observe.py append`
- **THEN** 退出码非 0，`observations.jsonl` 的字节保持不变

### Requirement: 证据有类型、有范围且限定在 evidence 目录
观察记录中 `evidence[].path` SHALL 是相对 checking 目录的路径，并且以 `evidence/` 开头，不得是绝对路径，不得含有 `..` 段。它指向的文件经 realpath 解析后 SHALL 仍在 checking 目录内，并且确实存在。

执行过程中产生、但没有被观察记录引用的文件，SHALL 放在 `scratch/` 中。证据文件一旦被引用，就 SHALL NOT 再被覆盖。执行门禁 SHALL 重新计算每条证据的 sha256，与记录中的值比对。同一个文件可以被多条观察共享引用。`status` 为 `pass` 或 `fail` 的观察 SHALL 至少有一条证据；如果没有，就必须在 `limits` 中写明没有证据的原因。

#### Scenario: 带截图的通过
- **GIVEN** `evidence/T1-S1-C1/after-save.png` 存在
- **WHEN** 追加一条 `status: pass` 的观察，引用这张截图，`kind` 为 `screenshot`，`scope` 为 `exact`
- **THEN** 追加成功

#### Scenario: 工具返回成功但没有证据
- **GIVEN** 一条 `status: pass` 的观察，`evidence` 和 `limits` 都是空数组
- **WHEN** 运行 `observe.py append`
- **THEN** 追加被拒绝，错误中提示必须提供证据，或在 `limits` 中写明原因

#### Scenario: 已引用的证据被覆盖
- **GIVEN** `obs-1` 引用了 `evidence/C/after.png`；后来续跑时，同一路径被写入了新的截图
- **WHEN** 运行执行门禁
- **THEN** 门禁失败，报出该路径与 `obs-1`，提示证据在被引用后发生了变化

#### Scenario: 证据路径越界
- **GIVEN** 证据路径为 `../other/x.png`、`/tmp/x.png`、`scratch/x.png`，或者是 `evidence/` 下一个指向 checking 目录外部的符号链接
- **WHEN** 运行 `observe.py append`
- **THEN** 追加被拒绝，错误中报出这条路径

### Requirement: 纠偏只能通过追加 supersede 记录完成
有两种情况需要让一条旧观察不再计入当前状态：修复后复测，以及误判纠偏。这两种情况 SHALL 都通过追加一条新观察完成：新观察的 `supersedes` 指向旧观察，并在 `actual` 中写明理由。

被 supersede 的观察 SHALL 满足以下条件：
- 早于新记录；
- 与新记录属于同一个 checkpoint；
- 与新记录具有相同的执行维度。执行维度指 `env` 去掉 `app_version`、`remote_version` 两个版本键之后的其余键值；
- 尚未被其它记录 supersede；
- 与新观察属于同一 plan_rev。

观察只有同时满足“plan_rev 等于当前 active_plan_rev”以及“未被 supersede”时才是有效观察。其它记录保持原样并展示为过期或已纠偏，不参与当前统计。supersedes 还 SHALL 限定在同一 plan_rev 内；历史记录中的 plan_rev 必须为已存在的 revision。历史 checkpoint 可以已从当前计划移除，校验日志时不得因此拒绝其历史记录；只有新追加记录必须引用当前 checkpoint。

#### Scenario: 事后纠偏
- **GIVEN** checkpoint `T1-S1-C1` 有一条 `obs-1`，状态为 fail
- **WHEN** 追加一条 `supersedes: obs-1`、`status: pass`、带证据的观察
- **THEN** 追加成功；`obs-1` 仍保留在文件中；`status.py` 计算出该 checkpoint 的状态为 pass

#### Scenario: 非法纠偏
- **GIVEN** `obs-1` 已经被 `obs-2` supersede；或者 `obs-1` 属于另一个 checkpoint；或者 `obs-1` 的 `env.role` 为 `member`，而新记录的 `env.role` 为 `admin`
- **WHEN** 再追加一条 `supersedes: obs-1` 的观察
- **THEN** 追加被拒绝，错误中写明原因

#### Scenario: 竞争纠偏只有一个成功
- **GIVEN** 当前 plan_rev 有一条尚未被 supersede 的 fail
- **WHEN** 两个进程同时追加指向它的纠偏
- **THEN** 恰好一个成功，另一个非 0；日志只增加一条完整记录

#### Scenario: 非法 revision 被拒绝
- **GIVEN** 日志中一条 derived 观察缺少 plan_rev 或指向从未存在的 revision
- **WHEN** 校验日志
- **THEN** 非 0，报出行号及 plan_rev 问题

### Requirement: 状态、统计与续跑范围由观察记录计算
`status.py --checking-dir <dir>` SHALL 输出 JSON，内容包括每个 checkpoint 的当前状态、按 focus 和状态分组的计数，以及 `--continue` 应该重跑的 checkpoint 列表。

checkpoint 的当前状态按以下规则计算：

1. 取该 checkpoint 的全部有效观察，不分 loop 和 env；
2. 按 `fail` > `blocked` > `partial` > `manual` > `pass` > `skipped` 的优先级，取其中最高者；
3. 没有任何有效观察时，状态为 `pending`。

同一 plan_rev 内，fail/blocked/partial/manual 只能通过显式 supersede 解除，不能因为更晚的 loop 或别的 env 的 pass 而自动消失；skipped 可被更高优先级状态覆盖。重新确认使所有旧观察过期，是另一个明确的整体失效途径。`loop` 只用于报告中的分轮展示。

trail 的状态也由计算得出：只要有一个 checkpoint 为 `blocked`，trail 就是 blocked。

`--continue` 的默认重跑范围是状态为 `pending` 或 `blocked` 的 checkpoint。

`report.md` SHALL 包含一段由 `status.py --markdown` 生成的摘要，放在 `<!-- case-verify:summary:start -->` 和 `<!-- case-verify:summary:end -->` 两个标记之间。执行门禁 SHALL 重新生成这段摘要，并与报告中的内容逐字比对。

#### Scenario: 多环境下的保守计算
- **GIVEN** 在第 2 轮中，checkpoint C 有两条有效观察：`env.role=admin` 时为 pass，`env.role=member` 时为 fail
- **WHEN** 运行 `status.py`
- **THEN** C 的状态为 fail，计数中 fail 加 1

#### Scenario: 局部复测不能抹掉另一环境的失败
- **GIVEN** 第 1 轮中，C 在 `role=admin` 下为 pass，在 `role=member` 下为 fail；第 2 轮只复测了 admin，追加了一条 pass，没有 supersede 任何记录
- **WHEN** 运行 `status.py`
- **THEN** C 的状态仍为 fail

#### Scenario: 复测解除失败
- **GIVEN** 情况同上；第 2 轮又追加了一条 `role=member`、`app_version` 不同、`supersedes` 指向 member 那条 fail 的 pass，并带有证据
- **WHEN** 运行 `status.py`
- **THEN** C 的状态为 pass

#### Scenario: 续跑范围
- **GIVEN** C1 有一条有效的 pass，C2 有一条有效的 blocked，C3 没有任何有效观察
- **WHEN** 运行 `status.py`
- **THEN** 重跑列表恰好是 `[C2, C3]`

#### Scenario: 手改统计被发现
- **GIVEN** 报告摘要区里的通过数被手工从 3 改成了 4
- **WHEN** 运行执行门禁并带上 `--require-report`
- **THEN** 门禁失败，提示报告摘要与观察记录计算出的结果不一致

### Requirement: 执行门禁保留原规则并检查覆盖缺口
`validate_execution_gate.py` SHALL 执行以下检查，任一不满足即以非 0 退出：

1. 每个 automation 为 full 或 partial 的 checkpoint，当前状态必须为 pass/fail/manual/skipped/partial/blocked 之一；pending 失败。相比旧 gate 的 result 枚举，有意新增 partial/blocked，使受限或环境阻塞能如实报告，门禁通过不代表验收 PASS。
2. `expected_unverified: true` 的 checkpoint 不能有任何 `pass` 的有效观察。
3. 对当前 revision 的有效观察，用 `re.search(r"(surface rendered|已渲染|目标 surface).*(not found|找不到|不存在|缺失)", actual, re.IGNORECASE)` 命中时，状态必须为 fail；此谓词是原门禁的机械兜底，不取代执行者复读页面的纪律。
4. `fail` 或 `manual` 状态的观察，`actual` 至少 6 个字符。
5. 观察文件逐行合法，证据规则成立，`supersedes` 合法（这些规则与写入时的校验一致；对已有文件，门禁会再查一遍）。
6. oracle 与冻结哈希一致；active_plan_rev 有效且执行输入哈希一致；所有日志的结构/revision/supersedes 引用合法；每条历史与当前证据的 sha256 一致。判定纪律及 expected_unverified 按当前 revision 校验，历史移除的 checkpoint 不套用当前定义。
7. 带 `--require-report` 时，`report.md` 必须存在，并且包含以下章节：`## Mock 证据`、`### Surface × 数据态覆盖`、`## 执行策略`、`## 期望来源缺口`、`### 未覆盖 / 天然盲区`、`### 未覆盖的 oracle`、`### 派生 checkpoint`；摘要区与计算结果逐字一致。

门禁 SHALL 在 stdout 中列出两类信息，它们本身不导致失败：

- 没有被任何 `origin: oracle` 的 checkpoint 引用的 oracle id（只被 derived checkpoint 引用的也算未覆盖）；
- 所有 `origin: derived` 的 checkpoint id，以及它们的当前状态。

#### Scenario: 合法目录通过
- **GIVEN** 一个满足以上 7 项检查的最小 checking 目录
- **WHEN** 运行 `validate_execution_gate.py --checking-dir <dir> --require-report`
- **THEN** 退出码为 0

#### Scenario: 列出覆盖缺口
- **GIVEN** oracle O-2 没有被任何 checkpoint 引用，checkpoint C2 的 `origin` 为 `derived`，当前状态为 pass
- **WHEN** 运行执行门禁
- **THEN** stdout 中列出 `O-2`，以及 `C2 (pass)`

#### Scenario: 未验证期望计入通过
- **GIVEN** 一个 `expected_unverified: true` 的 checkpoint 有一条 pass 有效观察
- **WHEN** 运行执行门禁
- **THEN** 门禁失败，stderr 中包含 `expected_unverified`

#### Scenario: 报告缺少新章节
- **GIVEN** `report.md` 缺少 `### 派生 checkpoint` 章节
- **WHEN** 运行执行门禁并带上 `--require-report`
- **THEN** 门禁失败，报出缺少的章节名

### Requirement: mock 与 trail 门禁规则在 JSON 模型上保持不变
`validate_mock_gate.py` 和 `validate_trail_gate.py` SHALL 改为读取 JSON，但保留原有规则：

- **mock 门禁**：
  - `mock_setup.status` 为 `available` 时，必须有 `evidence`；
  - 依赖 mock 但状态为 `missing` 或 `unknown` 时，必须有 `user_decision`；
  - 数据场景 checkpoint 必须有 `surface`。
- **trail 门禁**：
  - 交互 step 必须有对应的后果 checkpoint；
  - `expected_source: implementation` 时，必须同时有 `expected_unverified: true`；
  - 自动化 checkpoint 不能只做 presence-only 断言；
  - IME 场景必须标为 `manual`。

trail 级的 `blocked_reason` 被删除后，计划阶段因 mock 不可用而阻塞的情况，SHALL 只通过 `mock_setup.user_decision` 记录。

#### Scenario: mock 未确认被拦截
- **GIVEN** 某个 trail 的 `mock_setup` 为 `{required: true, status: "unknown", user_decision: null}`
- **WHEN** 运行 mock 门禁
- **THEN** 门禁失败，stderr 中包含“缺少 user_decision”

#### Scenario: presence-only 点击被拦截
- **GIVEN** 某个 click step 只有一个“按钮可见”的 `assert_dom` checkpoint
- **WHEN** 运行 trail 门禁
- **THEN** 门禁失败，stderr 中包含 `presence-only`

#### Scenario: 合法计划通过两个门禁
- **GIVEN** 一个与原有效用例语义等价的 JSON 计划：mock 有证据，点击后有回读断言
- **WHEN** 依次运行 mock 门禁和 trail 门禁
- **THEN** 两者的退出码都为 0


#### Scenario: checkpoint mock 缺口不能被 trail 决定掩盖
- **GIVEN** trail mock 决定齐备，但 C 的 automation 为 full、mock_status 为 unknown、mock_user_decision 为 null
- **WHEN** 运行 mock 门禁
- **THEN** 非 0，报出 C 和“未确认，不能继续自动化”

#### Scenario: 缺失文本命中与未命中
- **GIVEN** 一条当前观察 actual 为“已渲染 surface 但按钮不存在”，status 为 manual
- **WHEN** 运行执行门禁，再分别以相同 actual/status=fail 和 actual=“等待登录页面”/status=blocked 运行
- **THEN** 第一次因缺失谓词失败，后两次不产生该类错误

#### Scenario: 受限状态如实通过结构门禁
- **GIVEN** full checkpoint 的当前状态为 blocked 或 partial，其他门禁条件均满足
- **WHEN** 执行门禁
- **THEN** 结构门禁退出 0，但生成摘要原样列出 blocked/partial，不将其计入 pass
