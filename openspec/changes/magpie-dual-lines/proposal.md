## Why

`dsh-magpie-connector` 现在只能配置一个网关地址和一套全局 Cloudflare Access 凭据，而 Magpie 实际有两条接入路径：家里局域网直连（http、无 Access）和经 Cloudflare Tunnel 的公网入口（https + Access 服务令牌 + 专用 gateway key）。会移动的 DSH Host 在「家 / 工区」之间每次都要手工改地址、切接入方式、清或重填 Access 凭据；每次改地址都会换代、清空模型目录与用量卡片。在家继续绕 Cloudflare 还有额外代价：边缘 125 秒级超时（BACKLOG D014、[排查记录](../../../packages/dsh-magpie-connector/docs/cloudflare-524-long-requests.md)）与额外的建连时延。

本 change 明确采用**单一设置格式、不保留旧格式兼容**：恒为 `lines[]`，旧版单地址 `settings.json` 与旧凭据引用不再读取；升级后用户重新配置一次。这样插件里只有一种 schema、一种凭据命名与一套校验路径。

## What Changes

- **BREAKING（设置格式与凭据引用）**：设置从顶层 `baseUrl` 改为**唯一格式**「线路列表」：通常 1 条、上限 5 条（首次安装为空列表，添加第一条后正常使用），每条线路 = 地址 + 该线路自己的 gateway key + 接入方式与 Access 凭据；数组顺序即序号，序号即自动选择优先级。**不读取旧 `settings.json`**（缺 `lines` 视为空配置），**不读取**旧 `MAGPIE_API_KEY` / `MAGPIE_ACCESS_*` 引用，升级后需在设置页重新添加线路并填写 key/Access。
- 线路 id 由 host 在创建时生成：**8 位随机 hex**（如 `a1b2c3d4`），只存于 settings，不展示在 UI（UI 只显示序号）；id 稳定、不随地址/key/排序/删除变化，也不从可变内容派生。
- 凭据引用统一由线路 id 决定：所有线路（无特例）使用 `MAGPIE_LINE_<ID>_API_KEY`、`MAGPIE_LINE_<ID>_ACCESS_CLIENT_ID`、`MAGPIE_LINE_<ID>_ACCESS_CLIENT_SECRET`（`<ID>` 为大写 id）。排序/删除/重启不改变剩余线路的引用；删除线路时清除其可写凭据，环境提供的凭据保留并通过 `retainedCredentials` 报告。
- 新增自动选择：每次操作开始时按序号对候选线路做 TCP 可达探测（单条截止 ≤600ms、正/负内存缓存、不新增后台轮询），第一个可达的完整线路生效；单线路不探测；全部不可达时用序号 1 发起真实请求，让错误如实上抛。
- 新增线路切换语义：切换保留当前模型目录（不闪断）、清空用量卡片并以新线路重同步；只有生效线路的连接配置变化才清目录；不假设不同线路的 key 看到相同模型目录，目录以当前生效线路为准。
- 插件**不为生成请求换线或重放**：连接阶段失败只失效该线路探测缓存，本次操作失败，下一次操作重新选择；其它失败如实上抛，重试交给 DSH 既有策略。
- 设置页：默认只展开当前生效线路，其余折叠一行；生效线路序号后有 4×4 绿色方块作为唯一图形化 active 指示；`info` 图标 hover 说明优先级与自动回退；支持添加 / 删除 / 上移 / 下移线路。
- Cloudflare Access 按线路配置：启用 Access 的线路地址必须为 https；明文 http 线路永不携带 Access 头。
- 写入安全：删除线路、切回直连的凭据清理失败时不提交变更，pending 标记重启隔离并可完整重试，避免残留 orphan 秘密。
- 版本 0.2.0，CHANGELOG / README 标注 BREAKING 升级步骤。

**不在本期范围**：手动选择 / 强制指定线路（低频，design 记为 Non-goal 并预留扩展点）；生成请求的透明换线/重放；家庭侧 Cloudflare 524 保活中继（属 home-substore，正交）；旧格式迁移（有意不做）。

## Capabilities

### New Capabilities
- `magpie-line-selection`：线路列表与优先级、稳定随机 id、生效线路与自动探测选择、探测缓存、失败不重放、设置页 active 展示与静默规则。

### Modified Capabilities
- `dsh-magpie-connector`：网关连接与凭据（单地址 + 单 key → 线路列表 + 按线路凭据）、连接接入方式（全局 → 按线路）、连接身份与代际隔离（身份 = 生效线路指纹；线路切换与配置编辑各自的目录/卡片语义）、只读与传输边界（按生效线路 origin、Access 按线路、TCP 探测例外）、插件身份与命名（单一随机 id ↔ 派生凭据引用）、目录同步与发布（resync/线路切换同步语义）；新增设置写入的凭据隔离/失败恢复、pending 恢复与旧格式升级（BREAKING）三个 requirement。
- `magpie-access-auth`：Access 从「所有网关请求都带」改为「按线路启用，只发往启用线路的 https 地址」；凭据保密与生命周期扩展到多线路。

## Impact

- 代码：`packages/dsh-magpie-connector/src/host/{settings,runtime,transport,adapter,cards,routes}.ts`、`src/index.ts`（凭据事件订阅按 ref→lineId 映射）与 `src/client/{SettingsPage,view-model,api,styles}.ts`；无新依赖（探测使用 `node:net`，id 使用 `node:crypto` 的随机字节）。
- 测试：新增线路列表、随机 id/凭据绑定、探测缓存、切换、按线路 Access、pending 恢复用例；既有 connection、transport、access、identity 用例改写为 `lines[]` 夹具后回归。
- 发布资产：`package.json` / `dsh.yaml` 版本与 note；包内 README 双语（含 BREAKING 升级与重配步骤）、CHANGELOG、`docs/architecture.{zh,en}.{json,svg}`、`screenshots.json`、`docs/SCREENSHOTS.md`、`docs/internal-api.md`；根 README 双语插件能力描述。
- 基础设施：无。Cloudflare 入口、Magpie、凭据分发均不变；不新增网络依赖。
- 安全：Access 服务令牌永不发往明文 http；探测不带凭据；脱敏集合覆盖所有现存线路 key / Access；删除线路只清可写凭据且失败不提交；生成请求不换线不重放。
- 升级影响：本 change 不迁移旧配置；旧 `settings.json` 与旧凭据引用会被忽略并在 CHANGELOG/README 提示重配。
