# dsh-magpie-connector

[English](README.md) · 简体中文

<p align="center">
  <img src="docs/model-picker.gif" alt="模型选择器：按上游 provider 分组，仅 GPT 显示标准/快速" width="49%">
  <img src="docs/settings.gif" alt="设置页：连接、Cloudflare Access、分组配置与用量卡片" width="49%">
</p>

*左：模型选择器；右：设置 → Magpie。录屏来自隔离 DSH 宿主与本地 mock Magpie 网关，模型和账号均为演示数据。*

[插件仓库](https://github.com/prgrmrwy/dsh-magpie-connector) · [版本发布](https://github.com/prgrmrwy/dsh-magpie-connector/releases) · [npm](https://www.npmjs.com/package/dsh-magpie-connector)

<!-- problem -->
**把自托管的 Magpie 网关作为一个 provider route 接入 DeepSeek Harness：模型按上游 provider 分组展示，附带只读用量卡片和会话级快速档。** Magpie 继续负责登录、账号、路由和厂商出站代理，本插件补齐 DSH 侧。

### 你会得到什么

| 能力 | 具体行为 |
|---|---|
| **Magpie 网关直连**（基础） | 只需网关地址和 key。模型目录来自网关 `GET /models`；支持 Responses 的模型走 Responses，其余走 Chat Completions。文本、工具往返、图片、usage、取消以及 DSH 统一重试都能正常工作。 |
| **按上游 provider 分组**（特色） | 模型选择器显示 `Magpie (Claude)`、`Magpie (GPT)`、`Magpie (<其它归属>)` 等标题，真实 route 始终只有一个 `dsh-magpie-connector`。设置页和用量卡片使用同一套分组，只出现在用量里的 provider 也不会被丢弃。 |
| **Cloudflare Access 远程连接** | 网关在 Cloudflare Tunnel + Access 之后、客户端不方便装 VPN 时，保存服务令牌的 Client ID 和 Secret。此后每个网关请求都会带上 `CF-Access-Client-Id` / `CF-Access-Client-Secret`，同时保留 bearer key；仅支持 HTTPS。 |
| **只读用量卡片** | 每个上游账号展示计划、到期时间、各窗口读数和 Codex 重置次数（网关提供时）。打开设置页只读一次，之后只有点单张卡片的「刷新」才会重新读取；用量条超过 70% 变橙、达到 90% 变红。 |
| **模型可见性与默认 effort** | 每个 provider 不设置可见性时跟随网关目录；保存过选择后只显示勾选项，新上架模型默认隐藏。每个模型可保存一个默认推理 effort，DSH 在下一次请求应用。 |
| **会话级快速档** | 网关声明 `priority` 服务档的模型，输入框旁会出现标准/快速切换。选择按会话保存在 host 内存，快速档会给请求带上 `service_tier: "priority"`。 |

### 安装

```sh
dsh plugin --profile web add dsh-magpie-connector
```

重启 DSH 并刷新页面。在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh) 中也可以直接启用 local `dsh-magpie-connector` manifest 条目后重新构建。已验证 DSH `0.2.0-rc.2`、Web UI、Node.js `>=22.19`。

模型选择器的分组标题依赖 ohmydsh 的 Pet 兼容层为 reviewed `0.2.0-rc.2` pin 构建的受管五包 Host 扩展。stock rc.2 仍可正常使用 route 与生成，但 provider 内列表保持 flat。

### 配置

打开 **设置 → Magpie**。

1. 填写**包含 `/v1`** 的网关 API 地址，例如 `http://192.168.1.20:3425/v1`。
2. 填写 gateway key。它通过 DSH credentials 以 `MAGPIE_API_KEY` 保存；来自启动环境的 key 在这里只读。地址、可见性与默认 effort 保存在 `$DSH_HOME/plugins/dsh-magpie-connector/settings.json` —— key 不会写入该文件，也不会被设置接口返回。
3. 保存。保存连接会同步模型目录；「刷新模型列表」可再次同步，插件不会定时轮询目录。

**高级连接**（默认展开）决定如何到达网关：

- **直连**（默认）—— 网关地址可直接访问。局域网和 Tailscale 都属于这种：客户端加入 tailnet 后填 `http://<主机>.<tailnet>.ts.net:3425/v1` 或子网路由地址即可，插件里没有额外配置。
- **Cloudflare Access** —— 网关在 Cloudflare Tunnel + Access 之后、客户端不方便装 VPN 时使用。填写服务令牌两项；每个请求同时携带两项头和 bearer key。从 Cloudflare Access 切回直连并保存会清除已保存的 Access 凭据。Cloudflare 免费/Pro 套餐在源站 100 秒内没有响应时会返回 524。

还需要别的接入方式（自定义请求头、mTLS、其它零信任网关）？**欢迎提 issue 或 PR**，说明你的部署方式和网关版本。

### 在哪里操作

| 位置 | 做什么 |
|---|---|
| **模型选择器** | 统一搜索覆盖分组标题、型号名和完整 id。标题来自网关的 `owned_by`；每项背后的 route 仍然是 `dsh-magpie-connector`，model id、可见性键和默认 effort 都不变。 |
| **模型菜单分组** | `owned_by` 非空的模型显示在 `Magpie (<owner>)` 下，`claude`、`codex` 分别显示为 Claude 和 GPT。缺失归属时显示 `Magpie (Other)`，不按模型名猜测。 |
| **输入框速度控件** | 仅当前模型被网关声明为 `priority` 档时显示（当前 Magpie 上即 Codex/GPT 模型），切换模型后立即更新。悬停模型菜单可看 effort；官方选择器只显示一个 effort 值。 |
| **设置 → Magpie** | 连接、接入方式、按 provider 分组的模型区（可见性复选框与默认 effort 选择器），以及该 provider 的用量卡片。 |
| **用量卡片刷新** | 每张卡片有独立的「刷新」，请求 Magpie 重新读取这一个账号。网关冷启动可能没有任何卡片；此时连接面板提供「获取模型与用量」，先同步模型目录，再请 Magpie 读取全部账号一次。受限 held key 无法初始化空缓存，需要管理员先在 Magpie 中读取一次。 |

### 需要知道的行为

- **失败交给 DSH 重试，插件不重放请求。** 适配器声明与 `dsh-plugin-subscriptions` 相同的 `llm-retry` 策略（最多 10 次，1 秒起指数退避至 60 秒，±20% 抖动，429 时遵守 `Retry-After`）。`TIMEOUT`、`TRANSPORT`、`SERVER`、`RATE_LIMIT`、`EMPTY_RESPONSE` 会重试；401/403、额度用尽、上下文超限与其它 4xx 不重试。
- **只有持续静默才会结束流。** 响应头、SSE 事件和心跳都算有数据；连续 300 秒没有任何数据才以 `TIMEOUT` 结束（消息含 `MAGPIE_STREAM_TIMEOUT`）。只要网关还在发心跳，长时间推理不会被截断。
- **更改连接不会中止正在进行的生成。** 新地址或新 key 会立即隐藏旧目录与旧卡片，但已 prepare 或正在运行的生成会用捕获到的旧地址与 key 跑完。用户取消与插件卸载仍会中止它们。
- **传输边界刻意收窄。** host 请求经私有 `undici` dispatcher 直连配置的网关，不经过全局代理 dispatcher；拒绝重定向；只允许 `GET /models`、`POST /responses`、`POST /chat/completions`、`GET /magpie/quotas/cards`、`POST /magpie/quotas/refresh`；从不调用 Magpie GUI 的 `/api/*` 管理接口。厂商出站代理在 Magpie 侧配置。
- **不支持：** 非空 `stop` 序列会在发请求前失败（`MAGPIE_STOP_UNSUPPORTED`），因为 Magpie 无法在所有上游协议转换中保留 stop。用量卡片与 Codex 重置次数只读展示，插件不会调用账号管理或重置端点。
- **密钥不会进入响应或日志。** 网关反射的文本在进入设置接口或日志之前会用当前 key 脱敏。写盘文件权限 `0600`；设置接口只报告 `configured` / `writable`。

### 架构

![Magpie connector 架构：Web GUI 与 Host 插件、凭据与设置、Magpie 网关与上游 provider，可选经 Cloudflare Access](docs/architecture.zh.svg)

入口：[index.ts](src/index.ts)。适配器与请求/流映射：[adapter.ts](src/host/adapter.ts)。路由：[routes.ts](src/host/routes.ts)。传输白名单：[transport.ts](src/host/transport.ts)。设置页：[SettingsPage.ts](src/client/SettingsPage.ts)。不含凭据的图源与仓库证据：[architecture.zh.json](docs/architecture.zh.json)。

### 开发

```sh
npm install
npm test --workspace=dsh-magpie-connector
npm run typecheck --workspace=dsh-magpie-connector
npm run build --workspace=dsh-magpie-connector
```

测试使用本机 mock 网关和真实线协议库，不需要真实 key。构建产物不入库；`prepare` 与 `prepack` 都会执行 build。

## 移除
<!-- section: removal -->

```sh
dsh plugin --profile web remove dsh-magpie-connector
```

重启 DSH 并刷新页面。dispose 只释放注册、计时器与连接，不删除凭据和设置。需要彻底清理时，通过 DSH credentials 管理删除 `MAGPIE_API_KEY`，并在确认安装版本的数据目录后删除插件设置文件。如果其它集成仍在使用该凭据，不要删除。

在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh) 中则把 manifest 条目设为 `enabled: false` 后重新构建。

## 许可

MIT。`@earendil-works/pi-ai` 与 `undici` 是分别以 MIT 许可分发的依赖；鸟形图标来源与许可见 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES)。
