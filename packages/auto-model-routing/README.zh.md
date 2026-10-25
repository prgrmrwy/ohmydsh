# dsh-auto-model-routing

[English](README.md) · 简体中文

<!-- problem -->
主模型由你选，AUTO 为每轮选择推理投入，并为 fresh 子任务选配资源。Jev **独立判断能力需求和投入**，DSH 验证并应用配置；界面区分“做出了判断”和“实际请求已生效”。

**安装**：已验证 DSH `0.2.0-rc.2`、Web UI，Node.js `>=22.19`。

```sh
dsh plugin --profile web add dsh-auto-model-routing
# 或从源码安装（出现提示时批准本地构建）：
dsh plugin --profile web add prgrmrwy/dsh-auto-model-routing
```

重启 DSH 并刷新页面，到**设置 → 自动模型路由**选择决策服务、保存对应 API key，点击**测试连接**发送固定公开样例。新会话缺省 **MANUAL**，点击芯片切换 AUTO。配套委派 skill 已包含，无需单独安装。

## 使用

| 位置 | 操作 |
|---|---|
| **AUTO / MANUAL 芯片**（模型选择器左侧） | 点击切换；悬停查看判断、候选分布、确定度、模型与投入、生效状态 |
| **判档提示** | 短暂显示新决策；关闭设置中的提示开关不会隐藏悬浮面板 |
| 回复下方的**仪表按钮** | 评价分配合适、投入偏高、投入不足或无法判断，支持修改和撤销；仅对绑定已应用主决策的回复显示 |
| **设置 → 自动模型路由** | 选择服务与模型、管理独立 key、测试连接、设置模式/强度上限/等待时间；展开**查看决策策略**查看实际判据与模型槽 |

### 主模型不换，子任务独立选配

- **主会话**：`lower / baseline / higher` 相对于具体模型已验证的推荐起点，在受支持序列降低一档、保持或提高一档。缺省上限 `xhigh`，自动不选 `max`；不修改主 provider/model，也不改写全局模型默认值。
- **fresh 子任务**：能力需求为 `bounded / analytical / frontier`，推理投入独立判断。Claude 能力槽为 Haiku / Sonnet / Opus 5.5；GPT 为 Luna / Sol / Sol。实际路由必须同时满足当前目录、支持的 effort 和官方子智能体允许列表。Magpie 保留真实 provider 与家族前缀完整模型 ID，不回退到本地入口。
- **尊重显式选择**：只指定模型或投入时，仅判断另一维；两者都指定则不请求 Jev，只校验路由。缺少任务目标或范围时停止委派，不猜。
- **官方创建绑定路由**：fresh `subagent` 和 fresh `spawn_teammate` 在子任务首次请求前绑定精确身份。`route_subagent` 只是可选预览，不代表已应用，也不能把推荐复制成用户约束。fork 和未绑定创建路径暂不支持，不静默替换。
- **恢复保持初始路线**：根会话改为 MANUAL 后停止新判断，已有绑定子实例维持原路线。`applied` 只证明实际请求配置匹配，**不代表任务成功**。真实 Magpie Claude/GPT ordinary 调用已验证；fresh teammate 路由及冷恢复有 mock 宿主覆盖，不等于真实模型 teammate 已验收。

### 选择决策服务

| 服务 | 接口 | 缺省模型 | 凭据引用 |
|---|---|---|---|
| OpenRouter（默认，兼容已有安装） | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` | `OPENROUTER_API_KEY` |
| TypeSafe 官方 | `https://api.typesafe.ai/v1/systemone` | `jev-1.13.0` | `TYPESAFE_API_KEY` |
| Concentrate | `https://api.concentrate.ai/v1/systemone` | `jev-1.13.0` | `CONCENTRATE_API_KEY` |
| 自定义 System One | 完整接口地址 | 可编辑 | `AUTO_DECISION_CUSTOM_API_KEY` |

预置模型菜单列出文档确认的版本，不保证实时可用。自定义服务可填写自己的模型 ID，但必须兼容 `state + questions → answers`；只有 OpenAI chat-completions 接口并不兼容。自定义端点限 HTTPS（回环可 HTTP），禁止 URL 凭据、查询参数、片段及重定向。只配置你信任且适合使用该专用 key 的地址。TypeSafe、Concentrate 目前有协议/mock 覆盖，未在本次验证其真实凭据与地区可用性。失败不自动切换服务。

**判定确定度不等于选中概率**：Choice 公式为 `(pmax − 1/n) / (1 − 1/n)`，三个候选中最高概率 70% 对应确定度 55%。面板分别显示服务返回的确定度和完整分布，保留返回的 0%，缺值标未提供。两者都不是任务成功率。

## 须知

- **失败可见**：主判断失败会停用 AUTO 并显示原因，子判断或路由失败则停止派发。没有本地分类器、自动重试、自动升级或跨服务降级。
- **MANUAL 停止调整，不复原历史值**：使用官方当前选择；只要插件启用，已绑定子任务仍保留原路线。
- **任务会外发**：AUTO 将按形态脱敏的任务文本（最多 8000 字符）及上一轮少量片段发送给所选服务。脱敏尽力而为，不保证去除全部秘密。测试连接只发送固定公开样例，可能产生少量费用。
- **key 经官方 DSH 凭据服务保存**，不写入插件配置。启动环境 key 优先且只读；切换服务清空 key 草稿，先保存服务再管理新 key。修改自定义端点不会产生新凭据空间，换地址前请确认专用 key 的信任边界。
- **本地状态**：配置在 `$DSH_HOME/plugins/dsh-auto-model-routing/`，模式、子路由及反馈在 `$DSH_HOME/state/auto-model-routing/`。反馈只保存资源元数据、身份、版本、返回分布及时间，不保存任务或回复正文。请求事件序号供后续关联用量，缺失成本不会编造。见[反馈评估说明](docs/feedback-evaluation.md)。
- **不自动学习**：人工反馈仅作观察，不改变路由，也不能直接证明质量提升或节省。无决策绑定的旧消息不回填，旧记录缺少的评估字段保持未知。
- **升级兼容**：已有 AUTO 会话直接使用新策略，无需版本开关，也不重写会话模式。新会话缺省仍为 MANUAL，除非你改过设置。旧四档映射仅供配置中显式 `policy: "legacy"` 回滚，不是当前策略或反馈菜单。

## 架构
<!-- section: architecture -->

```text
用户回合 → pre-step → 所选 Jev 服务 → depth → 主请求 effort
fresh 子创建 → 精确身份绑定 → capability + depth → 校验路由
request/header → 配置匹配 → applied 证据
assistant 消息 → 不可变决策快照 → 人工反馈事件
```

入口：[index.ts](src/index.ts)。执行接入：[policy-host.ts](src/policy-host.ts)。实际判据：[policy-v2-rubric.json](src/policy-v2-rubric.json)。模型槽：[policy-v2.ts](src/policy-v2.ts)。界面：[client](src/client/index.ts)。覆盖边界：[开发验证](docs/policy-v2-development.md)、[真实 Magpie 验收](docs/magpie-live-acceptance.md)。

<details>
<summary>旧四档界面演示（仅供 legacy 回滚参考）</summary>

下列隔离宿主录屏使用模拟 Jev/模型响应，展示旧界面，不代表当前默认策略。

![旧版 AUTO 推理强度调整](docs/auto-routing.gif)
![旧版四档路由设置](docs/settings.gif)

</details>

## 开发验证

```sh
npm test
npm run typecheck
npm run build
```

测试使用官方 AgentLoop、假 LLM 流和 mock/回环 Jev，不产生真实模型费用。`scripts/label-report.mjs` **仅汇总旧四档标注**，不是新分配反馈报表；新数据结构与去重口径见[feedback-evaluation.md](docs/feedback-evaluation.md)。

[当前规范](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/auto-model-routing/spec.md)在源码 monorepo 中维护。包内[委派 skill](skills/subagent-model-routing/SKILL.md)提供指引，执行保障来自官方宿主钩子，而不是提示词。暂无完整任务质量或 token 节省的量化结论。

## 移除
<!-- section: removal -->

```sh
dsh plugin --profile web remove dsh-auto-model-routing
```

重启 DSH 并刷新页面。插件的 skill、工具和请求钩子撤销，配置与日志保留。关闭插件后不再执行子路由恢复，宿主使用原始创建配置。在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh) 中则禁用 local 条目并重新构建。
