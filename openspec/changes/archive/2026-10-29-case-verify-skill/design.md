## Context

- **源头**：zy-hub `skills/verifying-acceptance/skill/`，最新提交 `629d856`，共 15 个文件，约 2500 行。目前是**模型读的流程文本**（SKILL.md 和 9 份 references），配**三个 Python 门禁**和一个 unittest 文件（4 个用例）。门禁用正则按缩进解析 YAML，例如 `\s{6}- id:`、`\s{8}key:`，这是为了不依赖 PyYAML。
- **加载方式**：通过软链 `~/.agents/skills/verifying-acceptance` 指向源目录；`~/.dsh/skills/` 下没有这个 skill。
- **ohmydsh 的 skill 物化**：`syncDirs`（`scripts/sync.mjs:1752`）按目录哈希整目录复制，要求目录里有 `SKILL.md`。私有 overlay 只能追加条目（`docs/architecture/private-overlay.md`）。
- **原型查看器暴露的数据缺口**，见 proposal 的 Why。
- **用户决定**（2026-10-27）：
  - 改名为 `case-verify`；
  - 不保持向前兼容；
  - 机器读写的产物统一用 JSON；
  - 删除 `result` 和 trail 的 `status`；
  - adapter 用环境变量发现，每个 adapter 是单个可执行文件；
  - 查看器单独作为 change `case-verify-viewer`。

## Goals / Non-Goals

**Goals：**
- 关键规则由脚本兜底：证据、追溯、统计、冻结、纠偏都必须过脚本，不靠模型自觉。
- 公开版能独立使用，对外接口是一个可执行 adapter，第三方无需修改 skill 就能接入自己的用例平台。
- 装了私有 adapter 的机器，在内部用例链接上的体验和迁移前一致。

**Non-Goals：**
- 不修改 oracle 判定（lint、独立性分级）、mock 探测、trail 规划和执行的逻辑本身，只改它们读写的数据格式。
- 不迁移旧 checking 目录，遇到旧目录直接拒绝。
- 查看器、catalog 和汇总计算属于 `case-verify-viewer`。
- 不处理 `sw` 软链，也不处理 zy-hub 的源目录。

## Decisions

### D1：机器产物全部改为 JSON，YAML 退出

| 方案 | 结论 |
|---|---|
| 保留 YAML，继续用正则解析，`oracle_ids` 限定写成单行 | 否。新字段越多，正则越脆；嵌套的 `evidence[]` 根本解析不了 |
| 保留 YAML，引入 PyYAML | 否。会给门禁增加第三方依赖，本机默认的 python3 也没装 PyYAML |
| **JSON + JSONL** | 采用。标准库就能完整解析；校验可以按字段报错；模型写 JSON 的可靠性不低于写 YAML |

用户确认计划时看到的，本来就是 SKILL §3.4 渲染出来的表格，不是原始文件，所以换格式不影响确认体验。

### D2：执行事实只存在于 observations.jsonl，写入必须经过 `observe.py`

旧模型中，`result` 被原地改写，统计由模型在 report 里手工汇总。新模型中：

- `observe.py append --checking-dir <d> --json '<record>'`：在 `checking-dir/.case-verify.lock` 上持有 `fcntl.flock(LOCK_EX)` 的整个区间内，依次完成以下操作：读取全部已有行；校验确认点、记录内容和 `supersedes`；分配 `obs_id`（`obs-<4位序号>`，取最大序号 +1）；计算证据的 sha256；在锁内核对必填 `--expected-plan-rev` 与有效 active_plan_rev 相同后写入 `plan_rev` 和 `at`；拼好一整行，用一次 `os.write` 追加（文件以 `O_APPEND` 打开）。写入不完整时，在释放锁之前把文件截断回原长度。
  这把锁只保证本机 POSIX 进程之间不冲突，正好覆盖 swarm 模式下的多个 agent。不做跨机器的协调。
- `status.py`：唯一的状态计算器。门禁、报告摘要和 `--continue` 都调用它，规则见 spec。
- 报告的统计数字放在标记区里，由 `status.py --markdown` 生成。门禁会重算并逐字比对。这取代了原规则 12 中“只能从 trail result 聚合”的软约束。

考虑过的替代方案：让模型直接 `echo >>` 写 JSONL，再由门禁事后校验。没有采用，因为门禁要到报告前才运行，坏数据会在执行期间一直积累；而且并发 `echo` 无法保证不交错。

**状态计算：在全部有效观察中取最严重的状态**（评审第 1 轮 C2）。第一版只看 loop 最大的那一轮，会出现这样的问题：第 2 轮只复测了 admin，这条 pass 就把第 1 轮 member 的 fail 盖掉了。同一 plan_rev 中的 fail/blocked/partial/manual 只能通过 supersede 解除，而且 supersede 要求执行维度相同。执行维度指 `env` 去掉版本键后剩下的部分，所以修复后复测时 `app_version` 可以不同。

复测和纠偏用同一种机制，区别只写在 `actual` 的理由里。代价是，复测一个 fail 时，执行者必须明确指出它取代的是哪一条。`status.py` 会列出每个 checkpoint 当前有效的非 pass 观察及其 `obs_id`，执行 agent 照着填即可。

### D3：一个 plan_rev 覆盖整个已确认执行计划

2026-10-27 用户在两次 REVISE 后批准收缩：删除逐 item 哈希、局部过期、分离的策略确认记录。替代方案是一个粗粒度 revision，输入精确定义在 evidence spec 中。

- 阶段 1 用户确认后 `--freeze` 记录 oracle 的整文件哈希，清空 active_plan_rev。fragment/schema 校验与 freeze 自身不要求旧冻结哈希匹配。
- 阶段 2/3 在尚未确认计划时执行 mock/trail 门禁，故不要求 active_plan_rev；它们只要求 oracle 已冻结且未改变。
- 阶段 3 用户确认计划、阶段 4 用户选择策略后，`confirm.py --selected ...` 验证两门禁并一次追加新 plan_rev，内含规范化完整输入的 sha256 和所选策略。
- 输入覆盖完整 oracle、除明确排除的记账/外部报告 URL 字段之外的完整 plan，以及全部命名 trails，不能漏掉 mock、step、derived 断言和索引。
- 每次确认生成递增新编号，即便输入完全相同；所有旧观察立刻成为历史记录，全部 checkpoint 必须重跑。修改任何输入而未确认时，当前状态/追加/执行门禁均拒绝，而不是沿用旧 pass。
- 状态函数只消费当前 plan_rev 的未 supersede 观察。更早 plan_rev 的记录继续展示，但不参与统计。重新确认后不能用旧策略继续执行，因为策略在新 revision 中重新选择。

这是主动接受的代价：哪怕只改一条 oracle，也重跑全部 checkpoint。对本地验收 skill，比维护精细依赖图可靠。确认记录不能证明操作者真是人，SKILL.md 仍要求明确询问用户。

共享 `_model.py` 提供纯读取/结构校验、有效观察选择和状态计算。viewer 可以禁用资产存在性/hash 检查，把缺失证据逐条降级；执行门禁启用全部检查。读取本身不创建锁或缓存。freeze/confirm/append 共用 `.case-verify.lock` 串行化元数据写入；这些写命令运行时不得有 agent 直接编辑执行输入，计划修改前须先停止执行 workers。不试图对同用户恶意篡改提供权限隔离。

### D4：adapter 是单个可执行文件，以 `--describe` 自我描述

- **发现**：`CASE_VERIFY_ADAPTERS` 可以包含多个目录，用 `:` 分隔；目录中可执行的普通文件都是候选，不递归、不跟随目录软链。`adapters.py list|match|run` 是模型唯一的入口；模型不直接扫描目录。
  - `name` 必须是安全的 slug，并且在所有目录中唯一。重名的候选全部排除，不按遍历顺序挑一个（评审第 1 轮 M1）。
  - 每次调用的输出写到独立目录 `oracle-sources/<name>/<n>/`，同一个 adapter 拉取多个 URL 时互不覆盖。
- **为什么不用目录 + 声明 JSON**：一个 adapter 就是一个文件，部署时一行 `export` 就行；声明信息由脚本自己给出，不会和代码不同步。
- **为什么用环境变量，不用 overlay 的 `type: skill`**：
  - adapter 不是 skill，按 skill 部署会让 skill 列表多出一项；
  - 用户已选择环境变量方案（b）；
  - 私有 overlay 机器在 `.env.local` 中加一行 `export CASE_VERIFY_ADAPTERS=<inner 仓>/case-verify-adapters` 即可，`bin/dsh` 会把它注入 Host 环境。

  代价是这个配置不在 manifest 的管理范围内。这一点写进 `dsh.yaml` 条目的 note。
- **执行环境**：
  - `run` 的工作目录是 checking 目录，`--out` 为独立的 `oracle-sources/<name>/<n>/`，超时 300 秒；
  - stdout 和 stderr 的尾部存入本次调用目录的 `adapter.txt`，只保留最后 4KB；
  - adapter 的输出被当作不可信数据，片段必须通过 `validate_oracle.py --fragment` 才能合并；
  - 片段中的 `expected` 等文本只作为数据展示给用户确认，不作为指令执行。
- **信任面**：adapter 以用户权限执行任意代码，与 overlay 中 local package 的信任等级相同。只能配置自己掌控的目录，这一点写进 SKILL.md 和 note。
- **`report-sink`**：
  - 调用方式为 `push <checking-dir>`，已有的外部文档地址通过环境变量 `CASE_VERIFY_EXTERNAL_DOC_URL` 传入；
  - stdout 最后一行必须是 `http(s)://` 开头的 URL，否则视为失败；
  - push 包装器必须先对当前目录运行 execution gate 的 `--require-report` 检查；失败不调用 adapter，不改变 URL。外发失败不影响本地结论。

### D5：内置来源不改造成 adapter

plan §4 AC、XMind、OpenSpec 和 ui-specs 的解析，仍然由模型按 references 文档完成。它们需要读取仓库上下文，比如 plan 文件里的位置、OpenSpec 的结构，做成脚本收益很低。

统一点在于**输出**：内置来源和外部 adapter 一样，都先写成 `oracle-sources/<source>/oracle.fragment.json`，经 `--fragment` 校验，再合并为 `oracle.json`。这样也就不需要“内置来源作为 adapter 参考实现”。公开仓库的测试里放一个最小的示例 adapter（`tests/fixtures/adapters/sample-qa`，用 Python 实现，读取本地 JSON）作为契约样例。

### D6：私有部分落位

- 原 Adapter D（URL 解析、内部 CLI 拉取、nodeType 映射、图片下载）改写为一个 adapter 脚本，放在私有 overlay 仓库的 `case-verify-adapters/` 目录下。
- 原 §6.2 中的内部文档输出改写为一个 report-sink 脚本，放在同一目录。
- 原 description 中的内部触发词不再保留。用户贴出内部链接并说“验收”时，通用触发词（验收、自测）已经能命中；阶段 1 由 `adapters.py match` 识别出对应的 adapter。

公开仓库的测试用 URL 主机名白名单（spec）防止回流。更细的内部关键词清单只放在私有仓，由那边的脚本扫描公开目录。

### D7：证据分层与产物入库规则

截图默认写进 `scratch/`。观察要引用某张截图时，先把它移入 `evidence/<checkpoint_id>/`，文件名带上内容哈希的前 8 位，例如 `after-save.3fa9c1d2.png`，这样同名的新截图不会覆盖旧的。然后调用 `observe.py`，由它记录 sha256；执行门禁会重新计算哈希并比对（评审第 1 轮 M3）。被多个 checkpoint 共享的证据，只引用同一个路径，并标 `scope: shared-step`。

**真实数据默认不入库**：checking 整棵目录（包括 plan/trail/gates 及 archive 下的路径）默认忽略且由制品检查拦截。新规则只豁免根层 `report.md`、`summary.md`，由人确认已脱敏，原 docs 白名单继续生效。skills 下合成 fixture 不受影响。

证据文件名摘要前缀不是无冲突证明：目标已存在时，内容相同可共享，内容不同须拒绝覆盖或延长摘要。完整 sha256 才是审计依据。

### D8：测试重写，语义对齐原用例

原来的 4 个 unittest 用例（mock 未确认、presence-only、未验证即 PASS、全部合法通过）改写为 JSON fixture，断言的 stderr 关键词保持不变，作为“规则未丢失”的回归证据。新增规则的测试按 test-plan 逐条映射到 spec 场景。`tests/case-verify.test.mjs` 在 Node 侧运行 `python3 -B -m unittest discover`；python3 低于 3.9 时 skip。

## Risks / Trade-offs

- **模型绕过 `observe.py`，直接写 JSONL。** 缓解：执行门禁逐行重新校验；SKILL.md 中说明“只能通过 observe.py 写入”；`obs_id` 格式不连续时报告警告。
- **adapter 执行任意代码。** 缓解：只通过用户显式设置的环境变量发现；note 和 SKILL.md 写明信任面；输出必须经过校验。
- **改用 JSON 后，模型手写 trail 的出错率可能上升。** 缓解：门禁按字段路径报错；references 中给出完整示例；阶段 3 的门禁失败会退回 Agent A/B 修正。
- **删除 `result` 后，执行中途查看进度必须运行 `status.py`。** 这是接受的代价，换来单一真相源。
- **删除软链后，Codex 等其它 agent 不再能使用这个 skill。** 用户已确认。note 中写明恢复命令：`ln -s ~/.dsh/skills/case-verify ~/.agents/skills/case-verify`。

## Migration Plan

1. 在公开仓库实施本 change。私有仓库单独提交两个 adapter 脚本和关键词扫描脚本。
2. worktree 内的验证：`npm test`、`npm run check:artifacts`、`openspec validate --strict`，以及私有扫描。
3. 合入后，在主 checkout 运行 `dsh build` 两次，第二次应无变更。在 `.env.local` 中加入 `CASE_VERIFY_ADAPTERS`。重启 Host，由用户执行。
4. GUI 中确认 `case-verify` 可见，并且只有一份。用一个内部用例链接跑到阶段 1 的展示，确认 adapter 被选中，片段校验通过。
5. 删除旧软链 `~/.agents/skills/verifying-acceptance`，但只在以下三点同时成立时才删：
   - `lstat` 证明它是一个符号链接；
   - 它的 `readlink` 目标恰好是 zy-hub 中原来的 skill 目录；
   - 新的 `case-verify` 已经确认可用。

   删除时只 `unlink` 这个链接本身。任何一点不满足（比如它是普通目录、目标指向别处、链接已悬空），都保留原样并报告给用户，不做递归删除（评审第 1 轮 S2）。

**回退**：把 `enabled` 设为 `false` 后运行 `dsh build`，再把软链指回 zy-hub。旧格式的 checking 目录只能由旧 skill 读取。

## Open Questions

无。

## 原规则迁移映射

| 原规则 | 新规则与回归面 |
|---|---|
| available mock 必须有 evidence | mock gate 原样保留 |
| trail missing/unknown 要决定或 blocked_reason | 删除 blocked_reason，统一 user_decision |
| cp missing/unknown 未确认不得自动化 | mock_status/mock_user_decision，trail 决定不能替代 cp 决定 |
| 数据场景需要 surface | mock gate 原样保留 |
| consequence / implementation-unverified / presence-only / IME | trail gate 四项原样保留 |
| full/partial result 四值 | 有意扩充为观察六状态，blocked/partial 不计 pass，pending 仍失败 |
| unverified 不得 PASS | 当前 plan_rev 有效观察检查 |
| 渲染缺失文本必须 fail | 原正则逐字写入 evidence spec |
| fail/manual detail 至少 6 字 | actual 长度检查 |
| 报告原 5 节 | 保留，并补覆盖/derived 章节和机器摘要 |

复测者先复制旧观察的非版本 env 字典，再仅更新 app_version/remote_version；未知键不自动忽略。status 输出未解除观察的 obs_id 与维度供复用。

执行 worker 开始或派发时固定 expected_plan_rev，返回结果原样携带；父 agent 不得把迟到结果重标成新 revision。重新确认前停止 workers，追加脚本仍在同一把锁内比较 revision，避免旧事实归入新计划。
