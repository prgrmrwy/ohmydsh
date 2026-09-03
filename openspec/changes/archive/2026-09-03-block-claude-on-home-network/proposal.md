## Why

在家庭网络环境下使用 Claude 系列模型存在需要规避的成本/合规风险，但 DSH 目前没有任何"按当前网络位置限制模型使用"的机制：用户只能靠记忆在切换网络后手动避开某些模型，一旦忘记，请求已经发出就无法撤回。

需要一个在**发送前**就把这种组合拦下来的部署侧防手滑能力：当 DSH 主机的公网出口 IP 属于已知的家庭网络，且当前会话选中的是 Claude 系列模型时，让输入框不可发送并明确告知原因。

## What Changes

- 新增自研 local package `home-network-model-guard`（Host + Web 双半区）：
  - **Host 半区**：注册 Connection RPC channel `/dsh-home-network-guard`（`authority: loopback`），向浏览器提供当前主机公网出口 IP 的判定结果。判定结果按时间缓存（TTL），避免每次发送都外呼。
  - **Web 半区**：订阅官方 `ctx.modelDirectories` 的 per-session 模型选择，与 Host 的网络判定结果合成"是否应拦截"，通过官方 `ctx.conversation.blocks` 把该会话输入框置为 inert 并显示本插件自有的中文/英文原因文案。
- 拦截判定为**两个条件的合取**：主机处于家庭网络 **且** 当前会话选中模型属于 Claude 系列。任一条件不成立则不拦截。
- 家庭网络网段与 Claude 系列识别规则本期**硬编码在包内常量**，不引入 `dsh.yaml` 配置面或设置 UI。
- 判定不可用时（无网络、外呼失败、channel 未注册）**fail open**：不拦截，并在插件内部记录降级原因，不冒充"已确认安全"也不误伤正常使用。
- 本期**不**做 Host 侧强制（不挂 `llm/stream` waterfall）：拦截是客户端 affordance，明确不是安全边界。

## Capabilities

### New Capabilities
- `home-network-model-guard`: 按 DSH 主机公网出口 IP 所属网络与当前会话选中模型的组合，在发送前禁用会话输入框并说明原因；含公网 IP 的 Host 侧采样、TTL 缓存、fail-open 降级语义与拦截生效/解除的时机。

### Modified Capabilities
<!-- 无。本 change 不修改任何既有 capability 的需求：新增的是一个独立可开关的 local package，
     不改动 worktree-session、sidebar-session-provider-icon 等既有定制的行为契约。 -->

## Impact

- **新增**：`packages/home-network-model-guard/`（Host + Web 半区源码）、`openspec/specs/home-network-model-guard/spec.md`。
- **修改**：`dsh.yaml` 新增一条 `type: package` / `source: local` 定制条目（含 brief 与 note 审查记录）。
- **官方依赖面**（DSH 0.1.1-rc.2）：
  - `@deepseek-ai/dsh-client-ui-conversation` 的 `ctx.conversation.blocks`（`ComposerBlocks`，官方为外部插件预留的输入禁用接口）。
  - `@deepseek-ai/dsh-client-ui-model-selection` 的 `ctx.modelDirectories.directoryFor(sessionId)` per-session 选择 store。
  - `@deepseek-ai/dsh-client-connection` 的 Host RPC channel 机制（接线形状复用 `packages/system-clock`）。
  - 以上均为 DSH 升级后需要回归的面。
- **信任面变化**：Host 半区会向**外部** IP 查询服务发起网络请求以获取公网出口 IP——这是本仓库现有自研 package 中的首例外呼，需在 `dsh.yaml` note 中显式记录。不读写凭据、不落盘 IP 历史、不执行命令。
- **非目标**：不阻止 Agent 内部已发起的模型调用，不影响 subagent，不提供绕过审计。
