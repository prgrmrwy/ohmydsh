# settings-navigation-icons Specification

## Purpose

统一 Pet、记忆、Magpie 和 AUTO 的设置导航图标扩展边界，保证在当前受管 DSH 设置界面中每个插件仅显示自身配置的一个图标，不与宿主默认齿轮叠加，并保留导航、主题和卸载恢复行为。

## Requirements

### Requirement: 官方图标槽按页面身份替换默认字形

Pet、Memex、Magpie、AUTO SHALL 分别向官方 `settings.section.icon` 注册 id 为 `dsh-pet`、`dsh-memex`、`dsh-magpie-connector`、`auto-model-routing` 的一个图标贡献，分别保留爪印、书本、鸟形、E 字形。图标 SHALL 使用宿主提供的 size；单色图标 SHALL 继承 currentColor。插件 MUST NOT 通过导航 DOM 文案识别、私有行 marker、MutationObserver 或按钮伪元素替换导航图标。现有设置标签、顺序、页面功能、点击与可访问名称 SHALL 不变。

#### Scenario: 新宿主包装层不会产生双图标
- **WHEN** 在 DSH 0.2.2-rc.1 打开含四个插件的设置导航，图标位于宿主 span 包装层中
- **THEN** 每行仅显示自身一个图标，无默认齿轮叠加或旧伪元素占位；其它官方及第三方行保持不变

#### Scenario: 语言和主题变化不依赖文案认领
- **WHEN** 切换中英文、深浅主题并切换选中页面
- **THEN** 四个图标仍按稳定 id 出现在各自入口，单色图标跟随 currentColor，宿主标签和选中状态正常

### Requirement: 图标生命周期与页面注册独立

图标 SHALL 通过官方槽的生命周期注册与释放。卸载后宿主 SHALL 使用默认字形，重新加载后 SHALL 只出现一个图标贡献。图标槽不存在时插件 SHALL 不阻塞原设置页面注册，SHALL 保留宿主默认图标而不是使用 DOM fallback。本次只保证当前受管 0.2.2-rc.1 下自定义图标渲染。

#### Scenario: 卸载与重载
- **WHEN** 释放插件注册后重新注册
- **THEN** 释放期间导航恢复宿主默认字形，重新注册后只有一个自定义图标，不留下行标记或设置图标专用样式

#### Scenario: 宿主没有图标扩展槽
- **WHEN** 宿主提供 settings.section 但未声明 settings.section.icon
- **THEN** 页面注册和内容功能仍可用，导航保留宿主默认图标，不安装任何 DOM 兼容路径
