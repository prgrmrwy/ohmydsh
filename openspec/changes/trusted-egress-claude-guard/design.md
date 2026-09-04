## Context

动机见`proposal.md`。本设计升级已有`home-network-model-guard`，不新建第二个重复插件。现有实现已经具备HostRPC、TTL+本地IPv4指纹缓存、per-session模型订阅、`conversation.blocks`共存自检，但当前策略是“命中家庭IP才拦截+查询失败放行”，且运行时使用单一公网IP服务。

已核实的网络事实：同一台机器访问不同通用IP服务可能得到不同出口IP和国家码；直接访问Anthropic/Cloudflare诊断端点虽然最接近目标服务视角，但会增加一次可被记录的目标域名访问，不适合作为自动门禁探测。因此新策略必须允许两个外部Geo服务作为明确声明的互备输入，同时禁止访问Anthropic诊断端点；外部结果只留在Host内存缓存，不向Web或会话历史返回原文。

`dsh-llm`在Host提供`llm/stream`waterfall，`options.provider`可用于判断Claude路由；该事件位于provideradapter真正发出请求之前，是客户端blocks之外的强制边界。

## Goals / Non-Goals

**Goals:**

-只允许“本地可信出口配置匹配+两个Geo服务结果一致且通过策略”的Claude请求。
-VPN/代理/路由变化、配置变化、服务冲突或不可用都快速收敛为Claude禁止。
-不访问Anthropic或Cloudflaretrace作为自动探测，不保存或下发原始IP。
-同时提供Web提前提示和Host强制拒绝，非Claude模型不受影响。
-真实出口和节点信息留在`$DSH_HOME`本机配置，不进入公开仓库。

**Non-Goals:**

-不承诺识别所有VPN实现或证明某个第三方服务的地理数据库绝对正确。
-不自动把观察到的IP、VPN节点或国家加入可信配置。
-不允许未知状态下由用户输入框绕过Host门禁。
-不处理已经发给provider的请求，也不撤回已产生的账号访问记录。
-不复用`dsh-claude-ux`的会话拒答、隐写提示词或LLM辱骂分类等整活功能。

## Decisions

###1.采用“本地可信配置+双Geo一致性”，不采用Anthropictrace

可信结论必须同时满足：

1.本地可信配置匹配当前观测到的代理/VPN/路由/IP特征；
2.两个配置的Geo服务都成功返回合法国家码；
3.两个结果一致；
4.结果通过本地策略（默认`CN`为阻断地区，且可配置额外阻断地区）。

任一条件不满足，Claude状态为`untrusted`或`unknown`，统一按禁止处理。两个服务返回不同IP或不同国家码时不得投票、不得取多数，直接进入unknown。

**备选：Anthropic/Cloudflaretrace**。它能最接近目标服务视角，但每次自动判定都会访问目标域名，可能形成额外访问记录；且它仍不能证明后续Claude请求会使用同一条连接路径，因此只允许作为用户手动排障，不进入自动授权链路。

**备选：只用一个Geo服务**。成本低但单点错误、服务漂移和误判不可见；用户已明确接受两个互备服务。

###2.Geo查询使用两个HTTPS服务，只读取最小字段

实现将Geo服务抽象为可配置的两个HTTPSendpointadapter；默认选择两个独立服务（具体endpoint与响应字段在实现任务中固定并单测）。请求只包含服务本身必须的空/最小请求，不发送账号、会话文本、DSH路径或VPN凭据；响应只解析国家/地区码与可选的瞬时IP用于内存内交叉诊断，结果对象不得带IP出RPC。

两个服务并行请求，单次请求各自有超时和AbortSignal；一个失败不立即采用另一个结果作为可信结论，而是整体unknown。只有两者都成功且国家码一致时才进入策略判断。结果按TTL缓存，网络指纹变化立即失效。

**代价**：每次缓存刷新产生两个第三方请求，且服务均可能记录请求IP。用户已明确接受这一信任面；与Anthropictrace相比，自动请求不直接触达目标账号服务。

###3.配置分层：仓库策略声明+`$DSH_HOME`本机覆盖

`dsh.yaml`只声明插件启用、默认阻断策略和配置schema版本，不写真实节点/IP。运行时配置存于：

`$DSH_HOME/plugins/dsh-home-network-model-guard/config.json`

配置包含：

-`enabled`或由manifest的`enabled`控制的总开关；
-`blockedCountries`，默认至少包含`CN`；
-`trustedProfiles`列表，每项是用户命名的本地可信VPN/代理配置，包含允许的接口、代理端点、默认路由特征和/或IP/CIDR；
-两个Geo服务的endpoint开关/超时/TTL等非秘密设置。

配置严格校验，拒绝凭据字段、私钥、密码、token、任意URLheader和路径穿越。文件使用owner-only权限，原子写入。配置缺失或非法不关闭插件，而是保持Claudefail-closed；`dsh.yaml`的`enabled:false`仍是显式总开关，关闭后不注册Host门禁和Web提示。

**备选：全部写`dsh.yaml`**。容易同步，但会把个人VPN/IP特征推到公开仓库；否决。

###4.可信状态机采用fail-closed，但非Claudefail-open

状态至少分为`trusted`、`blocked-region`、`untrusted`、`unknown`、`disabled`。只有`trusted`允许Claude。`blocked-region`表示双服务一致命中阻断地区；`untrusted`表示本地可信profile不匹配；`unknown`表示服务冲突、超时、配置缺失或网络事实变化尚未确认。Web和Host对Claude都把前三种非trusted视为禁止；非Claude直接放行。

网络指纹纳入缓存键：活动IPv4集合、默认路由、代理/VPN相关可读特征和当前配置代际。指纹/配置代际变化时立即失效，不沿用旧trusted结论。

###5.Host`llm/stream`做强制拒绝，Webblocks做提前反馈

在Host注册`llm/stream`waterfall：读取完整请求的provider/model，Claudeprovider（至少`claude`、`anthropic`及现有订阅路由）且当前可信状态非trusted时，不调用`next()`，抛出稳定的用户可理解错误；非Claude直接调用`next()`。错误不得包含原始IP、VPN节点、Geo响应正文或凭据。

Web继续订阅per-session模型状态并通过官方composerblocks显示本地化提示。Web和Host共享一个Host权威状态缓存，不在浏览器重新猜测网络位置。客户端绕过不再影响真实授权；Host门禁覆盖CLI、subagent和其他LLM流路径。

**风险**：Host门禁会阻止已经认证但当前网络切换后的Claude请求，体验上可能突然失败。缓解：Web提前显示原因、配置状态可诊断、总开关可在manifest关闭；不提供“本次绕过”以避免形成未知出口放行漏洞。

###6.手动诊断不改变授权状态

设置页可提供“检查当前出口”按钮，展示脱敏状态：可信profile是否匹配、两个Geo服务是否一致、阻断策略是否命中、缓存年龄和失败原因。不得展示或持久化原始IP，不得自动写入trustedProfiles。诊断请求与自动判定共用缓存，避免重复外呼；用户明确触发时可显示服务名称和请求时间。

## Risks / Trade-offs

-**[第三方Geo服务记录请求IP]**→明确列入manifest/README信任面；只发两个固定HTTPSendpoint，最小字段，不访问Anthropic；提供本地总开关。
-**[两个服务冲突导致Claude被禁用]**→这是刻意的fail-closed取舍；诊断页显示“服务结果冲突”，用户可确认VPN配置或暂时关闭插件。
-**[VPN节点切换无法被所有平台统一观察]**→支持多种可读本地特征；无法证明变化时立即unknown并禁止Claude，不假设网络未变。
-**[可信IP/CIDR配置过期]**→配置校验与状态诊断提示失配；不自动扩充白名单；非Claude不受影响。
-**[Host错误覆盖过宽]**→仅匹配明确Claudeprovider/model；单测覆盖非Claude、unknown和provider路由；错误不调用`next()`前完成判定。
-**[旧HOME_NETWORKS迁移误放行]**→新配置缺失时Claudefail-closed；部署时报告迁移提示，不把旧家庭白名单当作可信出口自动接受。

## Migration Plan

-先新增配置schema与默认fail-closed策略，但不自动替用户写入可信profile。
-将现有`HOME_NETWORKS=['115.197.18.69']`迁移为本机配置示例，仅写入当前用户的`$DSH_HOME`，不提交仓库；用户确认VPN/代理节点后再启用trustedprofile。
-保留`dsh.yamlenabled:false`回滚通道；关闭后重新build并重启，Web和Host门禁都卸载。
-部署后先在非Claude模型验证不受影响，再用手动诊断确认两个Geo服务一致、可信profile命中，最后验证Claude允许/拒绝和VPN切换fail-closed。
-如果任意第三方服务长期不可达，配置可将策略保持fail-closed；不自动回退到Anthropictrace或单服务放行。

## Open Questions

-默认两个Geo服务的最终endpoint与响应字段需要在实现前做一次当前可达性、HTTPS和隐私审查；endpoint不可达不改变fail-closed语义。
-本机VPN/代理特征在macOS、Linux和SSH隧道场景的最小跨平台集合需要在实现时固定，并对无法读取的平台信号安全降级。
