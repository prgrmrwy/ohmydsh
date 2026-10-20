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
