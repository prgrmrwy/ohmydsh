## Why

现有`home-network-model-guard`用家庭公网IP白名单做客户端防手滑，但用户真正要规避的是Claude/ClaudeCode对某些风险出口的账号风控，而不是某个固定家庭地址。直接探测Anthropic会留下不必要的访问记录；更合适的策略是由Host调用两个互备的第三方IP归属服务，并结合本地可信VPN/代理配置进行交叉判定。两服务都不可达、结果冲突或本地出口状态无法确认时，Claude默认禁止。

## What Changes

- 将网络判定从“命中家庭IP才拦截”改为“当前出口必须被确认可信，否则视为不可信”。
- Host调用两个互备的第三方IP归属服务，读取国家/地区码；两个服务均失败时判定未知，两个服务结果冲突时同样判定未知。自动判定不得访问Anthropic或Cloudflare诊断端点。
- 可信出口配置放在`$DSH_HOME`本地配置文件；仓库只存默认策略和schema，不提交真实VPN节点、代理端点或公网IP。配置支持用户维护可信VPN/代理节点标识、出口IP/CIDR或本机路由/代理特征。
- Web输入框继续在Claude系列模型+不可信出口时禁用并提示；状态切换无需刷新页面。
- Host增加`llm/stream`强制门禁：绕过输入框、CLI、subagent或其他模型调用路径时，Claude请求从不可信出口发起也必须拒绝。
- 判定不明、VPN/代理端点变化、路由变化或可信配置缺失时，对Claude**fail-closed**；非Claude模型不受该门禁影响。
- 保留现有Host缓存、single-flight、网络指纹失效和blocks共存机制，并补充可信出口切换与强制拒绝的审计诊断。

## Capabilities

### New Capabilities
<!--无：这是对已有guardcapability的需求升级。-->

### Modified Capabilities
-`home-network-model-guard`:将家庭IP白名单、自动公网探测和客户端affordance升级为本地可信出口策略；未知出口对Claudefail-closed，并增加Host`llm/stream`强制门禁。

## Impact

-**修改**：`packages/home-network-model-guard/`的共享契约、Host网络判定、Webguard、缓存与测试。
-**修改**：`openspec/specs/home-network-model-guard/spec.md`的网络来源、失效、fail-closed与Host强制要求。
-**配置**：新增本地可信出口配置schema（不放凭据，不上传配置）；具体配置入口需在design中确定。
-**运行时信任面收窄**：自动判定不访问Anthropic或Cloudflare诊断端点；仅访问两个明确声明的IP归属服务，并只读取国家/地区码，不保存IP原文、不发送账号或会话数据。
-**兼容性**：已有`HOME_NETWORKS`精确IP配置需要迁移为可信出口配置；缺少迁移配置时Claude默认被禁止，非Claude不受影响。
-**安全边界**：Host`llm/stream`是强制门禁；客户端`conversation.blocks`仍只是用户体验层的提前提示。