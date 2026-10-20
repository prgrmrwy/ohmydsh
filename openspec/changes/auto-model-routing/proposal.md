## Why

日常使用中推理强度（effort）只能手动切换：简单消息开满 effort 浪费订阅额度与时延，复杂任务忘记升档又影响质量；子智能体创建时虽然支持显式指定 provider/model/effort，但主 Agent 缺少稳定依据，多数情况直接继承父会话路由。本 change 让主会话按任务复杂度自动调整 effort，并让子会话选模使用同一个判断，同时保持用户手选、显式指定与既有门禁的最高优先级。

**修订（2026-10-20）**：首版实现使用本地关键词规则分类，偏离了用户“AI + 快速决策”的目标。用户明确要求：判断必须由 Jev 这类专用决策模型完成；通用对话模型太慢，不采用；不接受本地规则降级——Jev 不可用时直接停用能力并让人类看到原因。TypeSafe 直连对当前出口地区返回 HTTP 451，spike（`spike-jev-openrouter.md`）证实经 OpenRouter 调用 Jev 可行（10/10 样本符合预期，p50 约 0.81s，约 $0.000017/次）。

## What Changes

- 新增本地自研 package（Host + Web client），参考 `dsh-router-laya` 的交互与“判断 → 档位 → 映射表”拆分，但不安装、不扩展、不改造该插件。
- Composer 模型控制区新增 `AUTO / MANUAL` 芯片，位于模型选择器与 GPT“速度/标准”芯片左侧，不改写二者的状态；展开面板显示锚点、本回合 effort、原因、最近 20 条决定（仅内存）以及停用原因。
- **主会话只调 effort**：AUTO 下保持用户手选的 provider 与 model 不变，只按任务档位调整 reasoning effort；不触发官方模型切换通知，不改变子会话继承的**模型**，但不保证各 provider 的缓存命中。插件自行保存 effort 锚点（用户手选或首个请求初始化）。
- **切回 MANUAL 即复原**：保留首版已验证的复原义务语义（持久请求头与官方合成均收敛后才停止覆盖；模型未切换时等待；不自行换模型）。**effort 残留**：在 AUTO 下直接卸载插件，会话保持最后一次 AUTO effort，直到用户手选；文档要求卸载前先切 MANUAL。
- **判断由 Jev 完成（替换本地规则）**：每个用户回合在 step 1 以一次 Jev `choice` 请求得出四级档位 `simple / standard / complex / escalated`；上一用户回合的档位作为上下文一并发送，“继续”“重做”“用最高档”等意图交给 Jev 理解。删除本地关键词分类器、显式/延续/重做词表；非用户回合（如子会话完成通知）沿用上一用户回合档位，不调用 Jev。
- **Jev 承载方为 OpenRouter**：Host 直接调用 `POST https://openrouter.ai/api/alpha/decisions`，模型 `typesafe/jev-1.13`，凭据为 `OPENROUTER_API_KEY`（主 checkout `.env.local` 经 `bin/dsh` 注入，插件经官方 launch environment 读取；无此变量时为“未配置凭据”），单次请求期限 3 秒、不重试、不跟随重定向。判断在 pre-step 确认步骤进入后才发起，被拒的步骤不外发。不经 jev-mcp：其对 429/5xx 自动重试最长 60 秒，与“失败即停用”冲突。
- **失败即停用并提示（不降级）**：Jev 调用任何失败（含缺凭据、余额不足、超时）都把该会话切为 MANUAL（带复原义务）并记录闭集失败类别；芯片显示停用状态与原因，例如“Jev 余额不足（402），自动路由已停用”。停用保持到用户手动再点 AUTO；不轮询、不主动查询余额、不自动重试。失败按状态码分类：402 余额不足、401/403 凭据无效、429 限流、451 地区受限、其它 4xx 请求被拒、5xx/网络 服务不可用、超时、响应无效、缺凭据。用户取消不视为 Jev 失败。
- **子会话与主会话同构**：新增 Host 工具 `route_subagent`，与主会话共用同一 Jev 判断与失败分类，按调用方指定的 provider 返回档位及 `provider / model / reasoning_effort`；子会话档位表从 skill 移入代码，成为唯一来源。工具失败时返回失败类别，skill 要求主 Agent **暂停委派并询问用户**，不得自行猜测档位替代。
- 不加载插件即为禁用（`dsh.yaml enabled: false`）；不设运行时全局开关。

## Capabilities

### New Capabilities
- `auto-model-routing`: 定义 AUTO/MANUAL 交互、主会话 effort 路由与锚点复原、Jev 判断与失败即停用、级别与映射、子会话决策工具与 skill、显式优先、门禁一致性与 Host 端点边界。

### Modified Capabilities
- 无。（`jev-workflow-routing` 的错误类别与 MCP provider 切换由 `configurable-jev-provider` 负责，见 Impact。）

## Impact

- `packages/auto-model-routing/`：Host 插件（step-1 `agent/pre-step` 调 Jev、`agent/request` effort 改写、会话状态含停用原因、两个端点、`route_subagent` 工具）与 Web client（芯片与面板，含停用显示）。删除 `classifier.ts` 中的规则分类与词表，保留 effort 映射。
- `skills/subagent-model-routing/`：改为“委派前调用 `route_subagent` 并显式传参；失败暂停并询问用户”，移除档位表。
- `dsh.yaml`：条目保持默认禁用；note 写明外部数据处理方与凭据变量。
- **外部服务与隐私**：每个用户回合（AUTO）与每次子会话决策，都会把截断至 8000 字符的用户任务文本发送给 OpenRouter 及 TypeSafe。**启用插件即同意子会话判档外发**，与主会话 AUTO/MANUAL 无关。OpenRouter 数据保留与日志条款**未确认**（端点元数据未公布），由用户在 OpenRouter 后台自行设置。凭据不写入仓库、状态文件、日志或错误信息；状态与面板只保存失败类别，不保存响应体。
- **开关耦合**：插件与 skill 仍为两个 manifest 条目；只启用 skill 时，skill 指示主 Agent 告知用户“子会话 Jev 选模未启用”并按官方默认委派。
- 新增依赖：无（使用 Node 内置 `fetch`）。
- 不修改：官方模型选择、`home-network-model-guard`、dsh-pet compat overlay、jev-mcp 接线与 `jev-workflow-router`。
- **与 `configurable-jev-provider` 的契约**：本 change 自带 Jev 客户端（`src/jev.ts`）与人类提示用的失败类别闭集，**不依赖**该 change 的共享 transport。该 change 只负责 jev-mcp 与 `jev-workflow-router` 的 provider 切换；其草案中“供 auto-model-routing 使用”和“不可用降级”须删除（本次已在草案中标注），以免日后合并引入降级路径。类别命名与 recorder 的映射见 design D5。
