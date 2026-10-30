## MODIFIED Requirements

### Requirement: 只读与传输边界

插件对 Magpie 的每个网络 hop（可达性探测与线路检查除外，见下）SHALL 只落在当前生效线路地址的同一 origin 上，并且只使用以下方法和路径（相对该线路 API 根）：
- `GET /models`
- `POST /responses`
- `POST /chat/completions`
- `GET /magpie/quotas/cards`
- `POST /magpie/quotas/refresh`

插件 SHALL NOT 跟随 HTTP 重定向：收到 3xx 时以错误结束，不向重定向目标发送任何请求。插件 SHALL NOT 请求 Magpie GUI 的 `/api/*`，SHALL NOT 提供 Magpie 账号的登录、退出、添加或删除，SHALL NOT 修改 Magpie 配置。

Access 请求头 SHALL 只附加到启用 Cloudflare Access 且地址为 https 的生效线路。直连线路与任何明文 http 线路 SHALL NOT 携带 Access 头，也 SHALL NOT 因其它线路配置了 Access 而携带。相应线路的 gateway key 仍按线路使用 bearer 认证。

线路可达性探测是上述网络 hop 约束的第一个例外：它 MAY 连接任一参与自动选择的完整线路的 host:port，SHALL NOT 发送 HTTP 请求、SHALL NOT 携带任何凭据，也不受 origin / 白名单 / 重定向规则约束。

线路检查（见 `magpie-line-selection`）是上述 origin 约束的第二个例外，且只限于单次检查：它 MAY 向被检查线路经过校验的 API 根发送一次 `GET /models`，只使用该线路自己的 bearer key；仅当被检查线路启用 Cloudflare Access 且地址为 https 时附加该线路的 Access 头。它 SHALL NOT 请求其它路径或任何 `/api/*`、SHALL NOT 携带其它线路的凭据，也 SHALL NOT 因被检查线路不是生效线路而改变生效线路、触发目录同步或注册路由。不跟随重定向的规则对它同样适用：检查只向被检查线路发一次 `GET /models`，收到 3xx 后不再向重定向目标或其它路径发请求。

插件发往网关的请求 SHALL 使用插件自己的直连传输，不经过 DSH 按 `HTTP(S)_PROXY` 安装的全局代理 dispatcher。插件 SHALL NOT 提供插件级代理配置。

#### Scenario: 完整流程只触达白名单

- **GIVEN** 生效线路的网关 mock 记录收到的每个请求
- **WHEN** 依次执行：目录同步、一次生成、读取卡片、刷新一张卡片、刷新全部
- **THEN** 记录中的每个 `(method, path)` 都属于上述五项，且没有以 `/api/` 开头的路径

#### Scenario: 重定向不被跟随

- **GIVEN** 生效线路的网关 mock 对 `POST /v1/responses` 返回 307，分别指向另一 origin 的 mock 和同 origin 的 `/api/usage`
- **WHEN** 发起一次生成
- **THEN** 生成以 `kind: error` 结束；另一 origin 的 mock 收到 0 个请求，同 origin 的 `/api/usage` 收到 0 个请求

#### Scenario: 存在全局代理时仍直连

- **GIVEN** 进程的全局 fetch dispatcher 被替换为会记录请求的代理 mock，网关 mock 在本机端口监听
- **WHEN** 插件执行一次目录同步
- **THEN** 网关 mock 收到 `GET /v1/models`，代理 mock 收到的请求数为 0

#### Scenario: 多线路时只触达生效线路 origin

- **GIVEN** 两条线路指向不同 origin，生效线路为线路 2
- **WHEN** 同步目录、发起一次生成、读取卡片
- **THEN** 全部 HTTP 请求只落在线路 2 origin；线路 1 origin 收到 0 个请求

#### Scenario: 明文 http 线路不携带 Access 头

- **GIVEN** 生效线路是地址为 http 的直连线路，另一条 https 线路配置了 Cloudflare Access
- **WHEN** 向生效线路发起卡片读取与生成
- **THEN** 请求中不出现 `CF-Access-Client-Id` / `CF-Access-Client-Secret`，即使 Access 凭据已在另一条线路保存

#### Scenario: 探测只建 TCP 连接不发 HTTP

- **GIVEN** 两条完整线路且探测被记录
- **WHEN** 自动选择触发一次可达性探测
- **THEN** 只能观察到 TCP 连接尝试，没有任何 HTTP 请求，也没有 bearer 或 Access 头

#### Scenario: 线路检查只触达被检查线路的 /v1/models

- **GIVEN** 线路 1 是生效线路，线路 2 是未生效的已保存线路，两条线路指向不同 origin
- **WHEN** 对线路 2 发起一次线路检查
- **THEN** 线路 2 origin 只收到 1 个 `GET /v1/models` 并带线路 2 自己的 bearer；线路 1 origin 收到 0 个请求；没有任何 `/api/*` 请求；没有发生目录同步，生效线路仍为线路 1

#### Scenario: 检查直连草稿不携带 Access 头

- **GIVEN** 已保存线路 1 启用 Cloudflare Access；被检查的草稿是地址为 https 的直连线路
- **WHEN** 发起线路检查且草稿 key 有效
- **THEN** 该请求不出现 `CF-Access-Client-Id` / `CF-Access-Client-Secret`，只带草稿自己的 bearer
