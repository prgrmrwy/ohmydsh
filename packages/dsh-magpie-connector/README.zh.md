# dsh-magpie-connector

[English](README.md) · 简体中文

<p align="center">
  <img src="docs/model-picker.png" alt="模型选择器：按上游 provider 分组为 Magpie (Claude)、Magpie (GPT)、Magpie (deepseek)" width="49%">
  <img src="docs/settings.png" alt="设置页：顶部连接线路，下方按 provider 分组的模型可见性、默认 effort 与用量卡片" width="49%">
</p>

*左：按上游 provider 分组的模型选择器；右：设置 → Magpie，顶部连接线路，下方按 provider 分组的模型可见性、默认 effort 与用量卡片。截图来自隔离 DSH 宿主与本地 mock Magpie 网关，模型和账号均为演示数据。*

![Magpie connector 架构：Web GUI 与 Host 插件、凭据与设置、Magpie 网关与上游 provider，可选经 Cloudflare Access](docs/architecture.zh.svg)

<!-- problem -->
**把自托管的 Magpie 网关接入 DeepSeek Harness，每个上游归属对应一个 provider route：原版 DSH 即按上游 provider 分组展示模型，附带只读用量卡片和会话级快速档。** Magpie 继续负责登录、账号、路由和厂商出站代理，本插件补齐 DSH 侧。

### 你会得到什么

| 能力 | 具体行为 |
|---|---|
| **Magpie 网关接入**（基础） | 每条线路只需地址和该线路的 key。模型目录来自网关 `GET /models`；支持 Responses 的模型走 Responses，其余走 Chat Completions。文本、工具往返、图片、usage、取消以及 DSH 统一重试都能正常工作。 |
| **保存前检查线路**（0.4.0） | 每条线路卡片有「检查线路」：用当前填写的地址、接入方式与 key 发一次真实 `GET /models`（凭据留空则用该线路已保存的值），显示结果分类、耗时、模型数量，以及在宿主有缓存目录时与缓存相比多出/缺少的模型。它不改当前线路、不写凭据或设置、不触发目录同步，只是只读快照；差异基准是**缓存目录**，所以不会宣称「与当前线路一致」。 |
| **多线路自动切换**（特色） | 通常一条线路（首次安装为空，最多 5 条），可添加备用线路并按序号自动选择：每次操作前对候选地址做 ≤600ms 的 TCP 可达探测（正缓存 10s / 负缓存 15s，不后台轮询），在家走局域网、在外自动落到公网。切换线路时模型目录继承不闪断、用量卡片清空并按新线路重读；单线路（通常一条）行为与旧版一致。 |
| **按上游 provider 分组**（特色） | 原版 DSH 即可使用，无需 Host 扩展：插件按网关 `owned_by` 为每个归属注册一个真实 provider route（`dsh-magpie-connector-claude`、`-codex`、`-opencode-go` 等；缺失或不合法归入 `-other`），官方模型选择器因此显示 `Magpie (Claude)`、`Magpie (Codex)`、`Magpie (Opencode-go)`、`Magpie (Other)` 分组。设置页和用量卡片使用同一套分组，只出现在用量里的 provider 也不会被丢弃。 |
| **按线路的 Cloudflare Access** | 每条线路可单独选择「直连」或「Cloudflare Access」。启用后该线路的请求带上服务令牌两项并保留 bearer key；服务令牌永远不会发往明文 HTTP 线路。 |
| **只读用量卡片** | 每个上游账号展示计划、到期时间、各窗口读数和 Codex 重置次数（网关提供时）。打开设置页只读一次，之后只有点单张卡片的「刷新」才会重新读取；用量条超过 70% 变橙、达到 90% 变红。 |
| **模型可见性与默认 effort** | 每个 provider 不设置可见性时跟随网关目录；保存过选择后只显示勾选项，新上架模型默认隐藏。每个模型可保存一个默认推理 effort，DSH 在下一次请求应用。 |
| **会话级快速档** | 网关声明 `priority` 服务档的模型，输入框旁会出现标准/快速切换。选择按会话保存在 host 内存，快速档会给请求带上 `service_tier: "priority"`。 |

### 安装

```sh
dsh plugin --profile web add dsh-magpie-connector
```

重启 DSH 并刷新页面。在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh) 中也可以直接启用 local `dsh-magpie-connector` manifest 条目后重新构建。已验证 DSH `0.2.0-rc.2`、Web UI、Node.js `>=22.19`。

> **0.3.0 BREAKING 升级**：旧的单一 route `dsh-magpie-connector` 已退役。保存在它上面的会话与默认模型不再可用，请在 `Magpie (…)` 分组中重选模型。其它依赖精确 route id 的配置（例如子任务路由、出口豁免列表）需改成新的 `dsh-magpie-connector-<owner>`。

### 配置

打开 **设置 → Magpie**。

1. 在**线路 1** 里填写**包含 `/v1`** 的网关 API 地址，例如 `http://192.168.1.20:3425/v1`，以及这条线路的 gateway key。地址、线路列表、可见性与默认 effort 保存在 `$DSH_HOME/plugins/dsh-magpie-connector/settings.json` —— key/Access 不会写入该文件，也不会被设置接口返回。
2. 需要多条线路时点「添加备用线路」，每条线路填写自己的地址与 key；用「上移/下移」调整优先级（序号 1 优先）。保存后打开设置页默认只展开当前生效线路，序号后的 4×4 绿色方块表示当前线路；点击 info 图标可查看优先级与自动回退说明。
3. 每条线路的**高级连接**里选择「直连」或「Cloudflare Access」。局域网与 Tailscale 都属于直连；Cloudflare Access 需要 HTTPS 线路，从 Access 切回直连并保存会清除该线路的两项 Access 凭据。Cloudflare 免费/Pro 套餐在源站 100 秒内没有响应时会返回 524。
4. 保存会同步模型目录；「刷新模型列表」可再次同步，插件不会定时轮询目录。

> **0.2.0 BREAKING 升级**：设置格式改为单一 `lines[]`，旧版单地址 `settings.json`（只有 `baseUrl`）与旧固定凭据引用（`MAGPIE_API_KEY` / `MAGPIE_ACCESS_*`）**不会被读取或迁移**，升级后需在设置页重新添加线路并填写每线路 key/Access。模型可见性与默认 effort 会保留；旧凭据记录可由你在 DSH credentials 中手动删除。升级前若要保留回滚能力，请备份 `settings.json` 与旧凭据引用。

还需要别的接入方式（自定义请求头、mTLS、其它零信任网关）？**欢迎提 issue 或 PR**，说明你的部署方式和网关版本。

### 在哪里操作

| 位置 | 做什么 |
|---|---|
| **模型选择器** | 统一搜索覆盖分组标题、型号名和完整 id。每个分组是一个真实 route `dsh-magpie-connector-<owner>`；model id 保持网关完整 id，可见性键和默认 effort 不变。 |
| **模型菜单分组** | `owned_by`（转小写，1–48 个 `a-z0-9._-` 字符）决定 route 和标题 `Magpie (<Owner>)`（首字母大写）。缺失或不合法时归入 `Magpie (Other)`，不按模型名猜测。见过的归属记在 `settings.json` 的 `knownOwners`（最多 32 个），重启后 route 立即存在，首次目录同步完成后模型才出现。归属下架后其 route 保留（空组自动隐藏）。手动清空 `knownOwners` 会让保存在被移除 route 上的选择失效。启动时若 route 注册失败（例如被别的插件占用），设置页会显示错误，排除后需重启 DSH。 |
| **输入框速度控件** | 仅当前模型被网关声明为 `priority` 档时显示（当前 Magpie 上即 Codex/GPT 模型），切换模型后立即更新。悬停模型菜单可看 effort；官方选择器只显示一个 effort 值。 |
| **设置 → Magpie** | 连接、接入方式、按 provider 分组的模型区（可见性复选框与默认 effort 选择器），以及该 provider 的用量卡片；每条线路卡片还有「检查线路」只读快照与「未配置」标记，保存结果只陈述当时的生效线路。 |
| **用量卡片刷新** | 每张卡片有独立的「刷新」，请求 Magpie 重新读取这一个账号。网关冷启动可能没有任何卡片；此时连接面板提供「获取模型与用量」，先同步模型目录，再请 Magpie 读取全部账号一次。受限 held key 无法初始化空缓存，需要管理员先在 Magpie 中读取一次。 |

### 需要知道的行为

- **失败交给 DSH 重试，插件不重放请求。** 适配器声明与 `dsh-plugin-subscriptions` 相同的 `llm-retry` 策略（最多 10 次，1 秒起指数退避至 60 秒，±20% 抖动，429 时遵守 `Retry-After`）。`TIMEOUT`、`TRANSPORT`、`SERVER`、`RATE_LIMIT`、`EMPTY_RESPONSE` 会重试；401/403、额度用尽、上下文超限与其它 4xx 不重试。
- **默认输出预算为上下文压缩预留空间。** 网关的 `max_output_tokens` 是模型能力上限，不直接作为每次请求的默认预算。交给 DSH 的默认预算是 `min(能力上限, max(1, 窗口/4, 窗口/2 − 65536))`，给 DSH 的上下文压缩留出空间；显式设置的 `maxTokens` 不受影响。上下文窗口小于 104,026 token 的模型仍按同一公式计算，但不保证通过 DSH 的压缩检查。
- **只有持续静默才会结束流。** 响应头、SSE 事件和心跳都算有数据；连续 300 秒没有任何数据才以 `TIMEOUT` 结束（消息含 `MAGPIE_STREAM_TIMEOUT`）。只要网关还在发心跳，长时间推理不会被截断。
- **自动选线不会重放请求。** 每次操作开始前按序号做 TCP 可达探测并选线路；连接阶段失败只使该线路缓存失效、本次操作失败，下一次操作重新选择。生成请求从不被插件换线或重放，其它失败交给 DSH 重试策略。
- **切换线路与编辑线路语义不同。** 自动切换保留模型目录（不闪断）、清空用量卡片并以新线路重同步；编辑生效线路的地址/key/接入方式才会按换代清空目录；编辑非生效线路不影响当前目录。
- **更改连接不会中止正在进行的生成。** 新地址或新 key 会立即隐藏旧目录与旧卡片，但已 prepare 或正在运行的生成会用捕获到的旧地址与 key 跑完。用户取消与插件卸载仍会中止它们。
- **传输边界刻意收窄。** host 请求经私有 `undici` dispatcher 直连配置的网关，不经过全局代理 dispatcher；拒绝重定向；只允许 `GET /models`、`POST /responses`、`POST /chat/completions`、`GET /magpie/quotas/cards`、`POST /magpie/quotas/refresh`；从不调用 Magpie GUI 的 `/api/*` 管理接口。厂商出站代理在 Magpie 侧配置。
- **不支持：** 非空 `stop` 序列会在发请求前失败（`MAGPIE_STOP_UNSUPPORTED`），因为 Magpie 无法在所有上游协议转换中保留 stop。用量卡片与 Codex 重置次数只读展示，插件不会调用账号管理或重置端点。
- **密钥不会进入响应或日志。** 网关反射的文本在进入设置接口或日志之前会用当前 key 脱敏。写盘文件权限 `0600`；设置接口只报告 `configured` / `writable`。

### 代码导览

入口：[index.ts](src/index.ts)。适配器与请求/流映射：[adapter.ts](src/host/adapter.ts)。路由：[routes.ts](src/host/routes.ts)。传输白名单：[transport.ts](src/host/transport.ts)。设置页：[SettingsPage.ts](src/client/SettingsPage.ts)。不含凭据的图源与仓库证据：[architecture.zh.json](docs/architecture.zh.json)。

### 开发

在本仓库的独立检出中：

```sh
npm install
npm run typecheck
npm test
npm run build
```

在 ohmydsh monorepo 里，在仓库根目录安装一次，后三条命令加上 `--workspace=dsh-magpie-connector`。测试使用本机 mock 网关和真实线协议库，不需要真实 key。构建产物不入库；`prepare` 与 `prepack` 都会执行 build。

## 移除
<!-- section: removal -->

```sh
dsh plugin --profile web remove dsh-magpie-connector
```

重启 DSH 并刷新页面。dispose 只释放注册、计时器与连接，不删除凭据和设置。需要彻底清理时，通过 DSH credentials 管理删除各线路的 `MAGPIE_LINE_<ID>_*` 凭据（以及升级前遗留的 `MAGPIE_API_KEY` / `MAGPIE_ACCESS_*`），并在确认安装版本的数据目录后删除插件设置文件。如果其它集成仍在使用某个凭据，不要删除。

在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh) 中则把 manifest 条目设为 `enabled: false` 后重新构建。

## 来源、许可与参与

本插件在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh)（`packages/dsh-magpie-connector`）中持续开发，[本仓库](https://github.com/prgrmrwy/dsh-magpie-connector)是发布镜像，自动发布到 [npm](https://www.npmjs.com/package/dsh-magpie-connector) 与 [GitHub Releases](https://github.com/prgrmrwy/dsh-magpie-connector/releases)。当前行为见规范 [`openspec/specs/dsh-magpie-connector`](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/dsh-magpie-connector/spec.md)。

采用 [MIT](LICENSE) 许可。`@earendil-works/pi-ai` 与 `undici` 是分别以 MIT 许可分发的依赖；鸟形图标来源与许可见 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES)。欢迎到 [prgrmrwy/dsh-magpie-connector](https://github.com/prgrmrwy/dsh-magpie-connector/issues) 提 issue 和 PR。
