## Context

Jev 接线分两层（见归档 change `2026-09-25-bootstrap-jev-workflow-routing`）：接线层由 `dsh.yaml` 的 `thirdPartyResources[id=jev]` 声明，`scripts/lib/third-party-resources.mjs` 在部署期生成两样东西：

- profile 插入行 `third-party-jev-bridge`：`@deepseek-ai/dsh-mcp-client` 的 stdio 配置，`disabled` 以 `!!js` 在 cordis 加载时求值；
- `$DSH_HOME/managed-assets/jev-launcher.mjs`：读取凭据，再以**替换式** env 启动 pinned `@jkudish/jev-mcp`。

业务层 `skills/jev-workflow-router` 只通过工具名 `mcp__jev__jev_classify` / `jev_decide` 依赖接线层，并以 `recorder.mjs` 本地记录。

现状的三处硬编码：校验只接受 `credentialEnv: TYPESAFE_API_KEY`（第 98 行）；launcher 字面量为 `TYPESAFE_API_KEY` 与 `JEV_PROVIDER: 'typesafe'`（第 349–358 行）；`jev-readiness.mjs` 也写死该变量名，且只查找 `session.v3` 会话文件，而当前会话已是 v4。

约束：

- `dsh-mcp-client@0.2.0-rc.2` 的 stdio env 是“清洗后的父环境 + 显式 env”，只能在加载时求值，不能在每次调用时从官方 credentials 服务取值。
- 当前 pin 为 `@jkudish/jev-mcp@0.14.5`（依赖 `jev-agent-tools@0.2.1`）。`JEV_PROVIDER` 非 `auto` 时按名称精确选服务方，配置不全就抛错，不回退。jev-mcp 自带 OpenRouter 请求路径，含自身有界的 HTTP 状态重试（默认 3 次、60s 总期限）；本 change 不另加重试或跨服务方回退。
- 成功的 classify/decide 结果 JSON 含 `provider` 字段；失败时上游在产生该字段前就抛错，MCP 桥以错误返回，错误文本以 `OpenRouter decisions API <status>`、`TypeSafe API ...` 或 `Jev provider <name>: ... (HTTP <status>)` 开头。
- 2026-10-26 spike：OpenRouter 下 12 个工具全部可列出，一次 `jev_classify` 1.06s，结果含 `"provider": "openrouter"`。
- 现有校验与 `packagePins()` 把每个资源的 `package`、`provider`、`bridge` 字段都当作 npm 包 pin 遍历；`provider` 在 `npm-workflow` 条目中就是 skill-filesystem 包 pin。

## Goals / Non-Goals

**Goals:**
- 不改上游代码，只改接线层，就能在 `typesafe` 与 `openrouter` 之间切换；现役切到 `openrouter`。
- 保留现有安全性质：替换式 env、单一凭据变量、缺凭据静默退出、生成物与报告不含密钥。
- 新记录可区分服务方，使 TypeSafe 时期的失败不污染之后的 shadow 指标。

**Non-Goals:**
- 不改 shadow-only 边界、候选闭集、Phase 2 门槛（见 proposal）。
- 不支持 Cloudflare / Vercel，不实现跨服务方回退。
- 不让 MCP 桥读取官方凭据库。

## Decisions

### D1. 新字段名为 `jevProvider`，闭集只含 typesafe 与 openrouter
不复用 `provider`：该名已在 `npm-workflow` 条目中表示包 pin，若在 MCP 条目中放字符串，`packagePins()` 与完整性预检会把它当 pin 解析，导致 sync 失败（评审 C1）。改名比按类型改写三处 pin 遍历更小，也让两种语义在 manifest 中一眼可分。仍补一条混合资源回归测试，防止以后误用。

上游支持四种，本机只有这两种有凭据和需求。Cloudflare 需额外账户 ID 变量，会让“每个 provider 恰好一个凭据变量”的不变量变复杂。
*备选*：一次支持四种。*拒绝理由*：多出的两种没有真实使用和测试凭据，只增加未验证的分支；以后要用时再加。

### D2. `credentialEnv` 保留为显式字段，并与 provider 映射比对
manifest 同时写 `provider` 与 `credentialEnv`，校验要求二者一致。这样凭据变量名在 manifest 中可见，readiness 也可直接读取，不需要另一份映射表。
*备选*：去掉 `credentialEnv`，由 provider 推导。*拒绝理由*：这会改变既有字段契约，并让 readiness 与 sync 各自维护映射，可能出现漂移；显式字段加一致性校验同样不允许任意变量名。

### D3. launcher 由 provider 参数化，仍是固定字面量
`renderMcpLauncher(entry, { jevProvider, credentialEnv })`（调用方 `syncManagedLaunchers` 传入已校验的值） 在生成期把变量名和 provider 写成字面量，运行期不读取 manifest 或其它环境变量。变量名来自 D1/D2 的闭集映射，不来自用户输入，因此不存在注入面。

### D4. 凭据经 `.env.local` 注入 Host 启动环境
用户已确认这一方案。`scripts/launcher/environment.mjs` 已用 strict 模式解析 `.env.local`，并把全部条目合并进 Host 环境；无需新代码。
*备选*：launcher 直接读取 `~/.dsh/.credentials.yaml`。*拒绝理由*：这会绕过官方 credentials 服务，依赖其内部文件格式，DSH 升级后可能静默失效。代价是凭据库和 `.env.local` 各有一份 key，写入 manifest note。

### D5. `jevProvider` 与错误类别由 recorder 从有界调用投影确定性计算，而不是读 manifest
Agent 不传完整结果文本，只传每次调用的有界投影 `jevCalls`：成功调用传 `provider` 与 `semantic`（结果无法完整解析、被截断、不符合必需结构或含 `invalid_response` 状态时为 `invalid-response`，仅完整且结构合法时为 `ok`），失败调用传截断到 512 字符的错误文本。recorder 按 spec 中的锚定格式识别服务方与 HTTP 状态，不在任意文本中搜索数字（评审 R2-M1）；上游超时文本 `Jev request exceeded the Nms deadline` 归为 `timeout`。
服务方归属与错误类别分开计算（R2-M2）：没有失败调用时，`semantic: invalid-response` 记为 `malformed-response`，否则保留 Agent 输入的类别。因此 `missing-credential`、`cancelled` 等 Agent 观察到的失败不会被改写为 `none`，现有失败门槛的含义不变。
这反映实际处理调用的服务方；若 manifest 被改但 Host 尚未重启，读 manifest 会记错。无法识别时一律为 `unknown`。报告只对 `real-vibe` 记录按服务方拆分，单列 `unknown` 组并注明拆分只覆盖可归属记录（评审 M1），不改 Phase 2 门槛计算。
*备选*：传完整结果 JSON 再截断解析。*拒绝理由*：长 decide 输出截断后无法解析，也扩大 recorder 的隐私面（R2-S1）。

### D5a. 原始文本入口的保密与惰性
这是对 SKILL「参数中不得出现原始错误」规则的一处窄例外：至多 512 字符的错误文本只经本地 recorder 的 stdin 参与归一化，不进入命令参数、持久化记录或 stdout/stderr（R2-M3）。唯一允许的落盘是本次调用的临时 stdin JSON：Agent 用文件写入工具写入仅当前用户可读写的临时文件，以 `node recorder.mjs record < file` 传入，并在成功或失败后清理；不得把工具输出拼进 shell、heredoc 或 argv。recorder 对非法 JSON 只输出固定诊断 `invalid JSON input`，不回显 Node 解析器给出的输入片段。所有计算只做数据解析，不执行任何内容。

### D6. `region-blocked` 加入错误闭集
451 是此前失败的真实原因，却被记为 `unknown`。单列出来后，报告可以区分地区封锁与其它失败。

### D7. readiness 同时识别 v4 与 v3 会话文件
优先查找 v4，再查找 v3。这是接线诊断工具，与本 change 的验证直接相关。

### D8. 凭据保密边界划在 launcher 自身
替换式 env 只能限制子进程拿到什么，不能限制它输出什么；launcher 用 `stdio: 'inherit'` 直接承载 MCP 字节流，过滤输出会破坏协议。因此保密要求只覆盖 launcher 自身的诊断与生成物；pinned jev-mcp 视为受信组件，其已审阅的错误路径只输出状态码与类别（评审 M2）。recorder 侧另有保证：错误原文不进入持久化记录或 recorder 输出（唯一例外是 D5a 中用完即删的临时 stdin 文件）。

## Risks / Trade-offs

- [OpenRouter 也可能对某些出口拒绝] → 已在本机实测成功；失败时按 `region-blocked` 或 `unauthorized` 记录，可见且不回退。回滚只需改回 `typesafe`。
- [两处 key 可能不一致] → readiness 只报告存在性；note 写明双处维护。auto-model-routing 与 Jev MCP 各自失败可见，不会互相掩盖。
- [清洗后的父环境与显式 env 合并，可能让 MCP 桥看到更多变量] → launcher 是替换式 env，jev-mcp 进程只见两个变量；该性质有测试保护。
- [旧记录与网络类失败为 `jevProvider: unknown`，会继续计入总失败率] → 报告单列 `unknown` 组并注明拆分范围；准入门槛计算不改（不在本 change 范围）。
- [上游错误文本格式变化导致识别失效] → 识别失效时退回 `unknown`，不会误归属；升级 jev-mcp pin 时复核前缀，测试固定当前前缀。

## Migration Plan

1. 实现并通过 `npm test`。
2. 用户在仓库 `.env.local` 中加入 `export OPENROUTER_API_KEY=...`（由用户本人写入；agent 不读取、不复制 key）。
3. 修改 `dsh.yaml`：`jevProvider: openrouter`、`credentialEnv: OPENROUTER_API_KEY`，并更新 note；运行 `dsh build`，再运行一次确认幂等。
4. 重启 Host；在新会话运行 `node scripts/jev-readiness.mjs`，确认 `liveProbeReady: true`，并做一次真实 shadow 调用与记录。
5. 回滚：改回 `typesafe` / `TYPESAFE_API_KEY`，`dsh build`，重启。

## Open Questions

- OpenRouter 数据保留条款尚未单独复核；用户已决定使用，并在 note 中标为未复核。
