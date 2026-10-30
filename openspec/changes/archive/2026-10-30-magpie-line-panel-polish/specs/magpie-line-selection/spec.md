## REMOVED Requirements

### Requirement: active 展示

**Reason**: 旧规则「设置页默认只展开当前生效线路」与本 change 的「已配置时默认全部收起 + 头部切换展开」直接互斥；该 requirement 的展示约定整体被 `线路展示与展开` 取代，保留两份规则会让 canonical spec 同时要求两种相反行为。

**Migration**: 无数据迁移。行为由新增的 `线路展示与展开` 接管；`data-line-id` / `data-expanded` / `data-active-line` 的契约保留，相关 UI 测试与 spec 断言随本 change 更新。

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: 线路展示与展开

设置页加载已有线路配置时 SHALL 默认把所有线路折叠为一行（SHALL NOT 默认展开当前生效线路）。首次安装（`lines` 为空）SHALL 显示空态与「添加线路」入口；用户点击「添加线路 / 添加备用线路」新增的线路 SHALL 自动展开，供填写地址与凭据；该未保存线路首次保存成功后（host 分配 id、设置重新读取），该行 SHALL 保持展开并以新 id 继续渲染。保存成功后的设置刷新 SHALL 保留用户此前展开的线路（若该线路仍存在）；保存失败时该行 SHALL 保持展开并保留用户输入。

行头部的切换控件 SHALL 覆盖线路序号、active 方块、地址主机名与延迟位，是点击与聚焦目标（鼠标 pointer）；点击该控件 SHALL 切换展开/收起。切换控件 SHALL 是原生 `button`，带 `aria-expanded`，展开时带指向编辑内容的 `aria-controls`（折叠时编辑内容不渲染，`aria-controls` 只在展开时出现）。上移 / 下移 / 删除 SHALL 为常驻图标按钮（不依赖 hover 才出现，位于切换控件之外），每个按钮 SHALL 带可访问名称（例如 `aria-label="上移线路 2"`）；禁用按钮的 `aria-label` SHALL 说明原因（例如「上移线路 1（已是第一条）」）。点击操作按钮 SHALL NOT 改变展开状态。禁用条件保持不变：序号 1 不可上移、最后一条不可下移、列表仅剩一条不可删除。

每行折叠态 SHALL 展示：线路序号、active 方块（仅生效线路）、地址主机名、延迟指示、切换控件与操作图标。线路卡片根元素 SHALL 带 `data-line-id` 与展开状态 `data-expanded`（取值 `"true"` / `"false"`）。当前生效线路的序号后 SHALL 显示一个 4×4 px 的绿色方块，元素带 `aria-label="当前线路"` 与 `data-active-line`（值为该线路的 id，即 8 位小写 hex），颜色使用固定 token `--dmg-active`（值 `#22c55e`）；非生效线路 SHALL NOT 显示该方块。除该方块外，SHALL NOT 使用其它图形化 active 指示。

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
