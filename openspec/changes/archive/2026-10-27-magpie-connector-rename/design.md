## Context

插件此前以 `dsh-magpie` 为 package、Cordis id、route id 和设置目录，安装在本机 ohmydsh 部署中；另有一个已停用的第三方 `dsh-magpie-connect`。改名必须同时处理运行时身份与用户数据，不能只改文档。

## Decisions

### D1 全量改名，凭据引用保持不变
package/npm 名、Cordis id、route、`/api/dsh-magpie-connector/*`、`$DSH_HOME/plugins/dsh-magpie-connector/` 全部使用新名。`MAGPIE_API_KEY` 等凭据引用是按网关命名而非插件命名，保持原值可让已保存 key 继续生效，避免用户重新输入。

### D2 旧设置只读迁移
`SettingsStore` 增加可选 `legacyPath`：仅在新路径不存在时读取旧 `plugins/dsh-magpie/settings.json`，之后保存只写新路径，旧文件不改写、不删除。理由是保留用户地址、可见性与默认 effort，同时让回滚旧版本仍能找到自己的数据。

### D3 依赖方按真实 route 精确同步
AUTO 策略的 transport 白名单、出口守卫的 `exemptProviders`、侧边栏品牌回归用例都引用真实 route，因此随改名更新；不保留旧 route 别名，避免出现两个入口和重复模型。旧会话保存的 route 明确不迁移，README 说明需手动重选模型。

### D4 消费面资产来自隔离实例
GIF 与架构图必须可复核但不得包含真实账号、地址或 key：在 `/tmp` 下用独立 `DSH_HOME`、本机 mock Magpie 网关（合成模型与用量卡片）和 Playwright 录制真实 Web UI；登记到 `docs/SCREENSHOTS.md`。架构图用 archify 从仓库源码取证生成双语双主题 SVG，JSON 源随包提交。

## Risks

- 旧 `dsh-magpie` 会话在 route 改名后不可直接继续；README 与 change 记录明确说明。
- 依赖方（AUTO/守卫/侧边栏）若漏改会用旧 route 匹配失败；已用各自测试覆盖。
