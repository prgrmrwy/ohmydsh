## MODIFIED Requirements

### Requirement: 线路展示与展开

设置页加载已有线路配置时 SHALL 默认把所有线路折叠为一行（SHALL NOT 默认展开当前生效线路）。首次安装（`lines` 为空）SHALL 显示空态与「添加线路」入口；用户点击「添加线路 / 添加备用线路」新增的线路 SHALL 自动展开，供填写地址与凭据；该未保存线路首次保存成功后（host 分配 id、设置重新读取），该行 SHALL 保持展开并以新 id 继续渲染。保存成功后的设置刷新 SHALL 保留用户此前展开的线路（若该线路仍存在）；保存失败时该行 SHALL 保持展开并保留用户输入。

行头部的切换控件 SHALL 覆盖线路序号、active 方块、地址主机名与延迟位，是点击与聚焦目标（鼠标 pointer）；点击该控件 SHALL 切换展开/收起。切换控件 SHALL 是原生 `button`，带 `aria-expanded`，展开时带指向编辑内容的 `aria-controls`（折叠时编辑内容不渲染，`aria-controls` 只在展开时出现）。上移 / 下移 / 删除 SHALL 为常驻图标按钮（不依赖 hover 才出现，位于切换控件之外），每个按钮 SHALL 带可访问名称（例如 `aria-label="上移线路 2"`）；禁用按钮的 `aria-label` SHALL 说明原因（例如「上移线路 1（已是第一条）」）。点击操作按钮 SHALL NOT 改变展开状态。禁用条件保持不变：序号 1 不可上移、最后一条不可下移、列表仅剩一条不可删除。

每行折叠态 SHALL 展示：线路序号、active 方块（仅生效线路）、地址主机名、延迟指示、切换控件与操作图标；已保存但未完整的线路 SHALL 额外显示「未配置」标记（元素带 `data-line-incomplete`），并 SHALL NOT 显示 active 方块；未保存的草稿 SHALL 显示「（未保存）」标记，SHALL NOT 显示「未配置」。线路卡片根元素 SHALL 带 `data-line-id` 与展开状态 `data-expanded`（取值 `"true"` / `"false"`）。当前生效线路的序号后 SHALL 显示一个 4×4 px 的绿色方块，元素带 `aria-label="当前线路"` 与 `data-active-line`（值为该线路的 id，即 8 位小写 hex），颜色使用固定 token `--dmg-active`（值 `#22c55e`）；非生效线路 SHALL NOT 显示该方块。除该方块外，SHALL NOT 使用其它图形化 active 指示。

#### Scenario: 默认收起已配置的线路

- **GIVEN** 两条已保存且完整的线路 `a1b2c3d4` 与 `9f0e7d6c`，当前生效线路 id 为 `9f0e7d6c`
- **WHEN** 打开设置页
- **THEN** 两张卡片 `data-expanded` 都为 `"false"`，没有展开的编辑内容；`9f0e7d6c` 的序号后仍有 4×4 px、`aria-label="当前线路"`、`data-active-line="9f0e7d6c"` 的方块，`a1b2c3d4` 没有该方块

#### Scenario: 无 active 时不显示方块

- **GIVEN** 唯一线路的 key 被清除使其不再完整（`activeLineId` 为 null），但地址仍可解析
- **WHEN** 打开设置页
- **THEN** 该线路卡片仍以 `data-expanded="false"` 渲染且没有 `data-active-line` 方块；页面正常渲染、不报错、不抛异常

#### Scenario: 首次安装空态与添加第一条线路后展开

- **GIVEN** 没有持久化 settings 文件（`lines` 为 `[]`）
- **WHEN** 打开设置页，然后点击「添加线路」
- **THEN** 打开时显示空态与「添加线路」入口；点击后出现一张地址为空的线路卡片，其 `data-expanded` 为 `"true"` 且地址输入框可见

#### Scenario: 新建线路首次保存后保持展开并换成新 id

- **GIVEN** 空态下点击「添加线路」，填写地址与 key，且该行处于展开状态
- **WHEN** 保存成功、设置响应返回 host 分配的新 id
- **THEN** 该行仍为 `data-expanded="true"`，`data-line-id` 变为响应中的 8 位小写 hex 新 id，且没有其它展开行

#### Scenario: 新增线路并上移后首次保存仍保持展开

- **GIVEN** 已有两条已保存线路且都折叠
- **WHEN** 点击「添加备用线路」、填写地址与 key，把新行上移到序号 1，然后保存成功
- **THEN** 该行仍为 `data-expanded="true"` 且 `data-line-id` 为响应中分配的新 id；其余两行 `"false"`

#### Scenario: 新增备用线路只展开新行

- **GIVEN** 已有两条已保存线路且都处于折叠状态
- **WHEN** 点击「添加备用线路」
- **THEN** 新增的未保存线路 `data-expanded` 为 `"true"`；两条已保存线路仍为 `"false"`

#### Scenario: 点击切换控件切换展开且图标操作不触发展开

- **GIVEN** 两条已保存的线路 `a1b2c3d4`（序号 1）与 `9f0e7d6c`（序号 2），两行都折叠
- **WHEN** 点击 `9f0e7d6c` 的切换控件展开它；点击该行已启用的「上移」图标（`[aria-label^="上移"]`）；再次点击 `9f0e7d6c` 的切换控件收起它；最后点击此时序号 1（`9f0e7d6c`）行上已禁用的「上移」图标
- **THEN** 第一次点击后 `9f0e7d6c` 的 `data-expanded` 为 `"true"`、切换控件 `aria-expanded="true"`；点击「上移」后顺序变为 `9f0e7d6c` 在前且它仍为 `"true"`；第二次点击切换控件后回到 `"false"`；两行都折叠后 `9f0e7d6c` 的「上移」按钮存在、`disabled` 且 `aria-label` 含「已是第一条」，点击它不改变任何行的 `data-expanded`（切换控件是原生 `button`；浏览器中的 Enter/Space 激活放在预览验收，jsdom 只断言 `tagName`、`type` 与 `aria-expanded`）

#### Scenario: 保存失败时保持展开且不清空输入

- **GIVEN** 线路 2 已展开并修改了地址，其它线路折叠
- **WHEN** 提交保存但设置写入返回 409 或 400
- **THEN** 线路 2 仍为 `data-expanded="true"`，输入框保留用户输入并显示失败原因；不发出 latency 重测请求

#### Scenario: 保存后不收起正在编辑的行

- **GIVEN** 线路 2 已被用户展开并修改地址，其它线路折叠
- **WHEN** 保存成功并刷新设置视图（提交 POST 响应，不额外发 `GET settings`）
- **THEN** 线路 2 仍为 `data-expanded="true"` 且显示新地址；其它线路保持 `"false"`

#### Scenario: 已保存但未完整的线路标记为未配置

- **GIVEN** 线路 1 完整且为生效线路；线路 2 保存了地址但没有 key（`complete: false`）
- **WHEN** 打开设置页
- **THEN** 线路 2 的行内显示「未配置」标记（`[data-line-incomplete]`）且不带 `data-active-line`；线路 1 显示生效方块且不显示该标记；随后点击「添加备用线路」新增的未保存草稿显示「（未保存）」且不显示「未配置」

## ADDED Requirements

### Requirement: 保存结果陈述

保存线路列表成功后，设置页的结果提示 SHALL 只陈述状态（`已保存 · 当前线路 N`；没有完整线路时为 `已保存 · 当前无生效线路`），SHALL NOT 把这次结果陈述成一次线路切换事件；该结果元素 SHALL NOT 带 `role="alert"`、`role="status"` 或 `aria-live`，页面 SHALL NOT 新增 `alert` / `confirm` 调用。

#### Scenario: 保存结果只陈述状态

- **GIVEN** 两种提交：线路 1 不可达、线路 2 完整且可达（保存前生效线路为线路 1）；以及提交后没有任何完整线路（所有 key 被清空）
- **WHEN** 分别保存成功
- **THEN** 结果提示文本依次恰为 `已保存 · 当前线路 2` 与 `已保存 · 当前无生效线路`；两次的元素都不带 `role="alert"`、`role="status"`、`aria-live`，也没有新增 `alert` / `confirm` 调用；文本中不出现「切换」字样

### Requirement: 线路检查端点与结果分类

设置 API SHALL 提供一个只读的线路检查端点：向被检查线路经过校验的 API 根发起一次 `GET /models`，返回单一分类结果 `{kind, gatewayStatus?, reason?, latencyMs, modelCount?, models?, testedAt}`。除请求体非法返回 400 外，结果一律以 200 返回，异常不得逃出成 5xx。分类优先级 SHALL 为：已取得响应状态时按状态分类（3xx → `redirect`、401 → `unauthorized`、403 → `forbidden`、其它非 2xx → `http`），且不因错误 body 读取失败或超时改变；被传输层阻断的重定向同样归 `redirect`；2xx 时才按目录内容分类。`reason` SHALL 先脱敏再截断到 300 字符以内。

#### Scenario: 检查未生效的草稿线路返回快照且不改变任何状态

- **GIVEN** 线路 1 完整且为生效线路（代际 id 为 G、目录为 `{a}`、`settings.json` 字节为 S）；线路 2 是尚未保存的草稿，地址可达且 key 正确
- **WHEN** 客户端对该草稿调用线路检查
- **THEN** 响应为 200 且 `kind: "ok"`、`modelCount` 与 `models[].id` 等于网关返回的模型；`settings.json` 字节仍为 S，代际 id 仍为 G，`selectedLineId` 仍为线路 1，没有新增 owner 写入或路由注册事件，线路 1 origin 收到 0 个请求

#### Scenario: 连接阶段失败归入 unreachable

- **GIVEN** 草稿地址指向未监听的端口；另有一个地址的 TLS 握手被 mock 拒绝
- **WHEN** 各调用一次线路检查
- **THEN** 两次都是 200 + `kind: "unreachable"`、`reason` 非空、没有 `gatewayStatus`；没有 5xx，没有重定向或重放，生效线路与卡片状态不变

#### Scenario: 网关非 2xx 按状态分类

- **GIVEN** 被检查网关分别对 `/models` 返回 401、403、503
- **WHEN** 各调用一次线路检查
- **THEN** 依次为 `kind: "unauthorized"` + `gatewayStatus: 401`、`kind: "forbidden"` + `gatewayStatus: 403`、`kind: "http"` + `gatewayStatus: 503`

#### Scenario: 3xx 不跟随并按状态归 redirect

- **GIVEN** 源网关对 `/models` 返回 307 且 `Location` 分别指向另一 origin 的 mock 与同 origin 的 `/api/usage`；另两个 mock 分别返回 304、300 且都没有 `Location`
- **WHEN** 分别调用四次线路检查（307 的两个 Location 变体、304、300）
- **THEN** 四次结果都是 `kind: "redirect"`；307 的两次里，另一个 origin 的 mock 与同 origin 的 `/api/usage` 各收到 0 个请求；304/300 的两次里，源网关各只收到 1 个 `/v1/models` 且没有任何后续请求；四次都没有重放

#### Scenario: 2xx 的 body 读取失败与预算耗尽

- **GIVEN** 被检查网关分别返回 200 后中断 socket、返回 200 后 body 永不结束
- **WHEN** 各调用一次线路检查
- **THEN** 前者 `kind: "unreachable"`（reason 说明响应读取失败）、无重放；后者 `kind: "timeout"`、`latencyMs` ≤ 6000、连接被中止，且同一线路紧接着的下一次检查能正常发出

#### Scenario: 2xx body 的解码结果分类

- **GIVEN** 被检查网关分别返回 200 + HTML、200 + `{data:{}}`、200 + `{data:[]}`
- **WHEN** 各调用一次线路检查
- **THEN** 前两者为 `kind: "invalid-catalog"` 且 `modelCount` 缺省；第三个为 `kind: "ok"`、`modelCount: 0`、`models: []`

#### Scenario: 状态优先于错误 body 超时

- **GIVEN** 被检查网关返回 403 响应头，但其错误 body 一直不结束直到 5 秒预算耗尽
- **WHEN** 调用线路检查
- **THEN** `kind: "forbidden"`、`gatewayStatus: 403`（不是 `timeout`），`reason` 标注错误 body 未完整读取

#### Scenario: reason 先脱敏再截断

- **GIVEN** 检查用 key 为假值 `secret-ABCDEFGHIJK0123456789`；网关 401 body 中的原因原文恰为 `"x"` 重复 290 次 + 该 key + `"y"` 重复 30 次
- **WHEN** 调用线路检查
- **THEN** `reason` 恰为 `"x"` 重复 290 次 + `[redacted]`（完整标签，长度 300）；不出现该 key 的完整明文，也不出现截断前缀 `secret-ABC`

### Requirement: 线路检查请求字段契约

线路检查的请求体 SHALL 是草稿子集，不是设置写入格式：`id` 仅「省略」SHALL 表示新草稿，空串或非 8 位小写 hex SHALL 返回 400；`baseUrl` SHALL 是必填字符串，缺失或非字符串 SHALL 返回 400，空串 SHALL 返回 `incomplete` 且 SHALL NOT 回退已保存地址；`accessMode` 省略 SHALL 视为 `direct`，空串或其它取值 SHALL 返回 400；三项凭据省略或空串在有 `id` 时 SHALL 沿用该线路保存值、无 `id` 时 SHALL 视为缺失，非字符串或 `null` SHALL 返回 400，非空但超过 512 字符或含空白 / 非 ASCII 可见字符 SHALL 返回 `invalid`。直连携带非空 Access 值 SHALL 为 `invalid`，Cloudflare 非 https 或缺一项 Access SHALL 为 `incomplete`；`invalid` 与 `incomplete` SHALL NOT 发出请求。

#### Scenario: 请求形状非法返回 400

- **GIVEN** 已保存线路 `a1b2c3d4`（direct、地址 A、key K）与一条含未知键的请求体
- **WHEN** 依次提交：`{id: "", baseUrl: A, key: K}`（空 id，其余字段有效）、`{id: 42, baseUrl: A}`、`{}`（缺 `baseUrl`）、`{baseUrl: 42}`、`{baseUrl: A, accessMode: 42}`、`{baseUrl: A, accessMode: "proxy"}`、`{baseUrl: A, accessMode: ""}`、`{baseUrl: A, key: 42}`、`{baseUrl: A, key: null}`、`{baseUrl: A, accessClientId: 42}`、`{baseUrl: A, accessClientId: null}`、`{baseUrl: A, accessClientSecret: 42}`、`{baseUrl: A, accessClientSecret: null}`、`{baseUrl: A, unknownKey: 1}`
- **THEN** 十四次响应都是 400；每次的网关请求数都是 0，凭据解析调用数都是 0（空 id 那次必须由 id 规则本身触发 400，不能依赖缺地址）

#### Scenario: 值非法归入 invalid

- **GIVEN** 已保存的完整 direct 线路 `a1b2c3d4`（地址 A、key K）与完整 Cloudflare 线路 `9f0e7d6c`（https 地址 C、key K2、Access I2/S2）
- **WHEN** 分别提交：`{id: "a1b2c3d4", baseUrl: "ftp://gw/v1"}`、`{id: "a1b2c3d4", baseUrl: "https://gw"}`（无版本段）、`{id: "a1b2c3d4", baseUrl: "https://u:p@gw/v1"}`（含 userinfo）、`{accessMode: "direct", baseUrl: A, accessClientId: "I"}`、`{id: "a1b2c3d4", baseUrl: A, key: "bad key"}`（含空白）、`{id: "9f0e7d6c", baseUrl: C, accessMode: "cloudflare", accessClientId: "bad id"}`（含空白）、`{id: "9f0e7d6c", baseUrl: C, accessMode: "cloudflare", accessClientSecret: "bad secret"}`、`{id: "a1b2c3d4", baseUrl: A, key: "a" 重复 513 次}`
- **THEN** 八次都是 200 + `kind: "invalid"`；每次的网关请求数都是 0

#### Scenario: 草稿不完整一律 incomplete

- **GIVEN** C 是合法 https `/v1` 地址；已保存线路 `a1b2c3d4`（direct、地址 A、key K）只用于第六个变体，前五个变体都不带 id
- **WHEN** 依次提交六个对象：① `{baseUrl: "http://gw:3425/v1", accessMode: "cloudflare", key: "K2", accessClientId: "I2", accessClientSecret: "S2"}`（合法 http 地址、三项凭据齐全、仅非 https）；② `{baseUrl: C, accessMode: "cloudflare", key: "K2", accessClientId: "I2"}`（缺 `accessClientSecret`）；③ `{baseUrl: C, accessMode: "cloudflare", key: "K2", accessClientSecret: "S2"}`（省略 `accessClientId`）；④ `{baseUrl: C, accessMode: "cloudflare", key: "K2", accessClientId: "", accessClientSecret: "S2"}`（client id 空串）；⑤ `{baseUrl: C, accessMode: "cloudflare", key: "K2", accessClientId: "I2", accessClientSecret: ""}`（secret 空串）；⑥ `{id: "a1b2c3d4", baseUrl: ""}`（已保存 id + 空地址）
- **THEN** 六次都是 200 + `kind: "incomplete"`；每次的网关请求数都是 0，凭据解析调用数也都是 0（前五项无 id，因此不得读取任何已保存凭据）

#### Scenario: 凭据留空沿用保存值

- **GIVEN** 已保存的完整 direct 线路 `a1b2c3d4`（地址 A、key K）与完整 Cloudflare 线路 `9f0e7d6c`（https 地址 C、key K2、Access I2/S2）
- **WHEN** 分别提交：`{id: "a1b2c3d4", baseUrl: A}`（省略 key）、`{id: "a1b2c3d4", baseUrl: A, key: ""}`、`{id: "9f0e7d6c", baseUrl: C, accessMode: "cloudflare"}`（三项凭据全省略）、`{id: "9f0e7d6c", baseUrl: C, accessMode: "cloudflare", accessClientId: "", accessClientSecret: ""}`
- **THEN** 四次都返回 `kind: "ok"`；前两次的请求带 `Bearer K`，后两次带 `Bearer K2` 与 `CF-Access-Client-Id: I2` / `CF-Access-Client-Secret: S2`；响应体都不出现这些值

#### Scenario: 无 id 的草稿只用显式字段

- **GIVEN** 请求没有 id，有地址但没有 key
- **WHEN** 调用线路检查
- **THEN** 返回 `kind: "incomplete"`，凭据解析调用为 0 次，网关收到 0 个请求

#### Scenario: 未知或未提交的线路 id

- **GIVEN** 当前配置只有线路 `a1b2c3d4`
- **WHEN** 分别用形状合法但不存在的 id `deadbeef`、形状非法的 id `not-hex` 调用线路检查
- **THEN** 前者为 200 + `kind: "invalid"`，后者为 400；两次都没有调用凭据解析、没有向任何 origin 发请求

### Requirement: 线路检查的准入、读取一致性与单飞

检查 SHALL 在准入时记录一个只存在于 host 内存的连接写入版本号，并在凭据解析完成后、发请求前重新校验该版本号未变且宿主未 dispose；变化即 SHALL 返回 `kind: "pending"` 且零网关请求。任何连接保存的开始（即使最终失败）与凭据引用的外部更新 SHALL 递增该版本号；该版本号 SHALL NOT 触发换代、选线、目录同步或设置写盘。同一时刻 SHALL 只允许一个检查，并发请求返回 `kind: "busy"` 且不复用他人结果。

#### Scenario: 解析期间发生连接写入

- **GIVEN** 线路 1 生效；线路 2 是 Cloudflare 备用线路，检查以「凭据留空沿用保存值」调用，凭据解析被暂停在第一项之后
- **WHEN** 暂停期间分别发生：另一调用方把线路 2 的整组凭据保存成功；另一次保存以失败结束；线路 2 被删除——三种情形各释放解析
- **THEN** 三次检查都返回 200 + `kind: "pending"`、网关 0 请求，检查闸门与临时凭据引用都已释放；随后的恢复验证按分支不同：成功分支直接用新值检查得到 `kind: "ok"`；失败分支先按既有 pending 规则完成一次成功的整组重试，再检查得到 `kind: "ok"`；删除分支先断言原 id 得到 `kind: "invalid"`，再用无 id 的完整显式草稿检查得到 `kind: "ok"`

#### Scenario: 入口或解析后处于保存中

- **GIVEN** 两种情形：(a) 调用时宿主正在保存设置；(b) 检查已通过入口准入并开始解析凭据，解析完成之前保存开始
- **WHEN** 各调用一次线路检查
- **THEN** (a) 入口即被拒：凭据解析调用数为 0、网关收到 0 个请求，结果为 `kind: "pending"`；(b) 版本复核失败：允许此前已经发生的解析，但结果同样为 `kind: "pending"`、网关收到 0 个请求，且检查闸门与临时凭据引用都已释放

#### Scenario: 凭据读取异常不发请求

- **GIVEN** credentials 服务在解析该线路的 key 时抛错
- **WHEN** 调用线路检查
- **THEN** `kind: "invalid"`、`reason` 脱敏且不含凭据；网关收到 0 个请求

#### Scenario: 同一时刻只允许一个检查

- **GIVEN** 两个独立的设置页同时对同一草稿发起线路检查
- **WHEN** 两次请求几乎同时到达宿主
- **THEN** 只有一个请求产生网关请求，另一个返回 `kind: "busy"`；先返回的结果只属于发起它的那个草稿

#### Scenario: 临时凭据的脱敏覆盖成功与失败两条路径

- **GIVEN** 检查使用一把从未保存过的 key 与一组 Access 值；网关在成功响应的模型 id、`owned_by` 以及 401 body 的普通字段、JSON 键名和转义序列中回显它们
- **WHEN** 分别调用线路检查并在读取 body 阶段制造一次错误
- **THEN** 成功响应的 `models`、失败响应的 `reason`、插件日志与任何写盘文件都不出现这些值的明文（出现处一律为 `[redacted]`）

### Requirement: 线路检查快照的展示与失效

设置页 SHALL 在每条线路卡片内提供「检查线路」，把结果渲染为只读快照：一行 `kind` 结论、`latencyMs`、模型数量，以及与宿主返回的目录缓存（`settings.groups` 的 model id 并集）按完整 id 集合算出的多出 / 缺少（不展示共同集合）。快照 SHALL NOT 提供 checkbox、effort 或刷新入口，SHALL NOT 写入可见性或默认 effort，也 SHALL NOT 声称与当前生效线路一致——基准是缓存目录，缓存同步时间可用时 SHALL 一并显示。快照 SHALL 对生效线路同样可用（编辑生效线路的草稿时，下方目录不代表草稿结果）。

#### Scenario: 与缓存对比：一致或多出 / 缺少

- **GIVEN** 宿主目录缓存为 `{a,b,c}`、`lastSyncAt` 为 T
- **WHEN** 一次检查返回 `{a,b,c}`，另一次返回 `{a,b,x}`
- **THEN** 前者显示「与缓存目录一致」与 T、不显示多出/缺少；后者显示「多 1 · 少 1」，多出集合为 `{x}`、缺少集合为 `{c}`，不展示共同集合；两次都没有产生设置写入（`POST settings` 调用为 0）

#### Scenario: 快照只读

- **GIVEN** 一条线路已有快照
- **WHEN** 检查快照区域
- **THEN** 区域内没有 checkbox、effort 下拉或刷新按钮（只有按钮外部的检查/清除入口），模型 id 以纯文本节点渲染

#### Scenario: 缓存基准诚实，不断言当前线路

- **GIVEN** 生效线路已切换为线路 2，但目录仍是线路 1 的继承目录、`lastSyncAt` 为线路 1 的时间 T1；检查线路 3 返回与继承目录相同的 id 集合
- **WHEN** 渲染快照
- **THEN** 显示「与缓存目录一致」与 T1，页面不出现「与当前线路一致」或「同一个网关」这类结论

#### Scenario: 失效事件与迟到结果

- **GIVEN** 线路 2 已有一份快照，且另有一次检查正在进行
- **WHEN** 分别发生：修改本卡地址、修改本卡 key、修改一项 Access、修改接入方式、保存成功、生效线路改变、显式清除、重新打开设置页
- **THEN** 每种情况下快照都消失；进行中的那次检查在以上任一事件之后返回时结果被丢弃，不重新挂回。仅编辑其它线路或调整线路顺序（尚未保存）时 SHALL NOT 丢弃本卡快照。

#### Scenario: 没有缓存基准时不下结论

- **GIVEN** `settings.groups` 为空且没有 `lastSyncAt`；另一种情形是缓存有目录但没有 `lastSyncAt`；第三种是缓存为空但有 `lastSyncAt`
- **WHEN** 检查成功并渲染快照
- **THEN** 三种情形都只显示 `kind`、模型数量与耗时，不显示一致性或多出/缺少结论（两种缺失条件任一成立即不下结论）
