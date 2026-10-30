# Magpie Line Selection Specification

## Purpose

让插件把「线路」作为一等配置：线路列表通常 1 条（首次安装为空，最多 5 条），按需添加备用线路并按序号自动选择可达线路（在家走局域网、在外走公网），在设置页以最小、静默的方式展示当前生效线路；不引入手动档位、后台轮询或额外基础设施。

## Requirements

### Requirement: 线路列表与优先级

插件 SHALL 支持 0–5 条连接线路：首次安装或持久化设置缺失时 `lines` 为空数组，设置页 SHALL 显示空态与「添加线路」入口；0 线按未配置处理（`activeLineId` 为 null、目录空、生成 `MAGPIE_NOT_CONFIGURED`、卡片 `unconfigured`）。最多 5 条，超过上限的设置提交 SHALL 以 400 拒绝。设置页 SHALL 以线路卡片列表呈现，每条线路卡片包含地址、gateway key 与接入方式。用户 SHALL 能添加线路、上移 / 下移线路、删除线路；非空列表的最后一条线路不可删除（删除入口禁用，绕过界面提交的删除请求 SHALL 以 400 拒绝），0 条只出现在首次安装/设置缺失/持久化设置无效时。线路数组顺序 + 1 SHALL 作为线路序号（1..N），序号即自动选择优先级；线路顺序 SHALL 持久化并在宿主重启后保持。未完整配置的线路 SHALL 允许保存（以空字符串地址表示空地址），但 SHALL NOT 参与自动选择，并 SHALL 标记为未配置。

#### Scenario: 首次安装为 0 条并提供添加入口

- **GIVEN** 没有持久化 settings 文件（首次安装）
- **WHEN** 打开设置页
- **THEN** `lines` 为 `[]`、`activeLineId` 为 null、页面没有任何 `data-active-line` 方块，并显示「添加线路」入口；随后添加一条完整线路并保存，`GET settings` 返回该线路且目录完成一次同步

#### Scenario: 添加备用线路并调整优先级

- **GIVEN** 已有线路 1
- **WHEN** 添加线路 2，把线路 2 上移，然后重启宿主
- **THEN** 列表按新顺序显示、两行内容跟随移动；`GET settings` 响应与 `settings.json` 中两条线路的 id 与配置随数组顺序移动；重启后顺序与序号保持

#### Scenario: 删除线路且至少保留一条

- **GIVEN** 两条线路
- **WHEN** 客户端删除第二条线路；之后再提交删除非空列表的最后一条线路
- **THEN** 第一次删除后只剩一条线路，界面删除入口禁用；第二次提交响应状态为 400，列表仍保留一条线路

#### Scenario: 未完整线路不参与自动选择

- **GIVEN** 线路 1 地址与 key 完整，线路 2 只有地址、没有 key
- **WHEN** 线路 1 不可达并发起一次操作
- **THEN** 插件只尝试线路 1 并以真实错误结束，不切换到线路 2；设置页把线路 2 标记为未配置

#### Scenario: 折叠线路可展开编辑

- **GIVEN** 两条线路，线路 2 处于折叠状态
- **WHEN** 展开线路 2 并修改其地址后保存
- **THEN** 线路 2 的新地址被持久化，线路 1 配置不变，当前生效线路不因这次编辑被强制改变

#### Scenario: 线路数量上限

- **GIVEN** 已有 5 条线路
- **WHEN** 客户端提交第 6 条线路
- **THEN** 响应状态为 400，已保存的 5 条线路不变，没有新增凭据写入

### Requirement: 线路 id 规则

新建线路 SHALL 省略 id，由 host 在创建时生成 8 位小写十六进制随机 id（与现存线路去重）并在响应中返回；既有线路的 id 必须引用现存线路，且请求中不得重复。未知 id、重复 id、或新线路携带 id 的请求 SHALL 以 400 拒绝且零写入。排序、删除与宿主重启 SHALL NOT 改变剩余线路的 id，且 id SHALL NOT 从地址/key/接入方式派生。

#### Scenario: 新线路由 host 分配稳定 id

- **GIVEN** 已有 id=`a1b2c3d4`、id=`9f0e7d6c` 两条线路
- **WHEN** 客户端提交一条省略 id 的新线路，随后排序并重启宿主
- **THEN** 新线路获得匹配 `^[0-9a-f]{8}$` 且不同于现存 id 的随机 id，提交的 key/Access 写入 `MAGPIE_LINE_<大写 id>_API_KEY` / `MAGPIE_LINE_<大写 id>_ACCESS_*`；该 id 在排序与重启后不变，也不随地址或 key 的修改而改变

#### Scenario: 非法 line id 被拒绝

- **GIVEN** 已有线路 id=`a1b2c3d4`
- **WHEN** 客户端分别提交：未知 id=`deadbeef` 的线路、重复的 id=`a1b2c3d4`、新线路携带 id=`feedface`
- **THEN** 每次响应状态为 400，credentials 服务未被调用，已保存的线路配置不变

### Requirement: 静默规则与 info 说明

生效线路变化 SHALL NOT 弹出 toast、横幅、对话框，SHALL NOT 使用 `alert` / `confirm`，也 SHALL NOT 新增 `role="alert"` / `role="status"` 或 `aria-live` 内容。延迟读数出现、变化或测速失败同样 SHALL 静默。插件 SHALL NOT 提供手动选择或强制指定线路的入口。设置页「连接」区 SHALL 提供 info 图标：hover 时显示说明文本，键盘聚焦时 SHALL 通过可访问名称提供同一说明。说明内容包含：线路按序号优先尝试、连不上自动试下一条、绿色方块表示当前线路、多条线路应指向同一个 Magpie 网关，以及延迟是 TCP 建连耗时（含 DNS 解析）、不是网关健康检查。

#### Scenario: 切换线路静默无提示

- **GIVEN** 生效线路为线路 1，随后自动选择改为线路 2
- **WHEN** 切换发生并再次读取设置页
- **THEN** 整个过程没有 `alert` / `confirm` 调用、没有新增 `role="alert"` / `role="status"` 或 `aria-live` 内容；再次打开时所有线路仍折叠，线路 2 的序号后有绿色方块

#### Scenario: info 图标说明优先级

- **GIVEN** 设置页已加载
- **WHEN** 把指针移到 info 图标上（或键盘聚焦）
- **THEN** hover 的 `title` 与可聚焦元素的 `aria-label` 都包含：按序号优先尝试、自动试下一条、绿色方块、同一个 Magpie 网关、TCP 建连耗时（含 DNS 解析）；该操作不修改任何配置

#### Scenario: 延迟变化与测速失败不产生提示

- **GIVEN** 设置页已打开并完成一次测速
- **WHEN** 线路保存触发重测，且重测返回非 2xx 或网络错误
- **THEN** 除保存成功与用量重读本身已有的状态提示（`已保存`、`正在读取用量…` 或空态提示）之外，延迟读数变化与测速失败不新增任何 `role="alert"` / `role="status"` / `aria-live` 内容，也没有新的 toast 或 `alert`；延迟位为 `failed` 状态且不显示读数

### Requirement: 生效线路定义

生效线路 SHALL 是最近一次操作（含设置读取）的选择结果，保存在 host 内存；启动初值为按序号排序的第一条完整线路；没有完整线路时 active 为空（设置响应 `activeLineId: null`，插件视为未配置：模型目录为空、生成 `MAGPIE_NOT_CONFIGURED`、卡片状态 `unconfigured`）。

设置读取 SHALL 返回该值，并且 SHALL 本身执行一次选择（可使用缓存）；设置读取 SHALL NOT 换代、SHALL NOT 触发目录同步、SHALL NOT 向网关发起 HTTP 请求。若选择结果与上次不同，只更新 host 内存中的选择与 `activeLineId`，线路切换的目录继承 / 卡片清空 / 重新同步在下一次真正需要网关的身份操作（目录同步、卡片读取或刷新、生成）开始时执行。

#### Scenario: 设置读取返回并更新生效线路

- **GIVEN** 线路 1 不可达、线路 2 可达，此前没有发生过网关操作
- **WHEN** 客户端读取设置
- **THEN** 响应中的生效线路为线路 2；该次读取没有触发 `GET /v1/models`（最多发生 TCP 探测）；下一次目录同步操作才以线路 2 发起同步

#### Scenario: 无完整线路时 active 为空

- **GIVEN** 唯一线路的 key 被清除，使线路不再完整
- **WHEN** 客户端读取设置并发起生成
- **THEN** 响应 `activeLineId` 为 null；模型目录为空；生成以 `MAGPIE_NOT_CONFIGURED` 结束且没有任何网关请求；卡片状态为 `unconfigured`

### Requirement: 自动选择规则

只有一条完整线路时，插件 SHALL 直接使用该线路且 SHALL NOT 为选择目的发起探测。有两条及以上完整线路时，插件 SHALL 按序号依次做 TCP 可达探测（单条截止时间 ≤600ms），取第一个可达的完整线路；所有完整线路都不可达时 SHALL 使用序号 1 的完整线路发起真实请求并如实上抛错误。

探测 SHALL 只缓存在 host 内存并在有效期内复用；SHALL NOT 使用后台定时轮询，SHALL NOT 持久化探测结果，SHALL NOT 携带凭据或发送 HTTP 请求。设置页线路测速不属于本 requirement 的选择探测：它按「线路测速范围与独立性」执行，不读写本条的探测缓存。

#### Scenario: 单线路直接使用且不探测

- **GIVEN** 只有一条完整线路
- **WHEN** 同步目录并发起一次生成
- **THEN** 插件没有发出任何可达性探测连接，目录与生成请求直接发往该线路

#### Scenario: 序号 1 可达时使用序号 1

- **GIVEN** 两条完整线路，线路 1 地址可连接
- **WHEN** 发起一次操作
- **THEN** 生效线路为线路 1，线路 2 没有收到 HTTP 请求

#### Scenario: 序号 1 不可达时自动使用序号 2

- **GIVEN** 线路 1 地址端口关闭，线路 2 可达
- **WHEN** 发起一次操作
- **THEN** 生效线路为线路 2，只有线路 2 收到 HTTP 请求；探测记录显示线路 1 被探测过、线路 2 被探测过，线路 1 的 HTTP mock 收到 0 个请求

#### Scenario: 全部不可达时用序号 1 并上抛真实错误

- **GIVEN** 两条完整线路都不可达
- **WHEN** 发起一次生成
- **THEN** 插件只用序号 1 的线路发起尝试，以真实连接错误（`ECONNREFUSED` 归入 `TRANSPORT`）结束，不因探测结论跳过真实请求，也不自动重复重放

### Requirement: 探测实现与缓存

单条探测 SHALL 使用显式计时器与 `socket.destroy()` 收口，截止时间 ≤600ms 并且覆盖 DNS 解析阶段。IPv6 字面量地址 SHALL 被正确解析与探测（不得把 `[::1]` 形式的 hostname 直接交给 `net.connect`）。

探测缓存键 SHALL 至少包含线路 id、规范化地址、接入方式与端口。可达结果有效期 10 秒、不可达结果有效期 15 秒（实现常量可注入，测试用假时钟断言）；线路地址 / 接入方式被编辑、线路被删除、连接阶段失败、插件 dispose 时 SHALL 立即失效对应缓存并中止 pending 探测。凭据解析异常的线路按未完整处理，不参与选择。

#### Scenario: 负缓存期内不重复探测

- **GIVEN** 线路 1 刚探测失败，线路 2 可达
- **WHEN** 在负缓存有效期内连续发起多次操作
- **THEN** 线路 1 只发生一次探测连接，后续操作直接使用线路 2

#### Scenario: 正缓存与地址编辑后失效

- **GIVEN** 线路 1 可达，其可达结果已被缓存
- **WHEN** 缓存有效期内发起操作；随后把线路 1 地址改为不可达地址并再次发起操作
- **THEN** 有效期内不重复探测线路 1；地址改动后下一次操作立即重新探测新地址，不沿用旧地址的缓存结论

#### Scenario: IPv6 字面量地址可被探测

- **GIVEN** 一条完整线路的地址为 `http://[::1]:<port>/v1` 且该端口可达
- **WHEN** 发起一次需要选择线路的操作
- **THEN** 该线路被探测为可达并被选中，不因方括号 hostname 被误判为不可达

#### Scenario: dispose 中止探测

- **GIVEN** 一次探测正在进行且目标不响应
- **WHEN** 插件 dispose
- **THEN** 探测被中止且不留悬挂 socket；dispose 完成后没有新的探测或 HTTP 请求

### Requirement: 失败处理与不重放

连接阶段失败（DNS 失败、连接拒绝、连接超时等）时，插件 SHALL 使该线路的探测缓存失效，并让本次操作以失败结束；插件 SHALL NOT 在同一次操作内换线重试或重放请求。下一次操作 SHALL 重新选择线路。

其它失败（HTTP 错误、响应流已开始后中断、鉴权失败）SHALL NOT 由插件换线或重放；生成请求的重试交给 DSH 既有策略。线路 TCP 可达但网关返回 401 / 503 时，插件 SHALL 如实上抛该错误、不自动改用其它线路；用户 SHALL 能在设置页看到当前生效线路并编辑、调整顺序或删除它作为逃生口。

#### Scenario: 连接阶段失败只失效缓存且不重放

- **GIVEN** 生效线路为线路 1，连接在请求发出前被拒绝，线路 2 可达
- **WHEN** 发起一次生成
- **THEN** 该次生成以 `TRANSPORT` 类失败结束，线路 2 没有收到生成请求；线路 1 的探测缓存失效，下一次生成的准备阶段会重新探测并改用线路 2

#### Scenario: 连接阶段失败后下一次操作改用备用线路并成功

- **GIVEN** 线路 1 连接在请求发出前失败，线路 2 可达
- **WHEN** 第一次生成以 `TRANSPORT` 失败结束后，客户端再发起一次生成
- **THEN** 第二次准备阶段重新探测后生效线路为线路 2；该次生成在线路 2 上以 `stop` 正常完成；线路 2 只收到第二次操作的请求

#### Scenario: 非连接阶段失败不重放

- **GIVEN** 生效线路的响应流已经开始输出后中途断开
- **WHEN** 该次生成失败
- **THEN** 生成以 `TRANSPORT` 类失败结束，插件不向任何线路发出第二次请求，重试交由 DSH 策略

#### Scenario: TCP 可达但网关报错时不自动换线

- **GIVEN** 线路 1 TCP 可达但 `/v1/models` 返回 503，线路 2 可达
- **WHEN** 客户端刷新目录
- **THEN** 同步以 `http` 类错误结束（`lastSyncError` 非空），插件不自动改用线路 2；设置响应仍显示生效线路为线路 1

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

### Requirement: 线路延迟展示

设置页每行延迟位 SHALL 暴露 DOM 契约：`data-latency-state`（`measuring` / `done` / `failed` / `idle`）；状态为 `done` 时带 `data-latency-level`（0–4）与 `data-latency-ms`（毫秒整数或空字符串）。

展示规则：
- 请求未返回时，地址可解析的已保存线路为 `measuring` 并显示「测速中…」；地址为空或未保存的草稿为 `idle`，不显示占位、不显示格数；
- 请求成功后为 `done`：4 格 ≤100ms；3 格 ≤250ms；2 格 ≤450ms；1 格 ≤600ms；`ms` 为 null（600ms 内未完成建连）为 0 格并显示「超时」；
- 请求失败（任何非 2xx，含 404，或网络错误）时，本应有读数的行（已保存且地址可解析）为 `failed` 并显示「—」，不显示格数与毫秒；地址为空或未保存的草稿在任何阶段都保持 `idle`，不显示「—」；
- 响应中不存在的行（请求期间被删除或地址不可解析）SHALL 落到 `idle`，不显示读数；
- `idle` / `failed` 不显示格数；
- 颜色：level 4 / 3 用 `--dsw-alias-state-success-primary`，level 2 / 1 用 `--dsw-alias-state-warn-primary`，level 0 与 `failed` 文本用 `--dsw-alias-label-dimmed`。

毫秒数 SHALL 使用等宽数字，并带说明「TCP 建连耗时（含 DNS 解析），不是网关健康检查」的提示；信号条 SHALL `aria-hidden`，毫秒文本是唯一可读内容。延迟显示 SHALL NOT 引入 `role="alert"` / `role="status"` / `aria-live`，SHALL NOT 显示 toast 或 `alert`。

#### Scenario: 打开面板后展示四条线路的延迟档位

- **GIVEN** settings 视图有已保存线路 `11111111`、`22222222`、`33333333`、`44444444`，host 的 latency 响应为 `{lines: [{id: "11111111", ms: 90}, {id: "22222222", ms: 240}, {id: "33333333", ms: 440}, {id: "44444444", ms: 600}]}`
- **WHEN** 打开设置页并等待响应
- **THEN** 四行分别为 `data-latency-state="done"`、`data-latency-level` 等于 4、3、2、1、`data-latency-ms` 等于 `90`、`240`、`440`、`600`，且都带含「TCP 建连耗时」的提示

#### Scenario: 测速中占位与无地址行留空

- **GIVEN** latency 请求尚未返回；两条已保存线路中一条地址可解析、一条地址为空，另有一张未保存草稿
- **WHEN** 渲染设置页
- **THEN** 可解析的那行为 `data-latency-state="measuring"` 且显示「测速中…」；空地址行与未保存草稿为 `data-latency-state="idle"`，既无「测速中…」也无格数；两张 `[data-line-id]` 卡片与 `[aria-label="用量"]` 节点仍在、`data-usage-state` 不变

#### Scenario: 超时显示

- **GIVEN** settings 视图有已保存线路 `22222222`，host 的 latency 响应为 `{lines: [{id: "22222222", ms: null}]}`
- **WHEN** 打开设置页并等待响应
- **THEN** 该行为 `data-latency-state="done"`、`data-latency-level="0"`、`data-latency-ms=""`，并显示「超时」；不显示毫秒数字

#### Scenario: 测速请求失败静默降级为破折号

- **GIVEN** host 的 latency 资源返回 500 或网络错误；页面上有一条地址可解析的线路与一条地址为空的线路
- **WHEN** 打开设置页并等待响应
- **THEN** 地址可解析的行为 `data-latency-state="failed"` 并显示「—」、没有格数；空地址行保持 `idle` 且不显示「—」；没有 `role="alert"` / `role="status"` / `aria-live` 内容，也没有 toast 或 `alert`；两张 `[data-line-id]` 卡片与 `[aria-label="用量"]` 节点仍在、`data-usage-state` 不变

#### Scenario: 旧 host 没有 latency 资源时静默降级

- **GIVEN** latency 请求返回 404（旧版 host）；页面上有一条地址可解析的线路与一条地址为空的线路
- **WHEN** 打开设置页并等待响应
- **THEN** 地址可解析的行为 `data-latency-state="failed"` 并显示「—」，空地址行保持 `idle`；两张 `[data-line-id]` 卡片、`[data-field]` 用法节点与「添加备用线路」按钮仍在

### Requirement: 线路测速范围与独立性

测速对象 SHALL 是当前已保存且地址可解析的每条线路（不要求该线路完整、不要求参与自动选择），每条一次。设置页每次打开 SHALL 请求一次测速；线路保存成功（地址或线路集合可能变化）后 SHALL 重新测速一次。插件 SHALL NOT 定时刷新或轮询延迟、SHALL NOT 持久化读数、SHALL NOT 在设置页打开以外发起测速。

host 侧测量 SHALL 并行发起、单条截止 ≤600ms。设置页测速 SHALL 独立于自动选择：SHALL NOT 为选择目的读写探测缓存、SHALL NOT 改变生效线路，也不受「自动选择规则」中「SHALL NOT 为选择目的发起探测」的约束。

#### Scenario: 打开面板对每条已保存且地址可解析的线路测一次

- **GIVEN** 两条完整线路、一条地址可解析但未配置 key 的线路，以及一条地址为空的线路
- **WHEN** 打开设置页
- **THEN** 客户端只发出一次 `GET latency`；host mock 观察到对前三条线路地址各一次连接尝试，空地址线路没有任何连接；未配置 key 的线路也有读数

#### Scenario: 刷新模型列表不重新测速

- **GIVEN** 设置页已完成一次测速（`done`）
- **WHEN** 点击「刷新模型列表」（`POST settings {resync: true}`，settings 对象随之更新）
- **THEN** 没有新的 latency 请求；各行延迟读数保持不变

#### Scenario: 保存线路后重新测速

- **GIVEN** 设置页已完成一次测速（`done`）
- **WHEN** 保存一条线路的地址并成功返回新设置
- **THEN** 客户端再发出一次 `GET latency`；地址仍可解析的行先回到 `measuring`，随后用新响应更新 `data-latency-*`；地址被清空的行回到 `idle` 且不显示读数

#### Scenario: 不轮询且不改变线路选择

- **GIVEN** 设置页已打开并完成测速
- **WHEN** 推进多个时间片并观察请求记录
- **THEN** 没有新的 latency 请求，也没有因延迟读数发出 `POST settings` 或其它请求（「测速不写设置、不改变线路选择」由 host 侧「线路测速生命周期」的字节级场景断言）

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
