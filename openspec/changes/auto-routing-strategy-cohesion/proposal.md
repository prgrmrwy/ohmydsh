## Why

auto-model-routing 的家族知识（哪些主模型受支持、transport 前缀、effort 起点、能力槽）散落在 `support.ts`、`policy-v2.ts`、`effort.ts`、`settings-contract.ts`、`subagent-tool.ts` 与设置页中，未来要支持新家族（如 DeepSeek）时没有一个可读、可替换的落点。同时插件保留了一条默认不走的 legacy 四档链路和多处“版本”概念（`policy: legacy | policy-v2`、`policyVersion`、`mappingVersion`、`rubricVersion`），使“再做一个 v3”成为自然的演进方向，并让设置页展示一组当前策略根本不读的映射表。

本变更只做两件事：把家族知识收敛成内聚的 strategy 模块；删除版本概念（含 legacy 链路）。当前默认 AUTO 的判断、改写、绑定与门禁链路保持不变。

## What Changes

- 新增 `src/strategies/`：每个家族一个可读的 TS 数据文件（`claude.ts`、`codex.ts`；家族 id 保持 `codex`，展示名 GPT），加一个 registry。支持判定、目录与允许列表纳入的 provider、transport 映射、子模型能力槽、effort 起点、子会话决策记录与 `route_subagent` 接受的 provider/family 全部从 registry 读取。新增家族的方式是加一个文件并在 registry 登记（PR），从主请求、官方 fresh 子会话创建、持久化到重启恢复都不需要改其它源码。
- 现有默认 AUTO 行为逐项保持：支持范围（仅 `claude-` / `gpt-` 家族）、不支持时锁 MANUAL、主会话 depth 最多移动一档、子会话三档能力槽、Magpie 双 transport 精确身份、effort 上限、官方允许列表与父会话 captured allowlist 校验、fork 不支持。
- **BREAKING（配置）** 删除 legacy 回滚链路：四档 Router、`rubric.json`、`CHILD_MODELS`、legacy `route_subagent` 分支、`mainEfforts` / `childRoutes` 设置的读取、校验与编辑 UI（route-picker、Claude/GPT 映射分页）、回复栏四档标注菜单与 `judgements.jsonl` 写入、`scripts/label-report.mjs`、`eval/run.mjs` 及其基线。回滚方式改为在 `dsh.yaml` pin 回 0.4.x 插件版本。
- 删除版本概念：移除 `settings.policy` 字段、`policyVersion`、`mappingVersion`、`rubricVersion`、子会话决策记录与反馈/事实事件的 `version` 字段、用量报告的 `schema` 字段、实测脚本的规则版本，以及子会话恢复时的版本比对门禁。标识符、文件名、工具描述、skill 与用户可见文案中的 `policy-v2` 改为不带版本的名称。反馈快照改为记录策略家族 id，不引入新的版本字段。
- 旧数据只读兼容：配置文件中残留的 `policy`、`mainEfforts`、`childRoutes` 读取时忽略（设置页提示不再生效，保存时去掉）；旧的子会话决策记录只额外接受三个已知历史键，其它未知键仍 fail closed；旧反馈账本行照常可读；状态目录路径不变；用量报告继续只读解析历史 `judgements.jsonl` 与带版本字段的旧快照（作为历史组）。
- 包发布版本升至 0.5.0（发布元数据，不进入运行时记录），同步 README、CHANGELOG、包内两个 skill、`docs/feedback-evaluation.md`、仍在使用的 `scripts/`、`eval/` 与根 `tests/auto-model-routing-sync.test.mjs`。归档时同时改写当前主 spec 中描述 legacy 回滚与版本分组的 Purpose 段落。

不在本期：本地 JSON 策略与覆盖/禁用、家族 id `codex` → `gpt` 改名、设置页只读展示策略列表、`route_subagent` 使用规则及环境级指令的改写。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auto-model-routing`：家族知识收敛为 strategy registry 并据此判定支持范围与路由；删除 legacy 回滚及其映射、判档记录、标注与设置要求；删除规则/映射版本要求；设置页去掉映射分页。
- `auto-allocation-feedback`：决策快照中的“策略与映射版本”改为“策略家族”；新事件不带版本字段；旧快照与旧事件可读。
- `auto-routing-usage-report`：分组键由 `policyVersion/mappingVersion` 改为策略家族（旧快照归入按原字段标识的历史组）；输出去掉 `schema`；历史账本仍只读用于定位首个 AUTO 记录。

## Impact

- 代码：`packages/auto-model-routing/src/`（新增 `strategies/`；删除 `router.ts`、四档 `rubric.json`、`judgements.ts`、`client/route-picker.ts`；重写 `support.ts`、`policy-v2.ts`（改名 `routing.ts`）、`effort.ts`、`settings*.ts`、`subagent-tool.ts`、`index.ts`、`endpoints.ts`、`feedback.ts`、`policy-store.ts`、`policy-host.ts`、`usage-report.ts`、`client/*`）；对应测试；删除 `scripts/label-report.mjs`、`eval/run.mjs`、`eval/baseline.json`、`eval/cases.json`；改写 `eval/policy-v2-*`、`scripts/magpie-live-acceptance.mjs`、`scripts/policy-v2-host-probe.mjs` 的命名与输出。
- 配置：`$DSH_HOME/plugins/dsh-auto-model-routing/config.json` 中的 legacy 字段不再生效（用户本机配置含 `childRoutes`）。
- 发布：包版本 0.5.0；`dsh.yaml` 中该条目版本与 note 同步；公开镜像随提交生成。回滚通过把该条目临时改为 `source: remote`、`spec: dsh-auto-model-routing@0.4.2`（npm 上已有）完成。
- 不变：Jev 请求协议与 `policy-v2-rubric.json` 内容（可改文件名，内容不变）、状态目录、会话模式存储、凭据与决策服务、官方 selectModel 同步、环境级指令。
