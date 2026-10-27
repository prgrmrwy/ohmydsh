# dsh-magpie

[English](README.md) · 简体中文

连接自托管 Magpie 网关的 DeepSeek Harness 插件。只注册一个 `dsh-magpie` route；设置页按上游 provider 展示模型和只读用量卡片。

<!-- problem -->
Magpie 管登录、账号、路由和厂商侧代理。本插件补齐 DSH 侧的模型可见性、默认推理 effort、缓存用量与手动刷新，以及支持 `priority` 模型的会话级标准/快速切换。网关 key 交给 DSH credentials 管理，不另写明文 key 文件。

## 前提

- DSH `0.2.0-rc.2`。
- 可访问的 Magpie 网关及启用的 gateway key。
- 远端连接需在 Magpie 启用局域网共享，或通过 `MAGPIE_ADDR` 监听非回环地址；仅监听 localhost 无法远端访问。
- 读取用量时，不受限 key 可直接使用；受限 held key 需有 Quotas 权限，且只看得到授权范围内的卡片。

## 安装与配置

在 ohmydsh manifest 中启用 local `dsh-magpie` 条目，build 后按需重启。当前尚未发布 npm 包，不要把包名视为已可安装的正式发行版。

打开 **设置 → Magpie**，填写带 `/v1` 的网关 API 地址，例如 `http://192.168.1.20:3425/v1`，以及 gateway key。不要将 key 放进 URL 或 manifest。保存连接会同步目录，之后可手动点「刷新模型列表」；不定时轮询目录。

key 通过 DSH credentials 以 `MAGPIE_API_KEY` 保存。若来自启动环境，设置页只读；外部修改环境变量需重启进程才能生效。地址与偏好单独保存在 `$DSH_HOME/plugins/dsh-magpie/settings.json`（默认 `$HOME/.dsh/plugins/dsh-magpie/settings.json`）中，该文件和设置响应均不含 key。

### 模型与推理

- provider 没有可见性选择时跟随目录，新模型自动出现。
- 一旦显式选择，严格按白名单显示；空白名单隐藏全部，新模型默认隐藏。
- 默认 effort 是 DSH 侧偏好。已保存档位若暂时不在目录中，保留记录但不生效，恢复后再次生效。
- 支持 Responses 的模型走 Responses，其余走 Chat Completions；线协议由 pi-ai 处理。
- 非空 `stop` 序列会在请求发出前报 `MAGPIE_STOP_UNSUPPORTED`，因为 Magpie 无法保证所有协议转换保留 stop。
- 失败交给 DSH 自带的 `llm-retry` 重试，策略与 dsh-plugin-subscriptions 相同：最多 10 次，1 秒起指数退避、上限 60 秒、±20% 抖动；429 带 `Retry-After` 时按它等待。插件本身不重放请求，只把失败归入标准错误码：超时 `TIMEOUT`、连接中断 `TRANSPORT`、5xx `SERVER`、429 `RATE_LIMIT`、空回复 `EMPTY_RESPONSE` 会重试；401/403、额度用尽、上下文超限、其它 4xx 不重试。
- 流式超时只看网关是否还在回数据：响应头、SSE 事件和心跳都算，连续 300 秒没有任何数据才以 `TIMEOUT`（消息含 `MAGPIE_STREAM_TIMEOUT`）结束。长时间推理只要网关在发心跳就不会被截断。
- 快速档按会话保存在内存，host 重启回到标准。priority 服务档可能消耗更多上游额度。

### 模型菜单分组与 effort

在 ohmydsh 中，这些菜单能力依赖 Pet 在 reviewed DSH `0.2.0-rc.2` pin 上的受管 Host 扩展，须一起重建五个包：`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-client-ui-model-selection`、`@deepseek-ai/dsh-client-ui-commands`。stock rc.2 仍可正常使用插件 route 与生成，但 provider 内列表保持 flat。

加载扩展后，模型菜单与 `/model` 按网关 `owned_by` 展示标题：`claude` 为 `Magpie (Claude)`、`codex` 为 `Magpie (GPT)`，其它非空归属原文展示，缺失时为 `Magpie (Other)`。统一搜索覆盖组标题、型号名与完整 id。展示 metadata 不改变真实 `dsh-magpie` route、model id、名字、可见性偏好键或默认 effort。

选择器使用官方单一 effort 值。默认 AUTO 在主 effort 改变时，经官方 `selectModel` 同步同一 provider/model，并允许保存全局默认值；MANUAL 不变，已绑定子实例不写主选择。Host 展示扩展只负责分组与搜索 metadata，不维护第二套 effort 文案。本地源码测试不代表已部署或完成 live GUI 验收。

### 用量与手动刷新

打开页面只读取 Magpie 已缓存的卡片，不主动向厂商读取。每张卡片有自己的「刷新」，只请求 Magpie 重新读取这一个账号；没有整页的批量刷新。Magpie 在节流期内可能返回旧读数；成功响应不代表真的重新读过。带 `asOf` 的卡片属于旧读数。

用量条按已用比例着色：70% 及以下蓝色，70% 以上、90% 以下橙色，90% 及以上红色。

网关冷启动可能没有卡片。此时连接面板会出现「获取模型与用量」：先刷新模型列表，再请求 Magpie 读取全部用量。不受限 key 可以这样初始化；受限 held key 无法从空缓存首次读取，需要管理员先在 Magpie 内读取一次，或使用不受限 key。不要为了掩盖空状态盲目扩大权限。

Codex 的重置次数和过期时间只读展示。本插件不调用 Magpie GUI 的账号管理或重置端点。

## 连接方式

默认只需填网关地址和 key。设置页的「高级连接」（默认展开）可以选择接入方式：

- **直连**（默认）：网关地址可以直接访问。局域网、Tailscale 都属于这种：客户端机器加入 tailnet 后，地址填 `http://<主机>.<tailnet>.ts.net:3425/v1` 或子网路由地址即可，插件里没有额外要填的。
- **Cloudflare Access**：网关放在 Cloudflare Tunnel + Access 之后、客户端又不方便装 VPN 时使用。填写 Access 服务令牌的 Client ID 和 Client Secret，插件会给每个网关请求带上 `CF-Access-Client-Id`/`CF-Access-Client-Secret`，同时保留 bearer key；仅支持 HTTPS。两项通过 DSH credentials 保存；切回「直连」并保存会清除它们。注意 Cloudflare 免费/Pro 套餐在源站 100 秒内没有返回响应时会报 524。

还需要别的接入方式（自定义请求头、mTLS、其它零信任网关等）？欢迎提 issue 或 PR，说明你的部署方式。

## 安全与网络

host 使用私有 undici dispatcher 直连配置的网关，不继承全局代理 dispatcher；拒绝重定向，并限制出站方法和路径。厂商出站代理在 Magpie 管理，插件没有代理配置。Tailscale 子网路由可达时，远端与局域网可使用同一网关地址。

更改连接身份后旧目录与卡片失效；已经 prepare 或正在运行的生成刻意继续使用捕获的旧地址、旧 key 跑完。用户取消和 dispose 仍会中止生成。网关会收到提示词、附件和 key，应只连接你信任的网关。

## 从 dsh-magpie-connect 迁移

1. 试用期间保留旧插件与显示名 shim。
2. 在本插件单独配置连接；不自动读取旧插件的 key 和偏好。
3. 旧会话手动切到 `dsh-magpie`。旧会话原来保存的 `dsh-magpie-connect` route 不会自动迁移。
4. 验证对话、工具往返、取消、快速档后，再在 manifest 禁用旧插件与 shim，build 并重启。试用阶段不删除旧条目或旧数据。

当前默认 AUTO 策略支持 `dsh-magpie` 与 `dsh-magpie-connect` 两个精确 transport，保留完整 model id、实时能力/effort cap 与父 captured allowlist，不把两者互为 alias。根会话 AUTO 且显式 legacy 时，两种 Magpie 预览均在 Jev 前拒绝；MANUAL 仍直接返回 `routed: false`，不判档、不写状态。此前已绑定子实例保持原 transport。网络守卫改动仍属独立范围。见 [AUTO 路由说明](<../auto-model-routing/README.zh.md#auto-自动选配默认策略>)。

## 开发

```sh
npm install
npm test --workspace=dsh-magpie
npm run typecheck --workspace=dsh-magpie
npm run build --workspace=dsh-magpie
```

测试使用本机 mock 网关和真实 pi-ai，不需真实 key。构建产物不入库；`prepare` 与 `prepack` 都执行 build。

## Removal

<!-- section: removal -->
在 manifest 设 `enabled: false`，build 并重启。dispose 只释放注册、计时器和连接，不删除 credentials 和设置。

需要彻底清理时，通过 DSH credentials 管理单独删除 `MAGPIE_API_KEY`，再确认安装版本实际使用的数据目录后删除插件设置文件。如果其它集成仍使用该 credential，不要删除。旧 connect 的数据独立存在，本插件不会清理它。

回滚时禁用本插件，按需重新启用旧 connect；历史会话可能需要手动重选模型。

## 许可

MIT。pi-ai 和 undici 分别按其 MIT 许可分发，详见依赖自身的许可声明。
