## Context

动机见 `proposal.md`。本设计升级已有 `home-network-model-guard`，不新建第二个重复插件。现有实现已具备 Host RPC、TTL+本地 IPv4 指纹缓存、per-session 模型订阅、`conversation.blocks` 共存自检，并已加入"失败后指数退避持续重试（2s→60s 上限）"；当前策略是"命中家庭 IP 白名单则拦截 + 查询失败放行"。

用户已确认的关键选择：

- **接受第三方 IP 归属服务**，两个互为 backup：主服务失败时用备用；两者都不可达才判定未知。
- **未知不放行**：两个服务都不通时 Claude 默认禁止（fail-closed），随后持续退避重试；用户可从 `dsh.yaml` 的 `enabled: false` 显式关闭。
- **配置组合**：`dsh.yaml` 只声明插件启用与默认策略；真实参数放在 `$DSH_HOME` 本机配置文件，不进公开仓库。

已核实事实：同一机器不同 IP 服务可能返回不同出口和国别（公司 NAT/池）；直接访问 Anthropic/Cloudflare 诊断端点最接近目标视角，但会增加可记录的目标域名访问，不支持作为自动门禁。因此自动判定只访问两个明确声明的 IP 归属服务，禁止 Anthropic/Cloudflare 诊断端点。

`dsh-llm` 在 Host 提供 `llm/stream` waterfall，`options.provider`/model 可用于识别 Claude 路由；该事件位于 provider adapter 真正发出请求之前，是客户端 blocks 之外的强制边界。

## Goals / Non-Goals

**Goals:**

- 出口国家/地区码命中阻断清单（默认 `CN`）或判定为未知时，禁止 Claude；非阻断国家放行。
- 两个互为备份的 Geo 服务：主失败切备；双失败→未知→Claude fail-closed，并按退避持续重试。
- 不访问 Anthropic 或 Cloudflare trace 作为自动探测；不保存或下发原始 IP。
- 同时提供 Web 提前提示和 Host 强制拒绝，非 Claude 模型不受影响。
- 真实 Geo 端点与阻断清单留在 `$DSH_HOME` 本机配置，不进入公开仓库。

**Non-Goals:**

- 不承诺识别所有 VPN 实现，也不证明任何第三方服务的地理数据库绝对正确。
- 不自动把观察到的国家/地区或出口加入放行集合。
- 不允许未知状态下由用户输入框绕过 Host 门禁。
- 不处理已经发给 provider 的请求，也不撤回已产生的账号访问记录。
- 不复用 `dsh-claude-ux` 的会话拒答、隐写提示词或 LLM 分类等整活功能。

## Decisions

### 1. 采用两个互为备份的 Geo 服务，按 failover 判定

判定流程：

1. 主 Geo 服务请求成功且返回合法国家/地区码 → 采用该结果；
2. 主服务失败/超时/无法解析 → 请求备用服务；备用成功 → 采用备用结果；
3. 两者都失败 → 状态 `unknown`（Claude fail-closed），按指数退避持续重试（复用已实现的 2s→60s 退避）；
4. 得到国家/地区码后，命中阻断清单（默认 `CN`）→ `blocked`；否则 → `allowed`。

**备选（已否决）：Anthropic/Cloudflare trace**。虽然最接近目标服务视角，但每次自动判定都访问目标域名，可能形成额外访问记录；且仍不能证明后续 Claude 请求走同一连接路径，只允许作为用户手动排障。

**备选（已否决）：双服务投票求一致**。多一次外呼、且在公司 NAT 池下频繁冲突导致永久 unknown；用户明确选择"互为 backup"而非一致性投票。

### 2. 两个默认 Geo 端点与最小解析

默认主端点与备用端点各一个 HTTPS IP 归属服务（实现时固定并验证；目前候选包括 ipinfo.io/json、ipwho.is、ip-api 的兼容形式）。请求不发送账号、会话文本、DSH 路径或凭据；只解析国家/地区码（如 ipinfo `country`、`countryCode` 类字段，失败即视为该服务不可用并切换备用）。请求超时 + AbortSignal；结果只留 Host 内存缓存，不得带 IP 出 RPC。

**信任面**：每次缓存刷新最多访问两个外部服务各一次，服务均可能记录请求 IP；用户已明确接受。自动请求不触达目标账号服务。

### 3. 配置分层：仓库策略声明 + `$DSH_HOME` 本机覆盖

`dsh.yaml` 只声明插件启用、默认阻断策略（`CN`）和配置 schema 版本，不写真实端点以外的网络指纹。

运行时配置位于：

`$DSH_HOME/plugins/dsh-home-network-model-guard/config.json`

字段（全部非秘密）：

- `blockedCountries: string[]`（默认 `['CN']`，可追加）；
- `geoEndpoints: [primaryUrl, fallbackUrl]`（各为纯 HTTPS URL，无凭据、无自定义 header）；
- `timeoutMs` / `ttlMs` / `backoffBaseMs` / `backoffMaxMs` 等非秘密参数（可选覆盖）。

配置严格校验：只接受上述字段与合法值；拒绝密码/私钥/令牌字段名与 URL 中凭据；原子写入、owner-only 权限。配置缺失/非法不关闭插件，而是使用默认值并保持 Claude fail-closed。`dsh.yaml` 的 `enabled: false` 是显式总开关，关闭后不注册 Host 门禁和 Web 提示。

**备选：全部写 `dsh.yaml`**。容易同步，但会把个人出口策略推到公开仓库；否决。

### 4. 状态机与判定缓存保持 fail-closed

状态：`allowed`、`blocked`、`unknown`、`disabled`。只有 `allowed` 允许 Claude；`blocked`/`unknown` 都禁止 Claude；非 Claude 恒放行；`disabled`（manifest 关闭）时一切原样。

缓存键继续包含网络指纹，新增**配置代际**（配置写入或内容变化即失效，重新判定）。复用 TTL + 指纹 + single-flight + 指数退避；退避窗口内不再外呼，网络指纹变化时立即重查并重置退避。原始 IP/Geo 响应只在 Host 内存短生命周期，缓存与响应不含 IP 原文。

### 5. Host `llm/stream` 强制拒绝 + Web blocks 提前反馈

在 Host 注册 `llm/stream` waterfall：识别 Claude 路由（现有订阅路由 `claude`/`anthropic` 及模型名匹配），状态非 `allowed` 时不调用 `next()` 并抛出稳定错误；非 Claude 直接 `next()`。错误不得包含原始 IP、Geo 响应正文或凭据。Web 继续订阅 per-session 模型状态并用 composer blocks 显示原因；Web 与 Host 共享同一 Host 权威状态缓存。

**风险**：Host 门禁会阻止已认证但当前判定非 allowed 的 Claude 请求。缓解：Web 提前显示原因、设置页诊断、manifest 总开关；不提供"本次绕过"。

### 6. 手动诊断不改变授权状态

设置页提供"检查当前出口"按钮：展示脱敏状态（判定结果、所用服务主/备、失败原因、缓存年龄、配置代际），不展示或持久化原始 IP，不自动修改配置。诊断与自动判定共用缓存，避免重复外呼。

## Risks / Trade-offs

- **[第三方 Geo 服务记录请求 IP]** → 列入 manifest/README 信任面；只访问两个固定 HTTPS 端点、最小字段、不访问 Anthropic；提供本地总开关。
- **[主备都不可达导致 Claude 被禁用]** → 这是刻意的 fail-closed 取舍；退避持续重试 + 诊断页显示失败原因；需要时 `enabled: false`。
- **[Geo 服务返回国别与目标服务实际制裁视角不同]** → 用户明确接受第三方判定；诊断可对比；误判时手动关闭或调整端点。
- **[Host 错误覆盖过宽]** → 仅匹配明确 Claude provider/model；非 Claude、disabled 与 allowed 路径单测覆盖。
- **[旧 HOME_NETWORKS 配置迁移误放行]** → 新配置缺省即阻断清单 `['CN']` fail-closed；部署时报告迁移提示，不把旧家庭白名单当作放行依据。

## Migration Plan

1. 保留旧白名单字段兼容读取（仅用于一次性迁移提示），不参与判定。
2. 生成本机配置示例（blockedCountries `['CN']` + 默认双端点），写入当前用户 `$DSH_HOME`，不提交仓库。
3. 部署后先在非 Claude 模型验证不受影响，再用手动诊断确认两个服务可达、判定正确，最后验证 Claude 阻断/放行和双服务失败 fail-closed。
4. `dsh.yaml` 的 `enabled: false` 保留为回滚通道；关闭后重新 build 并重启，Web 与 Host 门禁都卸载。

## Open Questions

- 两个默认 Geo 端点的最终 URL 与响应字段需在实现前做一次可达性与隐私审查；端点不可达不改变 fail-closed 语义（已有退避重试）。
- `llm/stream` 上是否同时拦截已通过输入框但判定瞬时变化的请求，取决于 Host 判定缓存刷新节奏；实现时固定为"每次模型流入口取当前缓存结论"。