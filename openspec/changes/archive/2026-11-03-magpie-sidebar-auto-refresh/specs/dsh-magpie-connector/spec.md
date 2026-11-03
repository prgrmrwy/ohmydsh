## ADDED Requirements

### Requirement: 侧边栏额度自动刷新

插件 host 设置 SHALL 提供 `sidebarRefreshMinutes` 整数分钟：缺失时按 `5` 处理，`0` 表示关闭自动刷新，合法范围 `0–1440`，非整数或越界写入 SHALL 返回 400 且设置不变。设置页 SHALL 提供对应的分钟输入（`0` = 关闭）。开启时，侧栏额度卡 SHALL 按该间隔静默重新读取卡片（GET），SHALL NOT 发送 `POST {all:true}`；页面隐藏时到期 SHALL 不读取，恢复可见时 SHALL 补读一次；读取失败 SHALL 保留旧读数且不影响其他功能。

#### Scenario: 默认五分钟

- **GIVEN** 设置中没有 `sidebarRefreshMinutes`
- **WHEN** 读取设置页
- **THEN** 返回的 `sidebarRefreshMinutes` 为 `5`；侧栏卡片在 5 分钟后自动读取一次

#### Scenario: 关闭自动刷新

- **GIVEN** `sidebarRefreshMinutes` 为 `0`
- **WHEN** 等待超过 5 分钟且用户不操作
- **THEN** 侧栏卡片没有发出额外的 `GET cards`，行为与手动读取一致

#### Scenario: 修改间隔立即生效

- **GIVEN** 当前间隔为 5 分钟
- **WHEN** 用户把输入改为 `2` 并提交
- **THEN** 设置写入 `sidebarRefreshMinutes: 2`；侧栏下一个自动读取发生在 2 分钟后

#### Scenario: 非法输入被拒绝

- **GIVEN** 设置页显示自动刷新输入
- **WHEN** 提交 `1.5`、`-1`、`1441` 或非数字
- **THEN** host 返回 400 或界面回退到当前值，设置保持不变

#### Scenario: 页面隐藏时不读取

- **GIVEN** 自动刷新间隔为 1 分钟，页面处于隐藏状态
- **WHEN** 到期
- **THEN** 客户端不发出 `GET cards`；页面恢复可见后补读一次

#### Scenario: 自动刷新不是强制刷新

- **GIVEN** 自动刷新已开启
- **WHEN** 定时读取触发
- **THEN** 只发出 `GET cards`，没有 `POST {all:true}`

## MODIFIED Requirements

### Requirement: 用量入口与颜色（AMD4）

设置页 SHALL NOT 提供独立的「用量」栏目或常驻「刷新全部」；刷新只在每张卡片上进行，单卡刷新的提示与失败原因显示在该卡片所在分组。没有卡片时，用量状态显示在连接面板，并在空或失败时提供「获取模型与用量」：先重新同步目录，成功后发一次全量刷新（`{all: true}`），同步失败则不刷新并显示原因。窗口用量条 SHALL 按 `used` 着色：≤70 蓝色（business），大于 70 且小于 90 橙色（warn），≥90 红色（error）。窗口用量条的填充段 SHALL 两端为圆角：`settingsCss` 中 `.dmg-fill` 声明的 `border-radius` SHALL 与 `.dmg-track` 相同且非零。

插件 SHALL NOT 使用定时器轮询刷新端点。设置页与侧栏额度卡片的读取 SHALL 只发生在用户动作、页面事件或用户显式开启的自动刷新上：打开设置页、打开侧栏并挂载常驻卡、用户点击刷新、用户展开侧栏卡片、页面重新可见、以及 `sidebarRefreshMinutes` 大于 0 时按该间隔自动读取（客户端 60 秒 TTL 内不重复请求）。侧栏卡片的读取规则见「侧边栏额度卡片」与「侧边栏额度自动刷新」。

#### Scenario: 用量条三档颜色（AMD4）

- **GIVEN** 卡片窗口 `used` 分别为 0、70、70.5、71、89.9、90、100
- **WHEN** 渲染设置页
- **THEN** 用量条档位依次为 normal、normal、warn、warn、warn、high、high

#### Scenario: 有卡片时没有整体刷新（AMD4）

- **GIVEN** 卡片端点返回一张 codex 卡片
- **WHEN** 渲染设置页
- **THEN** 页面没有「刷新全部」或「获取模型与用量」按钮，也没有用量状态栏；只有该卡片自己的「刷新」

#### Scenario: 目录同步失败时不发全量刷新

- **GIVEN** 卡片为空，设置写入（目录同步）返回 502
- **WHEN** 用户点击「获取模型与用量」
- **THEN** 不发出全量刷新，连接面板显示失败原因

#### Scenario: 用量条填充两端圆角

- **GIVEN** 设置页把样式表作为字符串导出（`settingsCss`）
- **WHEN** 解析其中 `.dmg-track` 与 `.dmg-fill` 的 `border-radius` 声明
- **THEN** 两者都声明了相同且非零的 `border-radius`（46% 进度时末端视觉为圆弧，由预览验收确认）

#### Scenario: 没有定时器轮询

- **GIVEN** `sidebarRefreshMinutes` 为 0 且设置页与侧栏卡片已打开
- **WHEN** 等待超过任何合理轮询间隔
- **THEN** 客户端没有发出额外 `GET cards`；只有用户显式把 `sidebarRefreshMinutes` 设为正数时，卡片才按该间隔定时读取
