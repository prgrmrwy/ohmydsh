## MODIFIED Requirements

### Requirement:网络位置真相源为Host本地可信出口事实

系统SHALL仅依据DSHHost本地可观察的网络事实与用户显式配置的可信出口特征判定Claude请求是否允许，包括活动接口、默认路由、代理/VPN端点及用户配置的可信IP/CIDR。系统MUSTNOT为自动判定主动访问Anthropic、Cloudflare、ipinfo、ip-api或其他第三方地理定位服务，也MUSTNOT依据浏览器所在设备的地址、时区或浏览器信号推断出口可信度。

自动判定结果对外SHALL只暴露可信/不可信/未知分类与新鲜度、降级原因；系统MUSTNOT将原始公网IP、VPN凭据、代理凭据或完整本地网络配置写入持久化存储、会话历史或浏览器响应。

#### Scenario:浏览器与Host不在同一台机器

- **WHEN**用户经SSH隧道从另一台设备的浏览器访问DSHWebGUI，而DSHHost通过一个已配置的可信VPN出口访问Claude
- **THEN**判定依据DSHHost的本地可信出口事实，与浏览器所在设备的网络无关

#### Scenario:自动判定不访问Anthropic探测端点

- **WHEN**Web客户端首次加载或缓存失效并请求当前出口判定
- **THEN**系统只读取Host本地网络事实与本地可信配置，不向Anthropic、Cloudflare或第三方Geo服务发起探测请求

#### Scenario:判定响应不泄漏原始网络事实

- **WHEN**浏览器取得可信出口判定
- **THEN**响应只包含分类、状态和新鲜度，不包含原始IP、VPNpeer、代理地址或凭据

### Requirement:可信出口判定按时间和网络指纹缓存

系统SHALL对Host本地可信出口判定进行内存缓存；在缓存TTL有效且本地网络指纹、默认路由和代理/VPN相关特征未变化时，重复判定SHALL直接使用缓存，不执行外部网络请求。

缓存SHALL在TTL过期或观测到主机网络配置变化时失效。系统SHALL合并并发判定请求，且缓存失效与刷新过程不得将任何原始网络事实写入持久化存储。

#### Scenario:有效期内重复判定

- **WHEN**本地可信配置和网络指纹未变化，且TTL尚未过期
- **THEN**重复请求返回缓存结论，不产生外部网络请求

#### Scenario:网络切换后刷新

- **WHEN**默认路由、活动接口、代理端点或VPNpeer发生变化，且TTL尚未过期
- **THEN**缓存立即失效，下一次判定重新读取本地事实

#### Scenario:并发判定合并

- **WHEN**缓存失效时同时到达多个判定请求
- **THEN**系统只执行一次本地判定刷新，所有请求共享同一结论

### Requirement:可信出口采用明确白名单语义

系统SHALL只把明确命中用户可信出口配置的网络状态判定为可信。未命中、无法读取、配置为空、配置格式非法或检测到网络特征变化但尚未重新确认时，系统MUST判定为不可信或未知，绝不把未知反推为可信。

已有家庭公网IP白名单SHALL迁移为可信出口配置；迁移未完成时，Claude请求默认不允许，非Claude模型不受影响。

#### Scenario:命中可信VPN出口

- **WHEN**当前本地代理/VPN端点或出口IP/CIDR明确命中可信配置
- **THEN**网络状态为可信，Claude请求可以继续进入模型选择和发送流程

#### Scenario:未命中可信配置

- **WHEN**当前出口或网络特征未命中可信配置
- **THEN**网络状态为不可信，Claude输入发送被禁止，Host侧Claude调用被拒绝

#### Scenario:配置为空或非法

- **WHEN**用户尚未配置可信出口，或配置无法通过校验
- **THEN**Claude默认被禁止，非Claude模型仍可正常使用

### Requirement:可信出口与Claude系列同时成立时允许，否则禁用

当且仅当当前会话选中Claude系列模型且当前网络状态为可信时，系统SHALL允许该会话的Claude输入继续发送。Claude系列模型在不可信或未知出口下SHALL被输入框禁用并显示本地化原因。

判定SHALL以会话为单位；一个会话被禁用MUSTNOT影响其他会话的非Claude输入。

#### Scenario:可信出口+Claude模型

- **WHEN**当前出口命中可信配置，且当前会话选中Claude系列模型
- **THEN**输入框可正常发送，Host侧允许该Claude模型调用

#### Scenario:不可信出口+Claude模型

- **WHEN**当前出口未命中可信配置，且当前会话选中Claude系列模型
- **THEN**输入框不可发送并显示原因，Host侧拒绝该Claude模型调用

#### Scenario:可信出口+非Claude模型

- **WHEN**当前出口命中可信配置，且当前会话选中非Claude模型
- **THEN**输入框可正常发送

#### Scenario:不可信出口+非Claude模型

- **WHEN**当前出口未命中可信配置，且当前会话选中非Claude模型
- **THEN**输入框可正常发送，不受Claude门禁影响

### Requirement:模型切换即时生效与解除

系统SHALL订阅官方per-session模型选择状态；用户切换模型或可信出口状态发生变化后，输入框门禁SHALL无需页面刷新或重启会话即可生效或解除。Host侧门禁SHALL使用同一份当前模型与可信出口结论。

#### Scenario:可信出口切换为未知出口

- **WHEN**当前会话正在使用Claude，且本地检测到VPN节点、代理端点或默认路由变化
- **THEN**Claude输入框立即禁用，后续HostClaude调用立即拒绝

#### Scenario:不可信出口切换为可信出口

- **WHEN**用户确认并切换到已配置的可信VPN/代理出口
- **THEN**Claude输入框恢复可发送，Host允许新的Claude调用

#### Scenario:切离Claude

- **WHEN**输入框因不可信出口+Claude被禁用，用户切换为非Claude模型
- **THEN**输入框立即恢复可发送

#### Scenario:切到 Claude 后立即禁用

- **WHEN**当前出口不可信，用户把当前会话模型从非Claude切换为Claude系列
- **THEN**输入框立即变为不可发送，Host拒绝新的Claude调用，无需刷新页面

#### Scenario:切离 Claude 后立即恢复

- **WHEN**输入框因不可信出口+Claude被禁用，用户把模型切换为非Claude系列
- **THEN**输入框立即恢复可发送，非Claude调用不受门禁影响

### Requirement:未知出口对Claudefail-closed

当可信出口判定无法取得结论时——包括本地配置缺失、路由/VPN信息不可读、特征变化尚未确认、Hostchannel不可用或判定逻辑异常——系统SHALL对Claude系列模型fail-closed：输入框保持禁用，Host侧Claude调用拒绝。系统SHALL对非Claude模型fail-open，不得因Claude门禁故障而阻止非Claude使用。

系统SHALL暴露不包含敏感网络事实的诊断状态，并在后续网络或配置变化时重新判定。

#### Scenario:启动时尚未完成判定

- **WHEN**页面加载后可信出口判定仍在进行
- **THEN**Claude输入框保持禁用，非Claude输入不受影响

#### Scenario:判定异常后恢复

- **WHEN**一次本地判定异常，随后本地网络和可信配置恢复正常
- **THEN**系统重新判定；命中可信配置后恢复Claude，否则继续禁止

#### Scenario:非Claude不受未知状态影响

- **WHEN**网络状态未知且当前会话选中非Claude模型
- **THEN**非Claude输入仍可正常发送

### Requirement:门禁是Host强制边界并由客户端提前提示

系统SHALL在Host的模型流开始前拒绝不可信或未知出口的Claude调用，不得仅依赖浏览器输入框状态。Web客户端SHALL使用composerblock提前提示用户，但客户端状态不是授权边界。

该门禁MUST覆盖用户输入、CLI、subagent和其他经过HostLLM流的Claude调用；已在门禁建立前开始的调用是否完成由Host当前请求生命周期决定，不得声称可以撤回已经发出的请求。

#### Scenario:绕过输入框调用Claude

- **WHEN**不可信出口下通过CLI、subagent或其他非Web输入路径发起Claude模型流
- **THEN**Host在向模型提供方发出请求前拒绝该调用

#### Scenario:非ClaudeHost调用

- **WHEN**不可信出口下发起非Claude模型调用
- **THEN**Host不因本门禁拒绝该调用

## ADDED Requirements

### Requirement:可信出口配置可校验、可审计且不含凭据

系统SHALL提供本地可信出口配置，至少支持用户维护可信代理/VPN节点标识以及可信出口IP/CIDR。配置SHALL在写入前校验格式、去重和冲突；配置不得包含代理密码、VPN私钥、访问令牌或其他凭据。配置变更SHALL触发当前判定失效并重新评估。

#### Scenario:添加可信节点

- **WHEN**用户保存一个合法的可信节点或IP/CIDR配置
- **THEN**配置持久化在本机，当前判定失效并重新评估，配置内容不发送到外部服务

#### Scenario:配置包含凭据

- **WHEN**用户尝试把密码、私钥或令牌写入可信出口配置
- **THEN**系统拒绝保存，并提示配置只接受节点标识、路由特征或IP/CIDR

### Requirement:手动诊断与自动判定分离

系统MAY提供用户主动触发的网络诊断，但自动门禁MUSTNOT因诊断请求访问Anthropic或第三方Geo服务。手动诊断结果SHALL明确标注为诊断信息，不得自动把未配置的出口加入可信名单。

#### Scenario:用户主动诊断

- **WHEN**用户从设置页主动请求查看当前网络诊断
- **THEN**系统展示脱敏后的本地判定与配置匹配结果，并明确不会自动修改可信配置

#### Scenario:自动判定期间

- **WHEN**页面启动、模型切换或缓存失效触发自动判定
- **THEN**系统不向Anthropic或第三方Geo服务发起探测
