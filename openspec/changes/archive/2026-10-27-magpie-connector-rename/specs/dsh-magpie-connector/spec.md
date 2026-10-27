## ADDED Requirements
### Requirement: 插件身份与命名
插件的 package/npm 名、Cordis 插件 id、LLM route id 与设置目录 SHALL 统一为 `dsh-magpie-connector`。插件 SHALL NOT 同时注册旧 route `dsh-magpie`。凭据引用 SHALL 保持 `MAGPIE_API_KEY`、`MAGPIE_ACCESS_CLIENT_ID`、`MAGPIE_ACCESS_CLIENT_SECRET` 不变。

改名后的首次启动，若新设置文件不存在且旧路径 `$DSH_HOME/plugins/dsh-magpie/settings.json` 存在，插件 SHALL 只读加载旧文件一次；SHALL NOT 改写或删除旧文件。依赖真实 route id 的其它能力 SHALL 使用新 route id。

#### Scenario: 旧偏好只读迁移
- **GIVEN** 旧设置文件含地址与默认 effort，新设置文件不存在
- **WHEN** 插件启动
- **THEN** 运行时读取到旧地址与默认 effort；保存一次后新路径出现设置文件，旧文件字节不变
