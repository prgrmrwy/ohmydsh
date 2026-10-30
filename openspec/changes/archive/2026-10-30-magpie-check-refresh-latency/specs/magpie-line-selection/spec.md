## MODIFIED Requirements

### Requirement: 线路测速范围与独立性

测速对象 SHALL 是当前已保存且地址可解析的每条线路（不要求该线路完整、不要求参与自动选择），每条一次。设置页每次打开 SHALL 请求一次测速；线路保存成功（地址或线路集合可能变化）后 SHALL 重新测速一次；已保存线路的「检查线路」完成并拿到结果后 SHALL 重新测速一次。插件 SHALL NOT 定时刷新或轮询延迟、SHALL NOT 持久化读数，也 SHALL NOT 在上述触发点之外发起测速。

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

#### Scenario: 检查线路后重新测速

- **GIVEN** 设置页已完成一次测速（`done`），页面上有一条已保存且地址可解析的线路；随后又新增了一条未保存草稿
- **WHEN** 先在已保存线路上点击「检查线路」并拿到结果，再在那条未保存草稿上点击「检查线路」并拿到结果
- **THEN** 第一次检查后客户端再发出一次 `GET latency`，该行延迟读数用新响应更新，且没有发出 `POST settings`；第二次（草稿）检查后没有新的 `GET latency` 请求，草稿的延迟位保持 `idle`

#### Scenario: 不轮询且不改变线路选择

- **GIVEN** 设置页已打开并完成测速
- **WHEN** 推进多个时间片并观察请求记录
- **THEN** 没有新的 latency 请求，也没有因延迟读数发出 `POST settings` 或其它请求（「测速不写设置、不改变线路选择」由 host 侧「线路测速生命周期」的字节级场景断言）
