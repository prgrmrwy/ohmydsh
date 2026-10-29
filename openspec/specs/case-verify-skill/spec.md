# case-verify-skill Specification

## Purpose

规定 case-verify 验收 skill 在 ohmydsh 中的托管方式：由 manifest 登记，只经 sync 部署；公开内容不含组织专属值；组织专属的用例来源和报告输出通过可执行 adapter 接入，并以确定性方式被发现和校验。

## Requirements

### Requirement: skill 由 manifest 登记并只经 sync 部署
`case-verify` SHALL 以 `type: skill` 条目登记在公开 `dsh.yaml`，源目录为 `skills/case-verify/`。条目 SHALL 带 `brief` 和 `note`，`note` 写明来源、信任面（会执行的脚本与外部工具）、升级复核条件、移除方式。部署 SHALL 只由 sync 复制到 `$DSH_HOME/skills/case-verify`。

#### Scenario: 启用后部署且幂等
- **GIVEN** 条目 `enabled: true`
- **WHEN** 在隔离的 `DSH_HOME` 中连续运行两次 sync
- **THEN** 第一次运行后 `$DSH_HOME/skills/case-verify/SKILL.md` 与仓库源逐字节一致；第二次运行不报告任何变化

#### Scenario: 禁用后移除
- **GIVEN** 已部署的 `case-verify`
- **WHEN** 把条目改为 `enabled: false` 后运行 sync
- **THEN** `$DSH_HOME/skills/case-verify` 不存在，仓库中的 `skills/case-verify/` 内容不变

### Requirement: 公开 skill 不含组织专属值
`skills/case-verify/` 下所有文件中出现的 URL 主机名 SHALL 只来自以下白名单：`*.example`、`example.com`、`localhost`、`127.0.0.1`，以及在测试中显式列出的公开站点。组织专属的平台名、CLI 名和登录方式 SHALL NOT 出现在公开 skill 中。

#### Scenario: 主机名白名单通过
- **GIVEN** 当前的 `skills/case-verify/` 目录
- **WHEN** 运行仓库测试中的 URL 主机名扫描
- **THEN** 扫描结果中没有白名单以外的主机名

#### Scenario: 混入内部域名被拦截
- **GIVEN** 在 skill 目录的某个文件中加入一个不在白名单内的 URL，例如 `https://qa.corp-internal.test/case/1`
- **WHEN** 运行同一扫描
- **THEN** 测试失败，并报出该文件和该主机名

### Requirement: adapter 通过环境变量确定性发现
adapter SHALL 是一个可执行文件，放在环境变量 `CASE_VERIFY_ADAPTERS` 指定的目录中（可写多个目录，用 `:` 分隔）。目录中的每个可执行普通文件都视为一个候选 adapter。

发现脚本 SHALL 对每个候选执行 `<adapter> --describe`，超时上限 10 秒。命令的 stdout SHALL 是一个 JSON 对象，包含以下字段：
- `name`：必须匹配 `^[a-z][a-z0-9-]{0,39}$`，并且在所有发现目录中唯一
- `kind`：`oracle-source` 或 `report-sink`
- `kind: oracle-source` 时，还需要 `match`（URL 正则）和 `provenance`（`independent` 或 `spec`）

以下候选 SHALL 被排除：描述不合法、超时、退出码非 0。多个候选的 `name` 相同时，这些候选全部排除，不按遍历顺序挑选其中一个。每个被排除的候选都 SHALL 在输出中说明原因，不得静默忽略。环境变量未设置时，adapter 列表为空，这不算错误。

#### Scenario: 匹配唯一 adapter
- **GIVEN** `CASE_VERIFY_ADAPTERS` 指向一个目录，其中有一个合法的 `oracle-source` adapter，它的 `match` 能匹配 `https://qa.example/case/42`
- **WHEN** 运行 `adapters.py match https://qa.example/case/42`
- **THEN** 退出码为 0，stdout 中给出该 adapter 的路径和描述

#### Scenario: 无匹配或多重匹配
- **GIVEN** 没有任何 adapter 能匹配给定 URL，或者有两个 adapter 同时匹配
- **WHEN** 运行 `adapters.py match <url>`
- **THEN** 退出码非 0；stderr 写明“无匹配”或列出所有冲突的 adapter

#### Scenario: 名称不安全或重名
- **GIVEN** 一个候选的 `name` 为 `../../trails`；另有两个目录各放了一个 `name` 为 `qa` 的候选
- **WHEN** 运行 `adapters.py list`
- **THEN** 这三个候选都不在可用列表中；输出分别注明“名称不合法”和“名称冲突”，以及冲突候选的路径

#### Scenario: 描述非法的候选
- **GIVEN** 目录中有一个可执行文件，它的 `--describe` 输出不是 JSON
- **WHEN** 运行 `adapters.py list`
- **THEN** 该文件不出现在可用列表中，输出里写明它的路径和排除原因

### Requirement: oracle-source adapter 的输出经校验后才能进入阶段 1
skill SHALL 只通过 `adapters.py run fetch <url> --checking-dir <d>` 调用 oracle-source adapter。包装器以 `<adapter> fetch <url> --out <dir>` 的形式执行 adapter，其中 `<dir>` 为 `oracle-sources/<name>/<n>/`，`<n>` 是本次调用的序号，从 1 递增。包装器在创建 `<dir>` 之前 SHALL 确认它解析后仍在 checking 目录内，并且路径中没有已存在的符号链接。adapter 以非 0 退出时，包装器 SHALL 不解析 `<dir>` 中的任何残留文件。adapter SHALL 把 `oracle.fragment.json` 写入 `<dir>`，格式为 `{"items": [...]}`，item 的结构与 `oracle.json` 一致（见 case-verify-evidence 能力）。

片段 SHALL 先通过 `validate_oracle.py --fragment` 校验，才能参与阶段 1 的合并。合并时，item 的 `provenance` SHALL 采用 adapter 声明的值。对于能被已安装 adapter 处理的链接，skill SHALL NOT 再向用户索取 XMind 文件。

#### Scenario: 合法片段进入合并
- **GIVEN** 一个声明 `provenance: independent` 的 adapter 输出了 2 个合法 item
- **WHEN** 阶段 1 通过包装器调用它，并校验片段
- **THEN** 校验通过；合并后，这 2 个 item 的 `provenance` 为 `independent`，`source` 为该 adapter 的名字

#### Scenario: 声明为 spec 的来源不被升级
- **GIVEN** 一个声明 `provenance: spec` 的 adapter，它输出的片段中某个 item 写了 `provenance: independent`
- **WHEN** 合并片段
- **THEN** 该 item 合并后的 `provenance` 为 `spec`

#### Scenario: 多次拉取互不覆盖
- **GIVEN** 同一个 adapter 先后拉取了两个不同的 URL
- **WHEN** 两次调用都成功
- **THEN** 两份片段分别位于 `oracle-sources/<name>/1/` 和 `oracle-sources/<name>/2/`，两份都还在

#### Scenario: 片段非法时停止
- **GIVEN** adapter 以 0 退出，但输出的某个 item 缺少 `expected` 字段
- **WHEN** 运行片段校验
- **THEN** 校验失败，报出该 item 的索引和字段名 `expected`；这个片段不被并入 oracle

#### Scenario: adapter 执行失败
- **GIVEN** adapter 以非 0 退出，`<dir>` 中残留了一个合法的 `oracle.fragment.json`
- **WHEN** 包装器处理这次调用
- **THEN** 包装器以非 0 退出，输出 adapter 的退出码和 stderr 尾部；残留的片段不被校验，也不被合并

#### Scenario: 没有可用 adapter
- **GIVEN** 用户给出一个外部用例平台的链接，但 `adapters.py match` 返回无匹配
- **WHEN** 进入阶段 1
- **THEN** skill 告诉用户当前没有能处理该链接的 adapter，并请用户改为提供 XMind 导出文件或用例文本；不得猜测拉取方式

### Requirement: report-sink adapter 只在报告门禁通过后推送
skill SHALL 在每次推送前针对当前目录运行 `validate_execution_gate.py --checking-dir <dir> --require-report` 并成功后才调用 report-sink adapter，不能用不带标志或先前版本的通过代替，调用方式为 `<adapter> push <checking-dir>`。adapter 成功时 SHALL 在 stdout 的最后一行输出外部文档的 URL；skill 把这个 URL 写入 `plan.json` 的 `meta.external_doc_url`。

如果 `meta.external_doc_url` 已经存在，SHALL 通过环境变量 `CASE_VERIFY_EXTERNAL_DOC_URL` 把它传给 adapter，由 adapter 追加新的 loop，而不是新建文档。推送失败 SHALL NOT 影响本地 `report.md`，也 SHALL NOT 改变验收结论。

#### Scenario: 首次推送记录地址
- **GIVEN** 门禁已通过，`meta.external_doc_url` 为 null，存在一个 report-sink adapter
- **WHEN** skill 调用 push，adapter 输出 `https://docs.example/d/1`
- **THEN** `plan.json` 的 `meta.external_doc_url` 被写为 `https://docs.example/d/1`

#### Scenario: 报告无效时不调用推送
- **GIVEN** 报告缺失、缺章节或机器摘要不一致，adapter 会记录调用次数
- **WHEN** 通过包装器请求 push
- **THEN** 包装器非 0，adapter 调用次数为 0，external_doc_url 原值不变

#### Scenario: 推送失败不影响本地结论
- **GIVEN** 门禁已通过，report-sink adapter 以非 0 退出
- **WHEN** skill 处理推送结果
- **THEN** `report.md` 和观察记录保持不变；`meta.external_doc_url` 保持原值；最终回复中注明推送失败

### Requirement: 门禁与模型脚本只依赖 Python 标准库并纳入仓库测试
`skills/case-verify/scripts/` 下的全部脚本 SHALL 只依赖 Python 3.9+ 标准库。`npm test` SHALL 运行 skill 自带的测试。如果本机缺少 Python 3.9+，SHALL 以 skip 状态显式报告原因，不得静默通过。

#### Scenario: 仓库测试运行 skill 测试
- **GIVEN** 本机有 Python 3.9+
- **WHEN** 运行 `npm test`
- **THEN** skill 的 Python 测试被执行；任何一个 Python 用例失败都会让 `npm test` 失败

#### Scenario: 缺少合适的 Python
- **GIVEN** 测试运行环境中 `python3` 不可用，或者版本低于 3.9
- **WHEN** 运行 `npm test`
- **THEN** Node 测试报告中，对应用例的状态为 skip，skip 原因中写明 Python 版本要求；该用例不被计为 pass

#### Scenario: Python 用例失败
- **GIVEN** skill 的某个 Python 用例失败
- **WHEN** 运行 `npm test`
- **THEN** `npm test` 以非 0 退出

#### Scenario: 不引入第三方模块
- **GIVEN** `skills/case-verify/scripts/` 下的所有 `.py` 文件
- **WHEN** 测试解析其中的 import 语句，与 `sys.stdlib_module_names` 及 scripts 目录内的本地模块对比（Python 3.9 没有前者时，使用测试内置的模块清单）
- **THEN** 没有任何不在白名单内的 import；如果在 fixture 中故意加入 `import yaml`，同一检查会失败，并报出该文件和模块名

### Requirement: 真实验收数据默认不入库
真实 checking 目录中的 plan、trail、oracle、观察、日志和原始证据都可能含私有文本。制品检查 SHALL 默认拦截 `openspec/changes/**/checking/**`（含 archive 任意深度）和 `docs/checking/**` 的全部文件，只豁免 checking 根层的 `report.md`、`summary.md`。这两个文件必须由人确认已脱敏；路径豁免不是内容安全证明。原有规则（包括 docs 白名单）仍然叠加生效，不因本规则豁免而自动放行。

实现 SHALL 同时通过 .gitignore 防止真实数据默认被 add。`skills/case-verify/tests/fixtures/` 中合成数据不属于真实 checking 根，不受新增规则影响。

#### Scenario: 拦截真实数据及归档副本
- **GIVEN** 路径列表包括 `openspec/changes/x/checking/plan.json`、该目录的 `trails/T1.json` 和 `gates/adapter.txt`，以及 `openspec/changes/archive/2026-x/checking/observations.jsonl`
- **WHEN** 运行制品检查
- **THEN** 全部报为违规；.gitignore 检查也匹配这些路径

#### Scenario: fixture 与脱敏报告不触发新增规则
- **GIVEN** 合成 fixture 和 `openspec/changes/x/checking/report.md`、`summary.md`
- **WHEN** 运行制品检查
- **THEN** 不触发新增规则；`docs/checking/x/report.md` 虽不触发新增规则，仍触发既有 docs 白名单限制
