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

### Requirement: active 展示

设置页 SHALL 默认只展开当前生效线路，其余线路 SHALL 折叠为一行（含序号、地址主机名与展开入口）。线路卡片根元素 SHALL 带 `data-line-id` 与展开状态 `data-expanded`（取值 `"true"` / `"false"`）。当前生效线路的序号后 SHALL 显示一个 4×4 px 的绿色方块，元素带 `aria-label="当前线路"` 与 `data-active-line`（值 SHALL 为该线路的 id，即 8 位小写 hex），颜色使用固定 token `--dmg-active`（值 `#22c55e`）；非生效线路 SHALL NOT 显示该方块。除默认展开外，唯一的图形化 active 指示是序号后的方块。

#### Scenario: 默认只展开 active 并显示 4×4 绿方块

- **GIVEN** 线路 `a1b2c3d4` 与 `9f0e7d6c` 都完整，当前生效线路 id 为 `9f0e7d6c`
- **WHEN** 打开设置页
- **THEN** `9f0e7d6c` 卡片带 `data-expanded="true"` 且其序号后有一个 4×4 px、`aria-label="当前线路"`、`data-active-line="9f0e7d6c"`、使用 `--dmg-active` token 的方块；`a1b2c3d4` 卡片 `data-expanded="false"` 折叠为一行且没有该方块

#### Scenario: 无 active 时不显示方块

- **GIVEN** 没有完整线路（例如唯一线路的 key 被清除）
- **WHEN** 打开设置页
- **THEN** 没有任何卡片带 `data-active-line` 的方块；页面仍正常渲染已保存的线路卡片且不报错

### Requirement: 静默规则与 info 说明

生效线路变化 SHALL NOT 弹出 toast、横幅、对话框，SHALL NOT 使用 `alert` / `confirm`，也 SHALL NOT 新增 `role="alert"` / `role="status"` 或 `aria-live` 内容。插件 SHALL NOT 提供手动选择或强制指定线路的入口。设置页「连接」区 SHALL 提供 info 图标，hover / focus 时说明：线路按序号优先尝试、连不上自动试下一条、绿色方块表示当前线路、多条线路应指向同一个 Magpie 网关。

#### Scenario: 切换线路静默无提示

- **GIVEN** 生效线路为线路 1，随后自动选择改为线路 2
- **WHEN** 切换发生并再次读取设置页
- **THEN** 整个过程没有 `alert` / `confirm` 调用、没有新增 `role="alert"` / `role="status"` 或 `aria-live` 内容；设置页下次读取时线路 2 展开且方块位于线路 2

#### Scenario: info 图标说明优先级

- **GIVEN** 设置页已加载
- **WHEN** 把指针移到 info 图标上（或键盘聚焦）
- **THEN** 显示说明文本：线路按序号优先尝试、连不上自动试下一条、绿色方块表示当前线路、多条线路应指向同一个 Magpie 网关；该操作不修改任何配置

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

只有一条完整线路时，插件 SHALL 直接使用该线路且 SHALL NOT 探测。有两条及以上完整线路时，插件 SHALL 按序号依次做 TCP 可达探测（单条截止时间 ≤600ms），取第一个可达的完整线路；所有完整线路都不可达时 SHALL 使用序号 1 的完整线路发起真实请求并如实上抛错误。

探测 SHALL 只缓存在 host 内存并在有效期内复用；SHALL NOT 使用后台定时轮询，SHALL NOT 持久化探测结果，SHALL NOT 携带凭据或发送 HTTP 请求。

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
