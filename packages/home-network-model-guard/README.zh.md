# dsh-home-network-model-guard

[English](README.md) · 简体中文

<!-- problem -->
有些地区不允许使用 Claude 模型，而你的 DSH 主机可能在不知不觉中处于这样的网络里，比如家庭宽带或某个 VPN 出口。这个守卫检查 DSH 主机出口所在的国家/地区，只要该国家/地区在你的阻断清单里，或者无法判定，就在输入框和 host 两层拦截所有 Claude 系列模型的请求。

![DSH 设置 → 出口守卫：当前判定、国家/地区与来源，以及阻断名单配置](docs/overview.png)

**安装。** 通过 `dsh.yaml` 管理（条目 `home-network-model-guard`，`source: local`）：设为 `enabled: true`，运行 `dsh build`，然后重启 DSH。设为 `enabled: false` 并重新 build 会卸载 host 门禁和 Web 提示，也就是彻底取消这项限制。设计见 OpenSpec change `block-claude-on-home-network`、`trusted-egress-claude-guard` 与 `fix-geo-timeout-budget-starvation`；当前行为规范见 `openspec/specs/home-network-model-guard`。

## 行为

**规则。** 当选中的是 **Claude 系列**模型，**并且** host 出口判定结果不是 `allowed` 时，请求被拦截。判定结果有三种：

- `allowed`：已解析出出口国家/地区，且它**不在**阻断清单里。这是黑名单而不是白名单：其他所有国家/地区都放行。
- `blocked`：已解析出出口国家/地区，且在阻断清单里（默认 `CN`）。
- `unknown`：无法得出结论。对 Claude 来说，这与 `blocked` **完全等同**。

非 Claude 模型永远不受影响，包括判定为 `unknown` 的时候。

**什么算 Claude。** provider route 是 `claude` 或 `anthropic`（或以 `claude/`、`anthropic/` 开头），或者模型名以 `claude`、`anthropic` 开头。两个字段都要看，因为订阅插件把 Claude 路由在它自己的 provider id 下，而 API key 路由用的是 `anthropic`。

**看谁的网络。** 依据的是 **DSH 主机**，不是浏览器所在设备；经 SSH 隧道访问 GUI 时这一点很重要。host 通过两个互为备份的 HTTPS IP 归属服务解析出口国家/地区：先用主服务，任何失败（传输、超时、非 2xx、响应无法解析）都切换到备用服务。只有两者都失败，判定才是 `unknown`。自动判定从不访问 Anthropic、Cloudflare 或任何目标模型的诊断端点。

**两层拦截。**

- *Host（权威层）。* 在 `llm/stream` waterfall 上注册监听器，注册在根 context 上，所以 headless 组合也被覆盖；凡是判定不是 `allowed` 的 Claude 系列调用一律拒绝。它抛出一个稳定的错误（`dsh-home-network-model-guard: Claude egress is restricted (<verdict>)`），且绝不调用 `next()`，请求不会到达 provider。这覆盖 CLI、subagent 以及任何绕过输入框的路径。每次拒绝在主机侧留下一行去重后的日志，只含判定分类和降级原因（`refused Claude egress -> <verdict> (<reason>)`），不含 IP、端点、响应体或凭据。
- *Web（提前提示）。* Web 半区通过官方 `conversation.blocks` 槽位禁用输入框，并显示原因（“当前出口位于受限地区，已禁用 Claude 发送”）。它自己的判定起始值是 `unknown`，所以在 host 的第一个答复到达之前 Claude 就是被拦截的。RPC 失败或返回错误会把它重新置为 `unknown`。它在启动时、页面重新可见时（节流 10 秒）重新查询，在尚未收到成功答复期间每 5 秒查询一次。

**故障转移与重试。**

- 每个 Geo 端点有**各自独立**的超时预算（`timeoutMs`，默认 5 秒）。慢的或挂起的主端点无法耗尽备用端点的机会，所以一次完整判定最坏约 `2 × timeoutMs`。
- 在单个端点的预算内，瞬时失败（传输错误或非 2xx）固定停顿 150 毫秒后至多重试 1 次。超时和确定性的坏响应体不重试。
- 失败的判定永不缓存。它得到 `unknown`，下一次尝试按指数退避推迟：从 2 秒翻倍直到 60 秒，到达上限后保持该间隔，直到服务恢复。缓存不会永久停留在降级态。

**缓存。** 一个新鲜的判定在三个条件同时成立时被复用：存在时间小于 `ttlMs`（默认 5 分钟）；本机网络指纹未变（非内部 IPv4 地址排序后的集合，所以重连或 DHCP 变化立即失效）；配置代际未变（配置文件的修改时间）。指纹或配置代际变化还会绕过退避窗口。并发请求共用同一次进行中的查询。

**与官方拦截共存。** 如果官方的模型选择插件已经拦截了输入框（`routable === false`），守卫让位、什么都不写。它只清除自己写入的 block。它监视 block 槽位，如果自己的 block 在仍需要时被清掉或被覆盖，会防抖后重新断言一次。没有已加载选择的会话不会被写入槽位。

**设置页。** **Egress Guard** 章节（order 290）显示当前判定、解析出的国家/地区、哪个服务给出了答复（主或备）以及降级原因，也可以编辑阻断清单和两个端点。这个视图只用于诊断：它自己不会修改配置，也绝不会把观察到的出口自动加入放行。

## 配置

配置放在主机本地，不在仓库里：

```text
$DSH_HOME/plugins/dsh-home-network-model-guard/config.json
```

（未设置 `DSH_HOME` 时回落到用户主目录。）所有字段都是可选的：

| 字段 | 默认值 | 规则 |
|---|---|---|
| `blockedCountries` | `["CN"]` | 1 到 64 个两位大写 ISO alpha-2 码；重复项会去掉 |
| `geoEndpoints` | `["https://ipinfo.io/json", "https://ipwho.is/"]` | 恰好 `[主, 备]`；不含凭据的 HTTPS URL，至多 512 字符；国家码从 `country`、`countryCode` 或 `country_code` 读取 |
| `timeoutMs` | `5000` | 正数；**每个**端点的预算，而不是整次判定的预算 |
| `ttlMs` | `300000` | 正数；判定缓存的有效期 |
| `backoffBaseMs` | `2000` | 正数；失败后的首次重试间隔 |
| `backoffMaxMs` | `60000` | 正数；不得小于 `backoffBaseMs` |

- 写入会经过校验并且是原子的（文件权限仅属主可访问，`0600`；目录 `0700`）。名字像凭据的字段（password、secret、token、credential、private key、API key）、非 HTTPS 端点、URL 内嵌账号信息，都会被**拒绝**；守卫只接受国家码、端点 URL 和非秘密的调参值。
- 写入会改变配置代际，使已缓存的判定失效。阻断清单和端点每次判定都会重新读取；`timeoutMs`、`ttlMs`、`backoffBaseMs`、`backoffMaxMs` 在插件加载时读取（代码只在挂载时读一次），所以改动它们需要重启。
- 设置页只编辑 `blockedCountries` 和 `geoEndpoints`；调参字段要在文件里改。
- **文件缺失、无法读取或不合法，一律回落到完整的默认值**（阻断清单 `CN`），Claude 保持 fail-closed。

## 边界与安全

- **fail-closed 概括。** 对 Claude 而言，已解析为阻断地区，以及未能得出结论（两个服务都不可用、响应无法解析、变化尚未确认、RPC 不可用、判定出错），都会禁止发送。非 Claude 永远不会被本守卫拒绝。唯一的出路是：解析出 `allowed`、切换到非 Claude 模型，或在 manifest 中禁用本插件。
- **网络。** 只有 host 半区会对外发请求，且只发给配置里声明的两个 Geo 服务（它们能看到主机的公网 IP，因此可能会记录）。不访问 Anthropic 或 Cloudflare 的诊断端点。浏览器自己从不做任何查询。
- **暴露了什么。** RPC 通道 `/dsh-home-network-model-guard`（`check`、`status`、`set-config`）经 Connection 层的 host 围栏提供服务；本部署没有配置 `trustedHosts`，所以只限 loopback。`check` 返回分类、新鲜度和粗粒度的降级码（`fetch-failed`、`timeout`、`invalid-response`）。`status` 额外给设置页返回解析出的国家/地区、答复的服务和当前配置（其中包含已配置的端点）。原始 IP 永不落盘、不进日志、不返回，也不保存会话文本或凭据。
- **Web 半区的临时补偿。** Web 半区还会注入 `[data-input-scroll] > div{min-height:24px}`（`src/client/index.ts` 中的 `COMPOSER_FALLBACK_CSS`）。运行体把输入框从原生 `<textarea>` 迁到 Lexical contenteditable 时（在 0.1.2-rc.1 上观察到），删掉了撑起内容区高度的隐藏 mirror。拦截生效且草稿为空时，内容区高度塌成零，溢出被裁掉，原因文案就看不见了。这条规则是一个一行的下界，锚定在稳定的 `data-*` 属性上并作用于内容包裹层，所以已有高度的状态不受影响。一旦运行体重新为非 hero 的输入框保证最小高度，就**应删除它**，并确认“拦截生效 + 空草稿”仍能显示原因。官方模型选择在 `routable === false` 拦截时同样会塌，这个下界无条件生效，也覆盖那种情况。

## 开发

在仓库根目录运行：

```sh
npm run typecheck --workspace dsh-home-network-model-guard   # host + client 双项目
npm test --workspace dsh-home-network-model-guard            # 判定 / 缓存 / failover / 配置 / 门禁 / 共存
npm run build --workspace dsh-home-network-model-guard       # host tsc + client tsdown
```

重启 DSH 后生效。每次 DSH 升级后，都要回归 `conversation.blocks` 的并存语义和 `llm/stream` 门禁。
