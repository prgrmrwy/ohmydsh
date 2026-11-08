## MODIFIED Requirements

### Requirement: 设置导航自身行使用 Magpie 鸟形图标（AMD2）

插件 SHALL 通过官方 `settings.section.icon` 槽，以与页面相同的 `dsh-magpie-connector` id 提供本地鸟形品牌图标，使用宿主 size、随 currentColor 适应主题，保留文字、点击和可访问性语义。插件 MUST NOT 按 label 识别导航行或添加私有 marker、MutationObserver、按钮伪元素覆盖。图标槽缺失时 SHALL 保留宿主默认字形且不阻塞页面注册。旧 connect 或其它同名设置行 SHALL 不被改动。

图标 SHALL 由官方槽注册生命周期管理，支持对话框晚挂载和重建，卸载时释放自身图标注册，不留下专用样式或 marker。来源许可 SHALL 随包保留。

#### Scenario: 鸟形图标只标记自身导航行
- **GIVEN** 设置导航中同时有本插件 Magpie 行、旧 connect 行和其它行，且可能具有相同 label
- **WHEN** client apply，之后导航重新挂载
- **THEN** 只有 id 为 dsh-magpie-connector 的行显示一个 currentColor 鸟形图标，不叠加默认齿轮；旧 connect/其它行及导航文字、点击行为不变

#### Scenario: 卸载清理与缺失入口静默降级
- **GIVEN** 本插件已注册图标，或宿主未声明图标槽
- **WHEN** 导航变化，然后卸载 client，再重新插入导航
- **THEN** 缺失图标槽不影响页面；卸载后图标注册释放、无 marker 或图标专用样式，默认字形由宿主恢复
