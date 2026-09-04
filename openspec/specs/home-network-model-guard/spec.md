# home-network-model-guard Specification

## Purpose

在 DSH 主机出口国家/地区命中阻断清单（默认 CN）或判定未知时，阻止 Claude 系列模型的发送与调用：Web 输入框提前禁用，Host 在模型流入口强制拒绝；判定来自两个互为备份的第三方 IP 归属服务（主失败切备、双失败未知），非 Claude 模型不受影响。

## Requirements

### Requirement: 网络位置真相源为 Host 出口国家/地区判定

系统 SHALL 依据 DSH Host 出口 IP 的国家/地区码判定 Claude 请求是否允许，判定来源为两个互为备份的第三方 IP 归属服务：主服务成功即使用其结果；主服务失败时切换备用服务。系统 MUST NOT 为自动判定主动访问 Anthropic、Cloudflare 或任何目标模型的诊断端点，也 MUST NOT 依据浏览器所在设备的地址、时区或浏览器信号推断出口位置。

自动判定结果对外 SHALL 只暴露阻断/放行/未知分类与新鲜度、降级原因；系统 MUST NOT 将原始公网 IP、VPN 凭据、代理凭据或完整本地网络配置写入持久化存储、会话历史或浏览器响应。

#### Scenario: 浏览器与 Host 不在同一台机器

- **WHEN** 用户经 SSH 隧道从另一台设备的浏览器访问 DSH Web GUI，而 DSH Host 位于家庭网络
- **THEN** 判定依据 DSH Host 的出口国家/地区码，与浏览器所在设备无关

#### Scenario: 主服务失败后使用备用服务

- **WHEN** 主 Geo 服务不可达或返回无法解析的响应，而备用服务返回合法国家/地区码
- **THEN** 系统采用备用服务结果继续判定，不因主服务失败直接进入未知

#### Scenario: 自动判定不访问 Anthropic 探测端点

- **WHEN** Web 客户端首次加载或缓存失效并请求当前出口判定
- **THEN** 系统只访问配置声明的两个 IP 归属服务，不向 Anthropic、Cloudflare 或目标模型的诊断端点发起探测

#### Scenario: 判定响应不泄漏原始网络事实

- **WHEN** 浏览器取得出口判定
- **THEN** 响应只包含分类、状态和新鲜度，不包含原始 IP、VPN peer、代理地址或凭据

### Requirement: 出口判定按时间、网络指纹和配置代际缓存

系统 SHALL 对 Host 出口判定结果进行内存缓存；在缓存 TTL 有效且本地网络指纹与配置代际未变化时，重复判定 SHALL 直接使用缓存。缓存 SHALL 在以下任一条件满足时失效并重新判定：TTL 过期、网络指纹变化、配置写入或配置内容变化。

系统 MUST NOT 把 Geo 响应中的原始 IP 或端点信息写入持久化存储；并发判定请求 SHALL 合并为一次。

#### Scenario: 有效期内重复判定

- **WHEN** TTL 尚未过期且网络指纹、配置代际均未变化
- **THEN** 重复请求返回缓存结论，不产生外部网络请求

#### Scenario: 网络切换后刷新

- **WHEN** 默认路由、活动接口或代理端点发生变化，且 TTL 尚未过期
- **THEN** 缓存立即失效，下一次判定重新查询

#### Scenario: 配置变更后刷新

- **WHEN** 用户写入新的阻断地区或 Geo 端点配置
- **THEN** 缓存立即失效并重新判定，不沿用旧配置的结论

#### Scenario: 并发判定合并

- **WHEN** 缓存失效时同时到达多个判定请求
- **THEN** 系统只执行一次网络判定，所有请求共享同一结论

### Requirement: 阻断地区采用明确黑名单语义

系统 SHALL 仅当出口国家/地区码命中配置的阻断清单（默认至少包含 `CN`）时判定为阻断。未命中阻断清单且判定成功时 SHALL 判定为放行；判定无法取得结论时 SHALL 判定为未知，绝不把未知反推为放行或阻断。

配置为空、缺失或非法时，系统 SHALL 使用默认阻断清单（至少 `CN`）并继续按未知/阻断对 Claude fail-closed，除非用户显式关闭插件（`enabled: false`）。

#### Scenario: 命中阻断地区

- **WHEN** 出口国家/地区码为 `CN` 且 `CN` 在阻断清单中
- **THEN** 网络状态为阻断，Claude 输入发送被禁止，Host 侧 Claude 调用被拒绝

#### Scenario: 非阻断地区

- **WHEN** 出口国家/地区码（如 `SG`、`JP`、`US`）不在阻断清单中
- **THEN** 网络状态为放行，Claude 请求可以进入模型选择和发送流程

#### Scenario: 配置缺失时仍使用默认阻断清单

- **WHEN** 本机配置文件不存在或为空
- **THEN** 系统使用默认阻断清单（`CN`）判定，Claude 未被显式允许

### Requirement: 非阻断地区与 Claude 系列同时成立时允许，否则禁用

当且仅当当前会话选中 Claude 系列模型且当前网络状态为放行时，系统 SHALL 允许该会话的 Claude 输入继续发送。Claude 系列模型在阻断或未知出口下 SHALL 被输入框禁用并显示本地化原因。

判定 SHALL 以会话为单位；一个会话被禁用 MUST NOT 影响其他会话的非 Claude 输入。

#### Scenario: 非阻断出口 + Claude 模型

- **WHEN** 出口国家/地区码未命中阻断清单，且当前会话选中 Claude 系列模型
- **THEN** 输入框可正常发送，Host 侧允许该 Claude 模型调用

#### Scenario: 阻断出口 + Claude 模型

- **WHEN** 出口国家/地区码命中阻断清单，且当前会话选中 Claude 系列模型
- **THEN** 输入框不可发送并显示原因，Host 侧拒绝该 Claude 模型调用

#### Scenario: 非阻断出口 + 非 Claude 模型

- **WHEN** 出口国家/地区码未命中阻断清单，且当前会话选中非 Claude 模型
- **THEN** 输入框可正常发送

#### Scenario: 阻断出口 + 非 Claude 模型

- **WHEN** 出口国家/地区码命中阻断清单，且当前会话选中非 Claude 模型
- **THEN** 输入框可正常发送，不受 Claude 门禁影响

### Requirement: 模型切换即时生效与解除

系统 SHALL 订阅官方 per-session 模型选择状态；用户切换模型或出口判定状态发生变化后，输入框门禁 SHALL 无需页面刷新或重启会话即可生效或解除。Host 侧门禁 SHALL 使用同一份当前模型与出口判定结论。

#### Scenario: 判定从放行切换为阻断/未知

- **WHEN** 当前会话正在使用 Claude，且出口判定变为阻断或未知
- **THEN** Claude 输入框立即禁用，后续 Host Claude 调用立即拒绝

#### Scenario: 切到 Claude 后立即禁用

- **WHEN** 当前出口判定为阻断或未知，用户把当前会话模型从非 Claude 切换为 Claude 系列
- **THEN** 输入框立即变为不可发送，Host 拒绝新的 Claude 调用，无需刷新页面

#### Scenario: 切离 Claude 后立即恢复

- **WHEN** 输入框因阻断/未知出口 + Claude 被禁用，用户把模型切换为非 Claude 系列
- **THEN** 输入框立即恢复可发送，非 Claude 调用不受门禁影响

#### Scenario: 判定从阻断/未知恢复为放行

- **WHEN** 用户切换到非阻断出口，且系统对该出口完成放行判定
- **THEN** Claude 输入框恢复可发送，Host 允许新的 Claude 调用

### Requirement: 未知出口对 Claude fail-closed

当出口判定无法取得结论时——包括两个 Geo 服务均不可达、响应无法解析、网络事实变化尚未确认、Host channel 不可用或判定逻辑异常——系统 SHALL 对 Claude 系列模型 fail-closed：输入框保持禁用，Host 侧 Claude 调用拒绝。系统 SHALL 对非 Claude 模型 fail-open，不得因 Claude 门禁故障而阻止非 Claude 使用。

系统 SHALL 暴露不包含敏感网络事实的诊断状态，并在 Geo 服务恢复后按退避策略持续重试判定，不得永久停留在降级态。

#### Scenario: 启动时尚未完成判定

- **WHEN** 页面加载后出口判定仍在进行
- **THEN** Claude 输入框保持禁用，非 Claude 输入不受影响

#### Scenario: 两个 Geo 服务均不可达

- **WHEN** 主备两个 Geo 服务都不可达或超时
- **THEN** 系统判定为未知并持续按退避重试；恢复前 Claude 保持禁用

#### Scenario: 判定异常后恢复

- **WHEN** 一次判定异常，随后 Geo 服务恢复并返回非阻断国家/地区码
- **THEN** 系统重新判定为放行，Claude 恢复可用

#### Scenario: 非 Claude 不受未知状态影响

- **WHEN** 网络状态未知且当前会话选中非 Claude 模型
- **THEN** 非 Claude 输入仍可正常发送

### Requirement: 门禁是 Host 强制边界并由客户端提前提示

系统 SHALL 在 Host 的模型流开始前拒绝阻断或未知出口的 Claude 调用，不得仅依赖浏览器输入框状态。Web 客户端 SHALL 使用 composer block 提前提示用户，但客户端状态不是授权边界。

该门禁 MUST 覆盖用户输入、CLI、subagent 和其他经过 Host LLM 流的 Claude 调用；已在门禁建立前开始的调用是否完成由 Host 当前请求生命周期决定，不得声称可以撤回已经发出的请求。

#### Scenario: 绕过输入框调用 Claude

- **WHEN** 阻断或未知出口下通过 CLI、subagent 或其他非 Web 输入路径发起 Claude 模型流
- **THEN** Host 在向模型提供方发出请求前拒绝该调用

#### Scenario: 非 Claude Host 调用

- **WHEN** 阻断或未知出口下发起非 Claude 模型调用
- **THEN** Host 不因本门禁拒绝该调用


### Requirement: 阻断地区与 Geo 端点配置可校验、可审计且不含凭据

系统 SHALL 提供本机配置，至少支持维护阻断国家/地区清单（默认 `CN`）与两个互为备份的 Geo 服务端点。配置 SHALL 在写入前校验格式、去重和冲突；配置不得包含代理密码、VPN 私钥、访问令牌或其他凭据。配置变更 SHALL 触发当前判定失效并重新评估。

#### Scenario: 添加阻断地区

- **WHEN** 用户保存一个合法的阻断国家/地区码配置
- **THEN** 配置持久化在本机，当前判定失效并重新评估，配置内容不发送到外部服务

#### Scenario: 配置包含凭据

- **WHEN** 用户尝试把密码、私钥或令牌写入配置
- **THEN** 系统拒绝保存，并提示配置只接受国家/地区码、端点 URL 和非秘密参数

#### Scenario: 修改 Geo 端点

- **WHEN** 用户替换其中一个 Geo 服务端点
- **THEN** 新端点通过格式/HTTPS 校验后被采用，判定缓存失效并重新评估

### Requirement: 手动诊断与自动判定分离

系统 MAY 提供用户主动触发的网络诊断，但自动门禁 MUST NOT 因诊断请求访问 Anthropic 或第三方目标模型服务。手动诊断结果 SHALL 明确标注为诊断信息，不得自动把观察到的出口加入任何放行集合。

#### Scenario: 用户主动诊断

- **WHEN** 用户从设置页主动请求查看当前网络诊断
- **THEN** 系统展示脱敏后的国家/地区判定、所用服务与失败原因，并明确不会自动修改配置

#### Scenario: 自动判定期间

- **WHEN** 页面启动、模型切换或缓存失效触发自动判定
- **THEN** 系统只访问配置声明的两个 IP 归属服务
