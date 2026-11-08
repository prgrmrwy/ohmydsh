## MODIFIED Requirements

### Requirement: 导航图标是可降级的装饰

页面在设置导航中的文案 SHALL 为「记忆」。导航行 SHALL 通过官方 `settings.section.icon` 槽、以与页面相同的 `dsh-memex` id 提供书本图标，使用宿主 size 并继承 currentColor。实现 MUST NOT 通过导航行 marker、按文案定位、按钮伪元素或 MutationObserver 替换图标。

图标槽缺失或图标贡献释放时 SHALL 保留宿主默认图标，MUST NOT 影响页面本身可用性，也 MUST NOT 改动其他 section 的导航行。

#### Scenario: 图标适配失败仍可用
- **WHEN** 宿主未声明图标槽或本插件图标贡献已释放
- **THEN** 官方默认图标照常显示，页面内容与编辑能力不受影响

#### Scenario: 不污染其他导航行
- **WHEN** 图标贡献生效
- **THEN** 只有 id 为 dsh-memex 的导航行显示一个书本图标，无默认齿轮叠加；其余导航行图标与文案不变
