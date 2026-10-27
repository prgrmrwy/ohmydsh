## Why

验收 skill `verifying-acceptance` 目前在私有仓 zy-hub 里，靠手工软链 `~/.agents/skills/verifying-acceptance` 生效。它不在 `dsh.yaml` 中，所以没有开关、没有审查记录，也无法在其它机器上复现。正文里还混有组织内部的用例平台、CLI、登录方式和文档输出，按 `repo-layout`「公开仓库不硬编码组织专属值」，这些内容不能进入公开仓库。

另外，一次持续约一周、产出 4772 个证据文件的验收暴露了数据模型的问题：

- checkpoint 只有一个 `result`，`--continue` 会覆盖历史结果；
- 截图路径只写在自由文本里；
- 角色、形态、版本、批次这些执行维度没有固定字段；
- 规范化后的 oracle 不落盘，和 trail 之间没有追溯关系；
- 计划和 trail 是 YAML，门禁为了不依赖 PyYAML，只能用正则按缩进去解析。

后续还要做证据查看器（change `case-verify-viewer`），它需要一份可回溯、带精确证据的结构化记录。所以本 change 一次性完成迁入、改名、脱敏、数据模型重做和外部来源接口，**不保持向前兼容**。

## What Changes

- **BREAKING** skill 改名为 `case-verify`（slash 为 `/case-verify`），源目录迁到 `skills/case-verify/`，并在 `dsh.yaml` 登记为 `type: skill`。保留 oracle、mock、规划、策略、执行、报告六阶段及用户确认点。
- **BREAKING** 数据模型改为 JSON，机器读写的产物都在 checking 目录里：
  - `oracle.json`：新增。阶段 1 经用户确认后冻结。
  - `plan.json`：取代 `plan.yaml`。删除 `trails[].status/blocked_reason`；`meta.feishu_url` 改名为 `meta.external_doc_url`。
  - `trails/<id>.json`：取代 `.yaml`。删除 trail 的 `status/blocked_reason` 和 checkpoint 的 `result/result_detail`；新增 checkpoint 字段 `oracle_ids` 和 `origin: oracle|derived`。
  - `observations.jsonl`：新增，只追加。每次判定写一行，包含执行环境 `env`、状态、实际结果、证据（相对路径）、限制说明，以及 `supersedes`（用于纠偏）。
  - checkpoint 的当前状态、报告里的统计数字、`--continue` 要重跑的范围，都由脚本根据有效观察计算，不再由模型手工维护。计算取最严重的状态，不区分 loop 和 env。同一 plan_rev 内 fail/blocked/partial/manual 只能通过显式 supersede 解除，而且 supersede 只能发生在相同执行维度的观察之间。
- **证据分层**：报告引用的证据放 `evidence/`，被引用后不可覆盖，用 sha256 校验；执行过程中的其他产物放 `scratch/`。真实的 checking 数据默认不入库。
- **确认点落盘**：用户确认计划并选择执行策略后，由 `confirm.py` 一次记录一个 plan_rev；观察绑定它，追加前核验执行输入不变。
- **修改 oracle 后旧观察失效**：只使用粗粒度 plan_rev。oracle 重新冻结使当前计划失效；每次重新确认都生成新 plan_rev，全部旧观察过期，全部 checkpoint 必须重跑。不维护逐 item 哈希或局部失效。
- **外部来源接口（adapter）**：外部用例平台和外部文档输出由可执行脚本提供，通过环境变量 `CASE_VERIFY_ADAPTERS` 指定的目录发现。脚本用 `--describe` 自我描述，用 `fetch` 产出 oracle 片段，或用 `push` 输出报告。adapter 的输出必须先通过 oracle 校验，才能进入阶段 1。
- **门禁重写**：`validate_mock_gate.py`、`validate_trail_gate.py`、`validate_execution_gate.py` 改为读取 JSON，保留原有判定纪律；有意允许 partial/blocked 如实通过结构门禁（不计为 PASS），替代旧 result 枚举。另外新增：
  - oracle 校验；
  - 观察记录校验（pass/fail 必须带证据，或写明限制；证据路径不能越界；`supersedes` 必须合法）；
  - 追溯校验（`oracle_ids` 必须存在于 oracle，`origin: oracle` 的 checkpoint 不能没有挂载）；
  - 报告的两个新章节：「未覆盖的 oracle」和「派生 checkpoint」。

  所有门禁只用 Python 3.9+ 标准库。
- **脱敏**：公开 skill 不包含组织专属值。原来的内部用例平台 adapter 和内部文档输出改写成 adapter 脚本，放到私有 overlay 仓库。
- **部署切换**：`dsh build` 部署 `case-verify` 并验证后，删除旧软链 `~/.agents/skills/verifying-acceptance`。zy-hub 侧的源目录是否删除，不在本 change 范围内。

## Capabilities

### New Capabilities

- `case-verify-skill`：skill 的托管方式（manifest 登记、只经 sync 部署）、公开内容不含组织专属值、外部来源 adapter 的发现与调用契约。
- `case-verify-evidence`：checking 目录的数据模型（oracle / plan / trail / observations 与证据分层）、状态由观察记录计算、各个门禁的校验规则。

### Modified Capabilities

无。依赖的 `repo-layout` 约束（「公开仓库不硬编码组织专属值」「定制单元遵循社区 bundle 标准」「长期仓库仅保存必要且可维护的派生资产」）已覆盖本 change，不需要修改。

## Impact

- 新增 `skills/case-verify/`：SKILL.md、references/、scripts/（三个门禁、`validate_oracle.py`、`observe.py`、`status.py`、`confirm.py`、`adapters.py`、共享模型模块 `_model.py`）、tests/（Python unittest 与合成 fixture）。
- `dsh.yaml`：新增一个 skill 条目。`skills/README*.md`：补一行。
- `tests/case-verify.test.mjs`：由 `npm test` 调用 skill 自带的 Python 测试，并扫描 URL 主机名白名单。需要 python3 ≥ 3.9，不满足时显式 skip 并说明原因。
- `scripts/check-tracked-artifacts.mjs`：真实 checking 目录默认全部不入库（含归档深度）；新规则仅允许根层人工脱敏 report.md、summary.md，且仍受现有 docs 白名单等规则约束。
- 部署面：新增 `~/.dsh/skills/case-verify`，移除手工软链。对旧 checking 目录，门禁会报格式不受支持；`--continue` 无法续跑旧目录。
- 私有 overlay 仓库：新增 adapter 脚本，`.env.local` 中新增 `CASE_VERIFY_ADAPTERS`。这些修改在那边单独提交，本仓库不提及具体内容。
