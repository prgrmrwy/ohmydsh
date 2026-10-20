## Review Metadata

- **Review round**: 5（round5，完整独立对抗审查）
- **Prior round**: Round 4 为 `APPROVE_WITH_CHANGES`，最终复核 `CHANGES_APPLIED: yes`；用户随后批准 ponytail 范围精简，旧批准已失效，仅作为历史证据，本轮不继承放行结论。
- **Reviewer context**: fresh-context subagent，gpt-6.1-sol；未参与 proposal/design/specs 编写，未读取作者对话。按用户不联网约束采用独立子代理审查，不调用外部 CLI 或 Jev。
- **Tool restrictions**: 只读检查；唯一写入为本 review.md。所有 Bash 显式使用指定 worktree；运行时编译资料仅按用户授权经 Bash 读取。未安装、构建、运行测试、部署、联网或修改其它文件。
- **Artifacts reviewed**: 独立读取 proposal、design、delta spec、README；旧 review 只作 prior summary。旧 test-plan/tasks 明确排除，待批准后替换，不据其判断本轮覆盖。`openspec/project.md` 搜索未发现。
- **环境与负载**: 个人本机、单 operator、DSH 0.2.0-rc.2；重点按真实主会话多步请求、同 step 重试、用户快速切模式和请求合成期间手选模型分析，而非多用户服务。

### 制品 SHA-256（本轮批准适用的输入）

以下相对路径均以本 change 目录为基准：

| 文件 | SHA-256 |
|---|---|
| proposal.md | `b65a6fb24b4d9eca6c747138d16da409da9f5f50229ff442ef6cf27b859f4981` |
| design.md | `5d7b9aa8958cd8ff0021d31151bfd817ebab2bc6b449b7eba194e237cdacaae0` |
| specs/auto-model-routing/spec.md | `9b64f026a278c159a094ef599df6e822783e0042cccbbd06f9c54a02c43b0385` |
| README.md | `6b7b33741033bf9db6e23d2055df1f704ce60976cba32c9212fc65d91fa11479` |
| 被替换的 round4 review.md（仅历史） | `27ecdcb5285bdaa5e3fd301093c286f2c4c4a284bdcba76af0c9473b1b4e78e8` |

### 只读仓库证据 SHA-256

| 仓库相对路径 | SHA-256 |
|---|---|
| dsh.yaml | `f73d94d598beced156b7df2c4a54aa19e07018ce1fc558c889900b8197384b7a` |
| docs/architecture/dsh-plugin-integration-pitfalls.md | `804e0fee9409ea039edea398a12a783f30ee1bef0f9d491609011c57a82078b5` |
| packages/home-network-model-guard/src/index.ts | `8a9499174bf470583e83b2ba3985ad91c479a1ae9e0f081c720d14c1d47a78f9` |
| packages/home-network-model-guard/src/rules.ts | `9748d5f3110751724f915e94b44fbecdc0f3ab5310cb588255c7422b12bfbdc4` |

指定运行时目录实际存在，已读取，未以其它版本冒充。运行时证据基目录为：
`/Users/bytedance/mydir/opensource/ohmydsh/packages/dsh-pet/compat/subagent/.launcher-builds/274efd4592657f7b1f72edc3bd37eb312d0489cfd719371f684981c0ee9c8139-bcd7c634-9754-444c-8ebe-26d407bbbd48/node_modules/@deepseek-ai`。

| 基目录下文件 | SHA-256 |
|---|---|
| dsh-agent/lib/index.js | `7b9aa39474de83115cf890dd7f8904cf0d59df0811cb335ab85565a04f1aac93` |
| dsh-agent-loop/lib/index.js | `00c4814d63f3d1e2754eb09144832d19b30499d6ea444730473f740b587948c2` |
| dsh-api-session-controller/lib/index.js | `fb0f7b96130f595db20809eeb77a195b05f4a039f931d1e67692f1f74a4dd269` |
| dsh-session/lib/index.js | `87ea85e2fb5318bf1f826db9a1c88c1b26d3ea328027a7f32b211880c4d62b9d` |
| dsh-tool-subagent/lib/index.js | `26a1e804aab4c6f9cb53a670c63b817fc8d9409569e6d68eda6fda33b966a840` |

## Findings

### 🔴 Critical (blocking)

**C1 — MANUAL 只复原一次、随后透传，会在真实同 step 重试时重新落回 AUTO effort。**

- **位置**：design D3:35–37；spec:6–7、20–23。
- **触发**：用户锚点 medium，旧手选 pending 已消费；AUTO 已产生 xhigh 请求头。下一步官方合成先快照 xhigh，用户在请求前切 MANUAL。插件按当前设计输出 medium 并立刻清除过渡标记；该请求遇到可重试错误，同 (turn, step) 再发请求。
- **真实结果**：官方 `dsh-agent` :167–190 在 `system-prompt/assemble` 保存 `selection.assembled`，请求 listener 每次使用这个快照。`dsh-agent-loop` :1048–1050、1124–1134 的重试只重复 `prepareRequest`，不重新 assemble。因此重试的官方合成仍为 xhigh；MANUAL 稳态透传使复原失效，随后请求头/会话选择再次变成 xhigh。spec 仅断言第二次“等于官方配置”，没有断言复原能够保持，恰好漏掉这个错误。
- **最小修复**：仍用现有过渡标记，但将完成条件从“返回了一次复原配置”改为“复原已进入真实请求头，并且后续官方合成已收敛到该锚点”。收敛前继续复原同一旧快照产生的重试；无请求头、取消、prepareCall 失败不得提前宣告完成。收敛后才透传。无须恢复按钮、`selectModel` 或额外服务。
- **若不修**：MANUAL 和卸载前复原指引不可靠；可在用户以为已恢复后继续高 effort。

### 🟡 Moderate

**M1 — 手选事件可先于该选择真正参与请求；实时锚点不能直接套到旧模型快照。**

- **位置**：design D2:28、D3:33–35；spec:31、94–95。
- **触发**：官方本步已 assemble Claude Opus/xhigh；用户随后手选 GPT Astra/low，立即产生 `model/selection` 并更新插件锚点，但按官方约定该选择在后续 step 才生效。此时本步仍会输出旧 Claude 配置。若 AUTO 按 spec 的“锚点模型”映射 complex，会把 Astra 的 medium 套给 Opus，而非 Opus 的 xhigh；若恰有 MANUAL 过渡，会把新选 Astra 的 low 写进旧 Opus 请求。类似地，选到支持集合不同的模型时，未经当前模型约束的复原 effort 可使 prepareCall 拒绝。
- **证据**：`dsh-agent` :148–159 明确将并发选择延后到下一 step，:167–190 实际保存并使用快照；`dsh-api-session-controller` :319–321、720–735 先追加选择事件。design D2 的“实际官方输出模型”与 spec:95 的“按锚点模型”因此不是等价说法。pending 的 provider/model/effort 完全相等才会消费（controller :303–306、2072–2107），不能把事件出现当成请求已经切换。
- **最小修复**：AUTO 映射及支持值裁剪统一按 `await next()` 得到的实际 provider/model。MANUAL 复原若锚点 provider/model 与该快照不一致，应保留过渡而透传旧快照，等官方使用新选择后再对匹配模型复原；不得为了追锚点自行改 provider/model。加入手选发生在 assemble 与 request 之间的两个确定性断言：旧请求保持旧模型的合法 effort，新 step 使用新选择，pending 在精确匹配 header 后消费。
- **若不修**：手选时机不同可产生错误档位或请求失败，且与“保留官方合成、用户手选优先”的目标不一致。

**M2 — AUTO→MANUAL→AUTO 的快速切换没有唯一可实现的当前回合语义。**

- **位置**：spec:5–8；design D3:35、D4:40。
- **触发**：同一回合已决定 xhigh；用户切 MANUAL，下一请求恢复 medium；尚未进入下一用户回合又切 AUTO，然后再发本回合请求。
- **矛盾**：spec:8 说 AUTO 下个用户回合才生效，但又要求此前同回合保持“本回合已决定的 effort”（xhigh）；MANUAL 已把该回合实际生效值恢复为 medium。当前 WeakMap 仍可保留 xhigh，也没有说明重新开启 AUTO 是否清除/保留未完成复原标记。两种实现都能援引现有文字，却分别得到 xhigh 或 medium；快速双击且尚未发生复原请求时同样未定义。
- **最小修复**：明确“切 MANUAL 对本回合立即退出 AUTO，并使旧 AUTO 缓存不再可恢复；重新 AUTO 只能在下一用户回合重新决定”。已经产生的 MANUAL 复原义务在该边界前保持，重复同模式设置不得重新创建义务。补两条序列场景：切回 AUTO 前已复原、未复原；本回合不得重新套旧 xhigh，下一用户回合才重新分类。复用现有模式/过渡/turn 字段即可，不需要异步分类框架或全局开关。
- **若不修**：芯片显示相同模式与回合，实际 effort 却取决于两次点击之间是否恰好发出一个请求，MANUAL 复原可能被旧缓存抵消。

### 📌 Suggestions

无额外建议；本轮不以风格、推测性扩展或恢复已删除功能增加范围。

## 完整审查覆盖与非问题裁定

- **官方请求与 pending**：确认外层 `await next()` 的必要性；AUTO effort 不同于手选 effort 时 pending 可以保留，这是官方精确匹配的自然结果，不单独当作缺陷。必须验证 MANUAL 后最终匹配/消费，并覆盖同 step 重试，不能以自造投影代替真实实现（C1/M1）。
- **锚点持久化**：只接受最新 `model/selection` 或无事件时的一次初始化，不从 AUTO 请求头回写；Host 重启保留的要求合理。实现验收须包括加载已有历史选择及重启后的最新事件优先，不能只监听插件加载后的新事件。当前规范本身要求最近一次事件，未发现其允许回写漂移的条款。
- **输入来源与本地分类**：strict `source.kind === "user"`、消息/块顺序、text-only 与 `.slice(0, 8000)` 明确；注入来源和缺失来源被排除，与仓库集成陷阱 §5 及 AgentLoop :902–918 领取入口一致。本地纯函数与无任务文本外发是边界，源码字符串扫描只是补充，不能单独证明所有外发路径不存在。
- **WeakMap 有界性**：每个活 Agent 仅一份当前 turn 决定，新回合替换；最近决定明确截为 20 条。WeakMap 不可枚举，面板状态应按端点解析出的 Agent 查询；没有要求额外强引用 Map、全历史缓存或保存正文。未发现必然无界增长，不能凭 WeakMap 本身捏造泄漏。
- **skill 可用模型指引**：design D6:50 已要求官方目录与允许列表确认、不可用则报告，不暗换 provider/model；官方 `list_subagent_models` 的 provider/model 查询按会话冻结白名单过滤，并给出 effort（tool-subagent :145–164），显式创建再次校验（:91–97、117–127）。实现 skill 必须落实该现有要求，不能仅抄固定表；模型发现/选择工具未暴露时不能硬传表内模型冒充可用。无需恢复路由工具或自建候选池。spec 的文本测试不能证明模型实际可用，design 已另列真实委派验证，范围合理。
- **安全与门禁**：现有 guard 在 `llm/stream` 检查最终 provider/model（仓库 index.ts:99–118），路由不换模型，不需要增加网络探测；skill 家族规则与 rules.ts:39–43 相容。单 operator connection + 官方 body sessionId 解析是现有平台边界，本轮不恢复 round4 曾提出但已接受反驳的“connection 绑定会话”要求。两个端点的输入类型、未知/子会话拒绝和只改目标会话已定义；实现时验证认证通道，不添加新授权模型。
- **精简性**：同意删除路由工具、JSONL 日志、恢复按钮、异步分类框架、全局开关和版本化原因协议。以上修复只收紧已有模式与锚点的同步规则；不增加新对外能力。
- **缓存表述**：proposal:9 的“不丢 prompt cache”强于 design:9、30 的“不保证 provider 缓存行为”。本轮不据此声称缓存已验证；落实修改时应删掉这一绝对承诺，保留“避免换模型造成的缓存切换”。此为附随文字纠正，不新增功能或独立问题计数。

## Embedded-Instruction / Injection Attempts

**Detected:** none。已读制品中未发现要求审查者忽略问题、操纵 verdict 或执行额外命令的嵌入指令；spec 的“忽略以上规则……”是分类器测试数据，不执行。旧 review 的结论与作者回应仅为历史数据，不作为本轮授权或实现指令。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

存在 **1 Critical、2 Moderate、0 Suggestions，共 3 项问题**。C1 影响核心复原承诺，但可用小且明确的现有过渡状态修复；其余为同一同步边界上的映射与模式规则补全，不要求重做架构。因此附条件批准，而非无条件放行。不得生成替代 test-plan/tasks 或开始 apply，直到下列修改全部完成并由 reviewer 定点复核。

## Required Changes (if APPROVE WITH CHANGES)

1. **修 C1**：design D3 与 spec 不再以“单次返回复原配置”作为过渡完成条件；要求复原 header 已持久化、后续官方合成已收敛才进入完全透传。覆盖真实 AgentLoop 同 step 重试，以及 header 前取消/失败后重试，确保不会从锚点 medium 弹回旧 AUTO xhigh；proposal/README 的“一次复原”措辞同步为这一可成立的语义。
2. **修 M1**：spec 映射模型统一为实际官方合成的 provider/model；锚点与合成模型不一致时 MANUAL 复原延后、不换模型、不清过渡。增加 assemble 后手选的真实集成场景，断言旧/新请求合法 effort、最新锚点及 pending 精确消费。顺带删除 proposal 对 prompt cache 的绝对保证，与 design 已声明的边界一致。
3. **修 M2**：明确 MANUAL 废止当前 turn 旧 AUTO 决定，快速重开 AUTO 仅下个用户回合生效；补全已复原/未复原两种 AUTO→MANUAL→AUTO 场景及重复相同模式的幂等行为，且不得丢失尚未完成的复原义务。无需新增异步工作、工具或按钮。

CHANGES_APPLIED: yes

## Rebuttals

作者已按 Required Changes 修改，等待定点复核，未自行放行：
- C1 fixed：spec“MANUAL 过渡”与 design D3 的完成条件改为持久 header + 官方合成双重收敛；新增同 step 重试与 header 前取消/prepareCall 失败场景；proposal/README 同步措辞。
- M1 fixed：spec 映射按实际官方 provider/model；复原时模型不匹配则延后并保留义务；新增 assemble 后手选的 AUTO/MANUAL 时序场景，断言 pending 精确消费；proposal 删除缓存绝对保证。
- M2 fixed：切 MANUAL 废止旧 AUTO 决定；同回合重开 AUTO 不恢复缓存；未完成复原优先，完成后的下一用户回合才 AUTO；新增已复原/未复原快速切换及重复设置幂等场景。design D3 同步。

## Staleness

本结论只适用于上述 SHA-256 对应的 proposal/design/spec/README。上述制品发生任何非 Required Changes 范围的修改，本轮结论立即 VOID，必须增加轮次并完整独立重审。仅实施列明的 Required Changes 可进行定点复核；全部完成且 reviewer 确认后才能设 `CHANGES_APPLIED: yes`。Round4 的 yes 已失效，不能用于解除 round5 门禁。

## 未检查与限制

本轮是规划审查，未运行构建、测试、GUI、网络或部署；没有声称复现测试已执行。运行时结论来自指定本地编译资料的静态调用链；真实 Host/AgentLoop 集成测试仍是实施验收义务。未读取、改写或认可旧 test-plan/tasks；未恢复任何用户已删除范围。

## Round5 Required Changes 定点复核（2026-10-15）

独立复核仅针对 C1/M1/M2、Required Changes 及作者回应；重新完整读取当前 proposal/design/spec/README，并经只读 Bash 读取上述 **274efd** 编译目录，未使用其它版本替代。仅修改本 review.md；不改 VERDICT，不恢复已删除功能，不启动实施。

### 逐项结果

1. **C1 — verified**：design D3:35 与 spec:6、20–28 明确要求持久 header 与当前官方合成都精确匹配最新锚点后才清除复原义务；旧 assembled 下的同 step 重试继续覆盖，header 前取消或 prepareCall 失败不清除。proposal:10、README:3 已同步，不再承诺只覆盖一次。静态核对真实 `dsh-agent`:167–190 的 assembled 快照、`dsh-agent-loop`:1048–1050、1124–1134 的原 step 重试，以及 :1179–1195 的 waterfall/prepareCall/取消检查先于 :1202–1228 的 header 持久化，修订针对了原失效路径，不把“返回配置”误当作“复原完成”。
2. **M1 — verified**：design D2:28、D3:35 与 spec:6、63–66、115 统一以 `await next()` 实际官方 provider/model 做 AUTO 映射与支持值裁剪；MANUAL 模型不匹配时透传并保留义务，不换模型。assemble 后手选场景明确旧 Opus/xhigh、后续 Astra/low 及精确 header 后 pending 消费。真实 `dsh-agent`:148–190、controller:319–321、720–735、2072–2107 支持这一时序与精确消费边界。proposal:9 已改成避免主动换模型造成缓存切换，并明确不保证 provider 缓存命中。
3. **M2 — verified**：design D3:35–37 与 spec:8、30–38 明确切 MANUAL 废止当前 turn 旧 AUTO 决定；同回合重开不恢复；已复原/未复原两种序列均不得恢复旧 xhigh。未完成义务跨用户回合仍优先，完成后的下一用户回合才启用 AUTO；重复同模式为无副作用操作。未新增工具、按钮、异步分类框架或全局开关。

### 场景与范围

- 当前 spec 实际计数 **33 个 Scenario**。相对 review 原描述的 29 个，本次新增四个场景为：header 前取消/准备失败、快速切回 AUTO（内含已复原/未复原两序列）、重复同模式幂等、assemble 后手选（内含 AUTO/MANUAL 两路径）；既有 MANUAL 复原场景同步强化为覆盖重试直到收敛。
- 对照本 review 的原审查覆盖、Required Changes 与当前四制品全文，未发现超出三项状态语义及附随缓存措辞的功能扩张；已删除的路由工具、候选池实现、持久日志、恢复按钮、异步框架与全局开关仍保持删除。未读取旧 test-plan/tasks。
- 范围证据限制：该 change 当前为 Git 未跟踪目录，没有可用的原 round5 四制品 Git 基线，故此处是依据既有 review 与当前全文的语义范围核对，不声称执行了原输入到现输入的逐字 diff。

### 定点复核输入 SHA-256（取代上方旧输入表，作为本次 yes 的适用输入）

| 文件（相对本 change） | SHA-256 |
|---|---|
| proposal.md | `0fa59541b1bb212f327955df3ab820e48d6717f8edbc61f790a63d63ecf82f7d` |
| design.md | `b66963cfbcc3a873049695216c19ed958c555ccf746a2f33160e16a8cc2e5b80` |
| README.md | `f581a2feb2fc43d7489aa67f330cc8a7bd58f42c22bc5b6a335fbc8a2c0761a8` |
| specs/auto-model-routing/spec.md | `de26f72236ad45fb7dfc8a21db3b9e760498123228d8317a1c0d7c879af0c041` |

重新计算的 runtime agent/agent-loop/controller/session 四文件 SHA-256 与上方运行时证据表完全一致。四制品 SHA-256 与本次委派给定值完全一致。Required Changes 三项已在规划层充分落实，故将 `CHANGES_APPLIED` 设为 **yes**；`VERDICT: APPROVE_WITH_CHANGES` 保持不变。此结论不是实现测试通过：真实 Host/AgentLoop 集成、GUI、构建与部署均未执行，仍属于后续实施验收。

## 2026-10-20 范围修订：本批准失效

用户否决本地规则分类（不符合“AI + 快速决策”目标），要求以 Jev 或同类专用决策模型判断、失败即停用并提示、不接受本地降级、不主动查询余额、主子会话同构。proposal/design/spec 已据此修订（见 `spike-jev-openrouter.md`），上方 `VERDICT: APPROVE_WITH_CHANGES` 与 `CHANGES_APPLIED: yes` 只适用于第 5 轮 SHA 表所列输入，**对当前制品不再有效**。须对修订后的四制品进行新一轮完整独立审查，并新增审查焦点：外发任务文本的隐私面、凭据隔离、Jev 失败分类与停用状态机、pre-step await 的取消与延迟、`route_subagent` 工具与 skill 的失败处理。

## Round 6（2026-10-20 范围修订后的完整审查）

### 元数据

- **审查者**：fresh-context 子代理；未参与修订稿编写。只读检查，唯一写入为本节追加。未构建、未跑测试、未联网、未提交。
- **输入范围**：完整读取 proposal、design、README、delta spec（实际计数 **39 个 Scenario**）、spike-jev-openrouter.md 与 review.md 第 1–5 轮。tasks/test-plan/verify 等首版文件按约定不审。
- **代码/运行时证据**（只读）：`packages/auto-model-routing/src/*.ts`；`packages/auto-model-routing/node_modules/@deepseek-ai/` 下的 `dsh-agent/lib/types/runtime-types.d.ts`、`dsh-tools/lib/types/index.d.ts`、`dsh-launch-environment/lib/types/index.d.ts`；`bin/dsh`；`.env.local`（主 checkout 与 worktree，只读变量名，不读值）；`dsh.yaml:158–169`；`skills/subagent-model-routing/SKILL.md`；`skills/jev-workflow-router/recorder.mjs:63–74`；`openspec/changes/configurable-jev-provider/proposal.md`；`docs/architecture/dsh-plugin-integration-pitfalls.md` §5、§12。

### 输入 SHA-256（已用 `shasum -a 256` 重新计算，与委派给定值逐一相同）

| 文件（相对本 change） | SHA-256 |
|---|---|
| proposal.md | `ded2eab634a4c1d5d3e938e8ff9d0d7f1e1e52e9f2dbd46dffda4a472349d11c` |
| design.md | `0f090019a436388ef316cdc690cdeb09965bde4d2bd22c18a503929bdc06830d` |
| README.md | `8c95876c5b35247544ec245b786e1d7989d62052828ac162ecaaa46625a9a979` |
| specs/auto-model-routing/spec.md | `03e22a6b4e5a378242679318d3627cc5b2ba8a7b7bd3f00a6ab1652a8f30b84d` |
| spike-jev-openrouter.md | `bc381a3494db91589040fb9e6372943ea8c07c84684417c3a3fec563d457b83c` |

### 已核实成立的部分（不计为问题）

- **没有残留本地规则或降级路径**：spec:97 要求系统 MUST NOT 有本地规则、关键词或通用模型分类路径，spec:109–112 用源码扫描（`classify` 导出、词表）作验收；spec:115 与 design D3:39 规定失败后只剩“复原或透传”两条路。现有 `classifier.ts:9–37` 的 `classify/resolveLevel` 已列入删除（design D4:58，proposal:29）。满足用户要求 2。
- **停用复用 MANUAL 过渡**：现有 `state.ts:59–63` 的 `setMode` 会设 `restore: state.restore || mode === 'MANUAL'`；`router.ts:59–68` 先检查复原义务，再检查 AUTO。只要 pre-step 失败时调用同一个 `setMode(MANUAL)` 并另写 `disabled`，本回合的请求就会走既有复原路径。第 5 轮已核实的“持久请求头与官方合成都收敛才清义务”“复原完成后的下一用户回合才启用 AUTO”语义没有被破坏（spec:6–8）。状态机 AUTO → 失败 → MANUAL+复原+disabled → 用户点 AUTO 清 disabled → 复原完成后的下一用户回合才调 Jev，前后一致。
- **pre-step 可以 await，且带取消信号**：`dsh-agent/lib/types/runtime-types.d.ts:291–310` 的 `'agent/pre-step'` 是 waterfall，返回 `Promise<PreStepDecision>`，payload 含 `signal: AbortSignal`（注释写明是“当前回合的取消信号”）；:84–90 说明 `running` 状态从“可取消的 pre-step 处理”开始。在 listener 里 await 外部请求是允许的。Jev 请求不依赖 agent 自身，不存在自锁。
- **全局工具可以注册**：`dsh-tools/lib/types/index.d.ts:629–636` 写明 `register` 可“globally or in the calling agent scope”；:115–128 的 `execute(args, exec)` 要求遵守 `exec.signal`；:150–156 的 `timeoutMs` 由官方 timeout policy 执行。`route_subagent` 可行。实现时 `index.ts:15` 的 `inject` 需要加 `tools`。
- **凭据确实会进入 Host 环境（仅限经 bin/dsh 启动）**：`~/.local/bin/dsh` 是指向主 checkout `bin/dsh` 的符号链接，`bin/dsh` 解析符号链接后得到 `REPO`，再执行 `set -a; source "$REPO/.env.local"`。主 checkout 的 `.env.local` 中存在 `OPENROUTER_API_KEY=` 这一行（值未读）。`start_server` 只用 `env -u` 去掉 `npm_*` 变量。`third-party-resources.mjs:348–355` 对凭据的筛减只作用于 jev-mcp 子进程的 `spawn env`，不影响 Host 进程本身。所以 design:18 对 bin/dsh 启动方式成立；适用边界见 m3。
- **Modified Capabilities 写“无”正确**：`openspec/specs/jev-workflow-routing` 的行为在本 change 中不变；新增错误类别也不写入该 spec。跨 change 的一致性问题单列为 M6。
- **范围克制**：没有恢复候选池、JSONL 日志、恢复按钮、全局开关或可配置映射表。`route_subagent` 只做“Jev 判档 + 查表”（design D1:31），与用户要求 6 一致。

### 🔴 Critical

无。

### 🟡 Moderate

**M1 — Jev 在 `next()` 之前调用：步骤被拒时仍会外发文本并计费，且分类用的不是最终进入步骤的消息。**
- 证据：design D4:44 写“并 `await` 一次 Jev 请求后再 `next()`”。`runtime-types.d.ts:92–99` 的 `PreStepDecision` 可能是 `{kind:'reject'}`，也可能是 `{kind:'enter', messages}`（后者可替换消息），:295 写“Reject a proposed step or replace the messages that enter it”。按现行顺序，下游 listener 拒绝步骤时，用户文本照样发给第三方。现有 `router.ts:31` 遇到同 turn 重提时直接返回，一个被拒的提案还会占掉本回合的唯一判断。
- Required Change：design D4 与 spec:69/97 改为先执行 `const decision = await next()`，只有 `decision.kind === 'enter'` 时才用 `decision.messages` 构造分类输入并调用 Jev；`reject` 时不调 Jev、不记录本回合决定。补一个场景：下游 listener 拒绝 step 1 时 Jev 请求次数为 0。

**M2 — 场景“停用后不再调用 Jev 且复原锚点”与收敛规则矛盾。**
- 证据：spec:122–125 断言本回合与下一用户回合的两次请求都输出 `medium` 且 `reason: manual-restore`。但按 spec:6 与现有 `router.ts:62–65`：第一次请求复原为 `medium`，请求头随之持久化为 `medium`；下一用户回合官方从请求头合成出 `medium`，此时请求头与合成配置都等于锚点，应清除义务并透传，不会再记录 `manual-restore`。
- Required Change：把该场景的 THEN 改为“本回合首个请求 effort `medium`、reason `manual-restore`；下一用户回合 effort 为 `medium`（官方合成透传），复原义务已清除，Jev 请求次数为 0，会话仍为 MANUAL 且保留 `disabled`”。

**M3 — `reason` 与历史条目的词汇不一致，`jev-failed` 只出现过一次且无定义。**
- 证据：spec:189 给出 `reason` 闭集 `jev | continued | no-effort-support | manual-restore | jev-failed`，但整个 spec/design 没有规定何时产生 `jev-failed`；spec:115 甚至说失败后本回合走复原。design D7:91 的历史条目用的是另一个字段 `source: "jev" | "manual-restore"`，缺 `continued`、`no-effort-support`，失败条目“含类别”却没有枚举值。spec:196–199 的面板测试无法据此判定失败条目的形状。
- Required Change：统一为一个字段（建议沿用 `reason`），并定义：Jev 失败时向历史追加一条 `{reason: 'jev-failed', category}`、不含 effort，随后的复原请求另记 `manual-restore`。design D7 删掉 `source` 改用同一闭集。spec 在“Jev 失败即停用”下加断言：失败后历史末两条依次为 `jev-failed`（含类别）和 `manual-restore`。如果决定不记失败条目，就从闭集删掉 `jev-failed`。

**M4 — 只靠 title 提示达不到“人类明确感知停用”。**
- 证据：spec:189、204 允许提示放在“芯片文本**或** title”。title 只在鼠标悬停时出现，无法满足用户要求 2；而 design D7:91 已写芯片显示短文本（如“Jev 停用”），spec 比 design 宽松。现有 `client/index.ts:40` 的芯片按钮只渲染 `view?.mode`。
- Required Change：spec 改为芯片**可见文本** SHALL 含固定停用标记（如“Jev 停用”），title 承载完整类别提示。场景 spec:201–204 断言渲染出的可见文本含该标记，不能只靠 title 满足。

**M5 — 未固定判档指令与 criteria 文本，“同构”与 spike 结果都无法复现。**
- 证据：design D4:51 的 criteria 全写成 `"..."`。spike 的 10/10 结果（spike:15–28）依赖当时使用的 instructions/criteria，但 spike 没记录这些文本。spec:166 只要求子会话工具使用“相同的 Jev 客户端”，没要求相同的问题定义。
- Required Change：在 design D4 写出四级 criteria 的确切文本（与 spike 一致；若不一致，需注明并重跑样本），并规定主会话与 `route_subagent` 共用同一个问题常量，只有 `state` 不同。spec 子会话需求补一个场景：两条路径发出的 `questions` 深度相等。

**M6 — 与 `configurable-jev-provider` 的契约冲突，错误词汇也与 recorder 不一致。**
- 证据：`configurable-jev-provider/proposal.md:11` 仍承诺“新增 Host 侧共享 Jev transport（pin `@jkudish/jev-agent-tools`）……复用 `jev-workflow-router` 错误枚举……供 `auto-model-routing` 使用”，:17 的能力描述还含“不可用降级”。本 change 的 design D5:61 却自建 `src/jev.ts`，proposal:34 又称 `insufficient-credits`、`region-blocked` 由该 change“修订后交付”，而对方 proposal 里并没有 `insufficient-credits`。两边的类别名也不同：`recorder.mjs:63–74` 用 `provider-5xx`、`network`、`malformed-response`，本 change 用 `unavailable`、`invalid-response`。
- Required Change：在本 change 的 proposal Impact 中明确：本 change 自带 Jev 客户端与类别闭集，不依赖 `configurable-jev-provider` 的 transport。并在本 change 内记录对该 change 的约束：删除“供 auto-model-routing 使用”和“降级”字样，否则日后合并会引入降级路径。类别命名要么对齐 recorder（例如沿用 `malformed-response`，把 5xx/网络分为 `provider-5xx`/`network`），要么在 design D5 写明有意分开并列出映射关系。二选一，不要隐含。

**M7 — skill 与插件是两个开关，组合不一致时委派会被永久卡住。**
- 证据：`dsh.yaml:158–169` 中 `auto-model-routing`（package）与 `subagent-model-routing`（skill）是独立条目。修订后的 skill 要求“委派前调用 `route_subagent`，失败则暂停并询问用户”（design D6:84）。如果启用了 skill、但插件未加载，工具不存在，每次委派都会停下来问用户。反过来，只启用插件时，工具对所有会话可见（全局注册），模型可能在无 skill 约束的情况下调用它并外发文本。
- Required Change：design D1/D6 规定二者的耦合方式，二选一：(a) manifest 或 sync 校验 skill 只能在插件启用时启用；(b) skill 写明“工具不存在即视为本能力停用：告知用户后按官方默认委派，不猜档位”。同时在 proposal 隐私段写明：启用插件即同意子会话判档外发，与主会话 AUTO/MANUAL 无关。

### 🔵 Minor

- **m1 — `cancelled` 的身份不清**：design D5:77 说客户端返回 `cancelled`，但 D5:61 的返回类型是 `{ok:false, category}`，而 :65–75 的闭集里没有 `cancelled`。Required Change：把返回类型写成三态 `{ok:true}|{ok:false,category}|{cancelled:true}`；判别方法为先检查 `callerSignal.aborted`，再看是否是超时（`AbortSignal.any` 不保留来源）。同时定义 `route_subagent` 在 `exec.signal` 被取消时的结果：取消不是 Jev 失败，提示文本不含“余额/凭据”。
- **m2 — 出站主机约束不完整**：spec:97、112 只扫描源码中的 URL，但 `fetch` 默认会跟随重定向。Required Change：design D5 要求 `redirect: 'error'`，重定向归入 `rejected`；测试断言假服务返回 302 时不跟随。
- **m3 — 凭据来源的适用边界**：design:18 只对经 `bin/dsh` 启动成立；worktree 的 `.env.local` 没有该变量，直接用官方 `dsh web` 启动时也不会注入。官方 `dsh-launch-environment/lib/types/index.d.ts:1–6` 建议 Harness 消费者通过 launch environment snapshot 读取，而不是直接读 `process.env`。Required Change：design 注明这一边界，并规定读取时机为“每次调用时读取”（这样换 key 后重启即可生效）；可选改为 `ctx.launchEnvironment.get('OPENROUTER_API_KEY')`，二者选定其一并写进 spec。
- **m4 — 200 响应但内容为错误时会被错分**：OpenRouter 可能返回 HTTP 200，body 却是 `{error:{code}}`。按 D5 这会落入 `invalid-response`，提示用户“响应无效”，而真实原因可能是余额不足。Required Change：200 且 body 含数字 `error.code` 时，按该 code 套用同一张映射表。
- **m5 — spec:115 首句有歧义**：“不改写本请求 effort 之外的任何字段”读起来像是允许失败时按档位改 effort。Required Change：改为“本回合按 MANUAL 过渡处理（可能复原锚点 effort），MUST NOT 改 provider/model”。
- **m6 — 等待 Jev 期间的模式竞态未写入 spec**：pre-step 最长等待 3 秒，期间用户可能点击切换模式。现有 `router.ts:59、69` 的检查顺序能挡住旧结果，但 spec 没有约束。Required Change：spec:69/97 补一句“Jev 返回后重新读取会话状态；若在等待期间模式发生过变化，丢弃结果；失败时若会话已是 MANUAL 且由用户设置，不覆盖为 `disabled`”，并补一个场景。
- **m7 — 隐私条款未记录**：`configurable-jev-provider/proposal.md:7` 要求先确认 OpenRouter 的数据保留条款再启用；spike:34 只写了“用户同意试用”。Required Change：在 dsh.yaml note 或 README 中记录已确认的保留/日志设置（或明确写“未确认”），并更新 `dsh.yaml:164` 中已失效的“不外发任务文本”。

### 结论

VERDICT: APPROVE_WITH_CHANGES

方向正确：用 Jev 判档、失败即停用、不降级、不查余额，主子会话复用同一判断，并沿用已核实的复原机制。共 0 Critical、7 Moderate、7 Minor。M1（判断时机）、M2（自相矛盾的场景）、M3（原因词汇）、M4（可感知性）会直接影响实现与验收结果，必须先修。M5–M7 是同构性、跨 change 契约和开关耦合问题，需在重写 tasks/test-plan 之前定稿。以上修改都不需要新增组件。

CHANGES_APPLIED: no

### Staleness

本结论只适用于上表的 SHA-256。修改范围超出 Required Changes 时，结论作废，需要另起一轮完整审查。只落实以上 Required Changes 时，可以做定点复核。

### 作者回应（2026-10-20，仅落实 Required Changes）

- M1 fixed：design D4 与 spec“用户回合与分类输入”改为先 `await next()`，仅 `enter` 时用 `decision.messages` 调 Jev；`reject` 不调 Jev、不记录决定；新增“步骤被拒时不请求 Jev”场景。
- M2 fixed：停用场景改为本回合 `manual-restore`、下一用户回合官方合成透传且义务已清除、Jev 0 次、`disabled` 保留。
- M3 fixed：统一为 `reason` 一个字段；design D7 删除 `source`；Jev 失败追加 `{reason: jev-failed, category}`（无 effort），随后的复原另记 `manual-restore`；停用场景断言历史末两条。
- M4 fixed：芯片可见文本固定为 `MANUAL · Jev 停用` + 警示样式，title 承载类别提示；场景断言可见文本。
- M5 fixed：design D4 写出四级 criteria 原文（与 spike 逐字一致），说明 instructions/state 相对 spike 的增量并要求实施时用最终文本重跑 10 条样本；`TIER_QUESTIONS` 常量主子共用；新增“主子会话问题定义相同”场景。
- M6 fixed：proposal Impact 写明本 change 自带客户端、不依赖 `configurable-jev-provider`；该草案已删除“供 auto-model-routing 使用”、共享 transport 与“降级”字样；design D5 写明类别有意不对齐 recorder 并列出映射。
- M7 fixed（选 b）：skill 规则 (7)“工具不存在→告知‘子会话 Jev 选模未启用’并按官方默认委派、不猜档位”；工具描述写明外发；proposal 写明启用插件即同意子会话判档外发。不新增 sync 跨条目校验。
- m1 fixed：客户端三态 `{kind: ok|failed|cancelled}`，先查 `callerSignal.aborted`；`route_subagent` 取消返回“已取消”。
- m2 fixed：`redirect: 'error'`，重定向归 `rejected`；新增 302 场景。
- m3 fixed：选官方 `launchEnvironmentOf(ctx).get('OPENROUTER_API_KEY')`，每次调用读取；design 写明仅经 bin/dsh 启动时可用，否则 `missing-credential`。
- m4 fixed：200 且 body 含数字 `error.code` 按 code 映射；状态码场景新增 `{error:{code:402}}`。
- m5 fixed：失败首句改为“按 MANUAL 过渡处理、可能复原锚点 effort，MUST NOT 改 provider/model”。
- m6 fixed：Jev 返回后重读状态，等待期间模式变化则丢弃结果且不写 `disabled`；新增场景。
- m7 fixed：README/proposal/dsh.yaml note 写明外发对象与“保留条款未确认”（OpenRouter 端点元数据未公布），更新已失效的“不外发任务文本”。
- 附带（来自 /ponytail-review）：skill 规则 (4) 补“当前 provider 非 claude/codex 时询问用户”；首版 tasks/test-plan/verify 等移入 `history/`，`openspec status` 如实为 4/7。未新增组件。

## Round 6 定点复核（2026-10-20）

- **复核者**：fresh-context 子代理；只读复核，唯一写入为本节追加。未构建、未跑测试、未联网、未提交。
- **方法**：`git diff HEAD`（HEAD `2ef1d01`）逐行比对四制品、`dsh.yaml`；读取 `configurable-jev-provider/{proposal,README}.md`（未跟踪目录）、`skills/jev-workflow-router/recorder.mjs:63–74`；核对 `dsh-agent/lib/types/runtime-types.d.ts:92–99、291–310、327`，`dsh-launch-environment/lib/types/index.d.ts:1–40、67`。

### 输入 SHA-256（`shasum -a 256` 重算，与委派给定值逐一相同）

| 文件 | SHA-256 |
|---|---|
| proposal.md | `4fec9bf2231aa425c3219c23d4008c6a5ec8ffbfca81adefa1f09d77cc6c6aa8` |
| design.md | `8cc0848246239620dc5e823754950c6a699eee7ab43bae705e6dbe9f6d43a0a4` |
| README.md | `ab81ad0276ece63e1dbeb3b662746b85418a09687fc45dfbbd1526fb9e773102` |
| specs/auto-model-routing/spec.md | `9a50ed2c3786d7a776da7cb71dfc7d0cc84ab3f2b156e9a66361b708bb04ebc4` |
| spike-jev-openrouter.md（未改） | `bc381a3494db91589040fb9e6372943ea8c07c84684417c3a3fec563d457b83c` |
| ../configurable-jev-provider/proposal.md | `c7a629ab59817aab8d7b4b870248961ff3acddcd43e98bcd92c698e2ffa86265` |
| ../configurable-jev-provider/README.md | `cb1f69cb5522399aba64724eb2d3a82a7cdefae7e51dbb404704249daeb80767` |
| /dsh.yaml | `d7c1850d1e574f40b89397e06db61930c7eda166a725b50bff6999be6fcdc4b1` |

delta spec Scenario 计数 39 → **43**（新增 spec:71、114、119、193）。

### 逐项结果

| 项 | 结果 | 证据 |
|---|---|---|
| M1 | **verified** | design:47 先 `await next()`，仅 `enter` 用 `decision.messages` 调 Jev，`reject` 不调、不记录；spec:69 同义；新场景 spec:71–74（reject 时 0 次，之后 enter 时 1 次）；proposal:14 写明被拒步骤不外发。时序：`'agent/pre-step'` 是 waterfall，listener 返回的 `Promise<PreStepDecision>` 决定是否进入 step（runtime-types:295–310），`agent/request`（:327）属于已进入的 step，所以在 `next()` 之后 await Jev 仍发生在请求之前；`signal` 是回合取消信号，可传给 Jev。design:18 的新增事实与 :92–99 一致。 |
| M2 | **verified** | spec:137–140：本回合 `medium`/`manual-restore`，下一用户回合官方合成透传，义务已清除，Jev 0 次，`disabled` 保留。与 spec:6 的收敛规则（请求头与合成都匹配锚点后清除并透传）一致。 |
| M3 | **verified（附 n1）** | design:102 删除 `source`，改为 `{reason, tier?, effort?, category?}`，并逐一定义闭集取值；spec:130 失败时追加 `{reason: jev-failed, category}`，spec:140 断言历史末两条。闭集与 spec:209 一致。残留矛盾见 n1。 |
| M4 | **verified** | spec:209 的可见文本 SHALL 为 `MANUAL · Jev 停用`，title 承载类别提示；场景 spec:221–224 断言可见文本含“Jev 停用”，无 `disabled` 时不含该文本。design:102 一致。 |
| M5 | **verified（附 n4）** | design:54–58 写出四级 criteria 原文，design:61 说明 instructions/state 的增量与重跑 10 条样本的门禁，并定义共用常量 `TIER_QUESTIONS`；spec:102、181 引用该常量；新场景 spec:193–196 断言 `model` 与 `questions` 深度相等。“与 spike 逐字一致”无法从仓库核实，见 n4。 |
| M6 | **verified（附 n3）** | proposal:36 与 design:90 写明自带客户端、不依赖对方 transport；design:88 写明有意不对齐 recorder 并给出映射，映射与 `recorder.mjs:63–74` 的实际枚举相符。`configurable-jev-provider/proposal.md:3、16` 已删除“供 auto-model-routing 使用”，改为“不提供不可用降级，也不为其它 change 提供 Host 侧 transport”；全文已无“降级”承诺。残留见 n3。 |
| M7 | **verified** | 选 (b)：design:34、spec:181 规则 (7)、spec:203–206 测试断言“子会话 Jev 选模未启用”；工具描述须说明外发（spec:181、design:34）；proposal:32 写明“启用插件即同意子会话判档外发”，proposal:33 写明开关耦合；dsh.yaml:169 note 同步。 |
| m1 | **verified** | design:70 定义三态返回，并要求先查 `callerSignal.aborted`；design:86 规定取消不算失败；design:93、spec:181 规定 `route_subagent` 取消时返回“已取消”，不含余额/凭据提示。 |
| m2 | **verified** | design:70 设 `redirect: 'error'`，抛出时归为 `rejected`；spec:102 写入要求；新场景 spec:119–122（302 时不请求目标，类别为 `rejected`）。 |
| m3 | **verified（附 n2）** | design:18、70 与 spec:102 选定 `launchEnvironmentOf(ctx).get(...)`，每次调用时读取；design:18 写明经 `bin/dsh` 启动以外的边界。层级描述不完全准确，见 n2。 |
| m4 | **verified** | design:70、spec:130 规定 200 + 数字 `error.code` 时按 code 映射；spec:133–135 新增 `{error:{code:402}}` → `insufficient-credits`，场景序列与 13 项输入一一对应。 |
| m5 | **verified** | spec:130 首句改为“本回合按 MANUAL 过渡处理、可能复原锚点 effort，MUST NOT 改写 provider/model”。 |
| m6 | **verified** | design:43 与 spec:102 规定 Jev 返回后重读状态，等待期间模式变化则丢弃结果，不写决定或 `disabled`；新场景 spec:114–117 覆盖成功与 402 两种情况。与 D3 的“用户手动设 MANUAL 不写 `disabled`”一致。 |
| m7 | **verified（措辞小差异）** | dsh.yaml:164 note 已删除失效的“不外发任务文本”，写明外发对象、“保留条款未确认”与凭据变量；proposal:32、design:132 同步。作者回应说 README 也写了，但 change README:3–7 实际没有提保留条款。Required Change 允许“note 或 README”二选一，所以仍算满足。 |

### 范围检查

- `git diff HEAD` 只改动四制品、`dsh.yaml` 两条 note/brief、`review.md`，外加五个首版文件的纯重命名（`R`，内容 0 行变化，移入 `history/`）。`packages/`、`skills/` 无改动；无新增组件、依赖或 manifest 规则。
- **附带 1（skill 规则 (4)：非 claude/codex provider 时询问）**：可接受，属于最小补充。`route_subagent` 参数本来就限定为 `"claude" | "codex"`（spec:181），原规则 (4) 的“默认取当前会话 provider”在其它 provider 下没有定义；补这一句只是消除歧义，与 M7 同属“失败/不可用时询问用户”的同一策略，没有新增行为面。测试断言已同步（spec:206）。
- **附带 2（首版 tasks/test-plan/verify 等移入 `history/`）**：可接受，属于整理而非范围扩张。Round 6 已声明这些文件不审、不可据以实施；移走后能避免被误当成当前任务清单。仓库内无引用这些旧路径的文件（已 grep）。README:7 已同步说明。
- 结论：未超出 Required Changes 的范围，适用定点复核。

### 新发现（均为 🔵 Minor，不阻塞；建议在重写 tasks/test-plan 时顺手修正）

- **n1 — design:67 与 `reason` 闭集矛盾**：design:67 仍写“删除……`continued/escalated/explicit` 原因”，而 design:102 与 spec:209 都保留 `continued`（非用户回合沿用）。应改为删除 `unclassified/escalated/explicit`，保留 `continued`。
- **n2 — 凭据来源的描述与 launch environment 语义不完全一致**：`dsh-launch-environment` 的 `get()` 按 `process → project-env（调用目录 .env）→ user-env（DSH home .env）` 依次解析（index.d.ts:1–14、33–36）。所以“仅经 bin/dsh 启动可用、否则 `missing-credential`”（design:18）不严谨：官方 `dsh web` 若在调用目录或 DSH home 的 `.env` 中有该变量，同样能读到。design:133“只从进程环境读取”与 spec:133“进程环境缺少凭据”也沿用了旧说法。建议统一为“只经 launch environment 读取；所有层均无时为 `missing-credential`”，测试的“缺凭据”应构造一个各层都没有该变量的快照。这不影响安全性，因为凭据仍然只来自本机。
- **n3 — `configurable-jev-provider/README.md:3` 仍写“为 auto-model-routing 提供 Host 侧 Jev transport”**，与其 proposal:16 和本 change 的 proposal:36 矛盾。M6 要求删除的字样只在 proposal 中删了，README 中还有残留。建议同步删除。（该目录尚未纳入 git 跟踪。）
- **n4 — “criteria 与 spike 逐字一致”无法复核**：`spike-jev-openrouter.md` 未记录 criteria 原文（全文只有 :8 的结构描述），所以 design:61 的说法在仓库内无法验证。design:61 已设门禁（用最终文本重跑 10 条，不一致即回到规划），风险可控。建议实施重跑时把最终 instructions/criteria 与结果补进 spike 或 test-plan，作为同构基线。
- **n5（措辞）**：spec:203 场景标题仍为“skill 文本包含六项规则”，实际已是 7 条规则（加 provider 询问）。另外，spec:140 的“历史末两条”应注明在本回合结束时断言，或注明下一回合透传不追加历史条目，避免测试时断言的时刻产生歧义。

未发现 Critical 或 Moderate 问题；新场景彼此不矛盾，也不违反 spec:6 的复原收敛规则。

CHANGES_APPLIED: yes

`VERDICT: APPROVE_WITH_CHANGES` 保持不变。本结论只适用于上表 SHA-256；n1–n5 可在重写 tasks/test-plan 时一并修正，修正后无需再完整重审（只要不超出 n1–n5 的范围）。这不是实现验收：实现、测试、GUI 与部署均未执行。

### 作者回应（定点复核 n1–n5，均为措辞，不改行为）

- n1：design D4 删除列表改为保留 `continued`（非用户回合沿用），与 spec 闭集一致。
- n2：design/spec/proposal 改为“经官方 launch environment 读取”，写明其三层来源与本仓只用 `bin/dsh` 注入进程层的约定。
- n3：configurable-jev-provider/README.md 删除“为 auto-model-routing 提供 Host 侧 transport”。
- n4：spike 补记样本所用 instructions/criteria/state 原文，criteria 与 design D4 可逐字复核。
- n5：场景标题改为“七项规则”；停用场景注明“本回合首个请求处理完毕时”断言历史末两条。
