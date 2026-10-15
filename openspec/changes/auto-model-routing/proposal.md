## Why

日常使用中推理强度（effort）只能手动切换：简单消息开满 effort 浪费订阅额度与时延，复杂任务忘记升档又影响质量；子智能体创建时虽然支持显式指定 provider/model/effort，但主 Agent 缺少稳定依据，多数情况直接继承父会话路由。本 change 让主会话按任务复杂度自动调整 effort，并给主 Agent 一张子会话选模的档位表，同时保持用户手选、显式指定与既有门禁的最高优先级。

## What Changes

- 新增本地自研 package（Host + Web client），参考 `dsh-router-laya` 的交互与“判断 → 档位 → 映射表”拆分，但不安装、不扩展、不改造该插件。
- Composer 模型控制区新增 `AUTO / MANUAL` 芯片，位于模型选择器与 GPT“速度/标准”芯片左侧，不改写二者的状态；展开面板显示锚点、本回合 effort、原因与最近 20 条决定（仅内存）。
- **主会话只调 effort**：AUTO 下保持用户手选的 provider 与 model 不变，只按任务档位调整 reasoning effort；因此不触发官方模型切换通知、不改变选择器显示的模型与子会话继承的**模型**，避免主动换模型引起缓存切换，但不保证各 provider 的缓存命中。插件自行保存 effort 锚点（用户手选或首个请求初始化）。
- **切回 MANUAL 即复原**：切到 MANUAL 后保留复原义务，对模型与锚点匹配的请求写回锚点 effort；持久请求头与官方合成都收敛后才停止覆盖，防止同一步重试退回旧 effort。模型尚未切换时等待官方切换，不自行换模型。**effort 残留（明确告知）**：官方会把最后一次请求的 effort 当作会话当前选择，因此在 AUTO 下直接卸载插件，会话会保持最后一次 AUTO effort，直到用户手选；文档要求卸载前先切 MANUAL。
- **子会话选模交给 skill**：skill `subagent-model-routing` 提供按 provider 的四级档位表（Claude：Haiku / Sonnet / Opus / Fable；GPT：Luna / 6.1 Sol / 6.1 Sol 高 effort / Astra），指引主 Agent 自行判断任务复杂度，经官方 `subagent` 参数显式传入 provider/model/reasoning_effort（白名单由官方校验）；创建后不再改写；复用前尽力判断是否适配。
- **分类**：确定性**本地规则**分类器（`simple / standard / complex / unclassified`），纯函数，无网络、无外部数据处理方；确定性规则处理显式级别、延续与重做升档；不确定时沿用上一回合，不默认降档。
- **Jev 分类推迟**：Jev 分类器、发送任务文本的隐私例外与 provider 选择全部移出本 change，由 `configurable-jev-provider` 或其后续 change 接入。
- 不加载插件即为禁用（`dsh.yaml enabled: false`）；不设运行时全局开关。

## Capabilities

### New Capabilities
- `auto-model-routing`: 定义 AUTO/MANUAL 交互、主会话 effort 路由与锚点复原、本地规则分类、级别规则与映射、子会话选模 skill、显式优先、门禁一致性与 Host 端点边界。

### Modified Capabilities
- 无。

## Impact

- `packages/auto-model-routing/`（新增）：Host 插件（`agent/request` effort 改写、step-1 `agent/pre-step` 分类、会话状态、两个端点）与 Web client（composer 芯片与面板）。
- `skills/subagent-model-routing/`（新增）：子会话档位表、创建与复用指引。
- `dsh.yaml`：新增 local package 条目（默认禁用）与 skill 登记。
- 依赖：无新增运行依赖；无外部服务调用；无持久记录文件。
- 交互面：composer 新增芯片，需与官方模型选择器、GPT 速度芯片、`home-network-model-guard` 的 composer 阻断共存。
- 不修改：官方模型选择、`home-network-model-guard`、`jev-workflow-router`、Jev 接线层、dsh-pet compat overlay。
