# AUTO 宿主能力核验（官方 0.2.0-rc.2）

## 结论

**官方入口足以让插件在普通子会话、fork、teammate 的首次模型请求前读取精确子身份和本轮任务，并改写实际 provider/model/effort；不需要改宿主或 compat。** 这证明的是宿主接入能力，不是现有 AUTO 已支持这些路径。

本次只完成宿主探针。策略、Jev、生产持久化、部署与真实模型兼容性均未实现/验证。尤其 fork 跨真实 provider 的历史兼容仍未通过支持门槛，不可据此启用生产自动路由。

## 方法与范围

- 可重跑的 [探针](../scripts/host-capability-probe.mjs)：独立临时 npm prefix，官方包精确 pin 为 `0.2.0-rc.2`、Cordis 为 `4.0.4`；运行前检查所有直接加载包版本。未加载 launcher 或 compat。
- 官方 Agents、Loop、Sessions、Subagents、spawn/fork providers、Teams、JSONL persistence、session-query 组成真实宿主服务链。适配器是本地 fake，唯一允许的 provider 为 `probe` / `probe-other`，运行期 `fetch` 明确抛错。依赖安装访问 npm，不产生模型/Jev 请求。
- 使用全局 `agent/pre-step` 的 `decision.messages` 读取进入本轮的任务；按 `agent.id` 记录确定性测试决策；`agent/request` waterfall 应用配置。测试标签仅为 oracle，**不是可直接复用的生产 prompt 匹配绑定方案**。
- 证据同时校验子会话 `requestHeader().config` 和 fake adapter 收到的最后一次请求，使用请求 `sessionId` 关联，分别确认 provider、model、effort。provider 由各自独立适配器实例记录，不以相同模型名代替路由证明。
- 数据均为合成任务，JSONL 和简易决策文件只写临时目录，不提交原始会话。

## 支持矩阵

| 路径 | 精确父子身份与任务 | 请求入口与实际执行 | 并发/后续/恢复 | 结论 |
|---|---|---|---|---|
| one-shot ordinary `start('spawn')` | 通过：run ID、live child、parentSession 与进入任务对应 | 通过：跨 fake provider + model/effort | 单次请求；未单测此入口并发 | 官方服务入口可用；非生产 applied |
| continuable ordinary `startContinuable('spawn')` | 通过 | 通过 | 两个并发提交的不同任务各获不同配置，父请求不变；重建宿主后恢复通过 | 可作为正式实现基础；需插件自己的决策恢复机制 |
| one-shot / continuable fork | 通过；进入任务不含父历史标记，完整会话仍保留父文本历史 | 通过：fake provider 切换 | 未覆盖 fork 冷恢复或并发专项 | 宿主入口可用；真实历史兼容未验证，生产异构 fork 不宣称支持 |
| teammate fresh | 通过：官方 TeamService → continuable child | 通过；无需 Team 创建 API 暴露 model 参数 | 后续消息含不同测试标签也不重选；重建宿主后发消息恢复同一路由 | 官方服务入口可用；工具层与生产持久化未验证 |
| teammate fork | 未单独运行组合测试 | 不借普通 fork 的结果算通过 | 未覆盖 | 本轮未验证，不启用自动应用 |
| ACP / 远端进程子会话 | 未覆盖 | 当前全局 hook 仅本进程 | 未覆盖 | 本轮不支持声明 |

并发证据是 `Promise.all` 并发提交的身份隔离，不是高负载、长流式交错或取消压力测试。后续消息证据是新消息新请求，不包括重复投递同一 message ID 的去重验证。

## 关键发现：请求覆盖不等于持久化选模

官方 continuable descriptor 在创建时保存 model/effort；`agent/request` 覆盖不会修改它。

探针包含负对照：先路由 child → 关闭整个宿主 → 以同一持久化目录重建宿主，禁用决策应用 → 发新消息。实际请求恢复为父模型 `parent/medium`，而非首次应用的 `small/high`。

再次重建宿主，并从探针自有文件恢复 `childId → provider/model/effort` 决策后，同一 child 和 teammate 的请求才保持首次选择。因此正式实现至少需要：

1. 使用稳定的会话身份绑定初始决策，后续消息不重新分类；不能依赖临时 Agent 对象或 prompt 相似度。
2. 通过插件自己的持久化或可验证重建机制恢复决策，处理恢复失败，不能默默继承却报告 applied。
3. 为显式 model/effort 约束保留来源；本探针的标签路由没有实现该语义，不可直接上线。
4. 避免调用主 UI 的 `sessionController.selectModel`：它还会保存全局默认选择；本探针完全不调用该入口。

这里只验证了简易测试文件的正常读写恢复，不是生产持久化设计；未覆盖原子写、并发进程、崩溃、损坏、版本迁移和 MANUAL 切换。

## 官方源码依据

以下为核验时已安装的官方发布包位置，不是上游改动要求。临时 prefix 可按下方命令重建；其中源码行号仅适用于此 pin。

- [pre-step / request 类型](../../../node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts#L293-L332)：公开事件输入和 waterfall 返回契约。
- [Loop 请求链](../../../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L1164-L1220)：实际调用 waterfall 后才 `llm.prepareCall`，记录 resolved request header。
- [scopeTarget](../../../node_modules/@deepseek-ai/dsh-scope/lib/index.js#L315-L337)：无 Agent 作用域标记的全局 listener 可观察不同子身份。
- [SubagentStartRequest](../../../node_modules/@deepseek-ai/dsh-subagent/lib/types/types.d.ts#L136-L162)：公开 `agentOptions`，不必通过工具 schema 推断宿主能力。
- [continuation 创建](../../../node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation.js#L101-L176)、[冷恢复](../../../node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation.js#L354-L374)：descriptor 与恢复选项。
- [官方 Team 创建转发](/tmp/dsh-official-routing-probe.HImElm/node_modules/@deepseek-ai/dsh-experimental-agent-team/lib/index.js#L573-L582)：只转发 prompt/parent，未传 agentOptions；并不妨碍插件在 child request 入口配置。
- [默认选择副作用](../../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js#L720-L739)：`selectModel` 还会 `saveSelection`。

`resolveChildAgentOptions` 是 [官方公开导出](../../../node_modules/@deepseek-ai/dsh-subagent/lib/types/index.d.ts#L55)，前期函数级实验使用内部文件路径不意味着函数本身是私有 API。本次整链探针没有导入任何内部 helper。

## 重跑

从仓库根运行，Node 24；不更改仓库依赖、manifest 或当前 GUI：

```bash
PROBE_HOME=$(mktemp -d /tmp/dsh-official-routing-probe.XXXXXX)
npm install --prefix "$PROBE_HOME" --save-exact --ignore-scripts --no-audit --no-fund \
  @deepseek-ai/cordis@4.0.4 \
  @deepseek-ai/dsh-agent-loop@0.2.0-rc.2 \
  @deepseek-ai/dsh-experimental-agent-team@0.2.0-rc.2 \
  @deepseek-ai/dsh-session-persistence-jsonl@0.2.0-rc.2 \
  @deepseek-ai/dsh-session-query-sqlite@0.2.0-rc.2 \
  @deepseek-ai/dsh-subagent-fork-in-process@0.2.0-rc.2 \
  @deepseek-ai/dsh-subagent-spawn-in-process@0.2.0-rc.2
node packages/auto-model-routing/scripts/host-capability-probe.mjs "$PROBE_HOME"
```

探针输出 7 项 PASS 后才表示整链成功。它有独立依赖装配要求，未加入默认单元测试命令。

装配期间遇到并修正的探针问题：父创建必须提供 sessionId；官方 continuable 任务会附加返回指导，不能断言整个文本与原 prompt 完全相等；子实例自然完成后可能已经卸载，证据应保存事件中的精确 Agent 身份；冷恢复必须装配 session-query（`openAt: 'never'` 保留 exact reads 且不加载 SQLite）；npm 分次安装缺少 `--save-exact` 会漂移版本，版本断言已捕获，最终重装为精确 pin。以上均未修改官方宿主。

## 检查结果与本地复核

- 探针：7 项 PASS（包含恢复负对照）；复核后补充父会话在子任务之后再次发请求仍保持原配置的断言。
- package 工作目录执行 Vitest：25 个测试文件、162 个测试通过。
- OpenSpec 严格校验与 `git diff --check`：通过。
- 首次从仓库根运行 Vitest 的路径过滤意外匹配 worktree，且未使用 package 配置，UI 测试报告缺少 `clsx`。改为 package 工作目录后全部通过；未为此安装仓库依赖或修改 UI。
- 本地全范围复核：新增脚本/报告及本轮 design/tasks 修改均检查；没有修改运行时代码。保留的局限是明确列出的组合覆盖和生产机制缺口，不将其记为 applied。
- 未运行全仓测试、构建、sync、真实模型调用或浏览器验证；本次没有部署变更。

## 明确不包含

真实模型和 Jev 调用、策略效果/成本比较、真实 provider 历史与工具消息兼容、部署中工具调用、GUI、subscriptions/MANUAL 改造、上游补丁、生产 AUTO 自动路由。现有 AUTO 请求中间件仍跳过 subagent，此报告不改变当前功能承诺。
