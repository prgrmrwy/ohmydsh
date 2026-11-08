## Why

DSH 0.2.2-rc.1 已提供 `settings.section.icon`，同时将导航 SVG 包在 span 中。Pet、Memex、Magpie 的旧直接子级 SVG 隐藏规则因此失效，导致插件图标和宿主默认齿轮同时显示；AUTO 也仍依赖旧 DOM 适配。

## What Changes

- 四个插件统一通过官方图标槽注册与设置页面 id 相同的图标，保留原图案、标签、顺序与页面功能。
- 删除设置图标专用 MutationObserver、label 定位、marker 与按钮伪元素样式，不保留旧 DOM fallback。
- 覆盖新宿主 span 包装层、默认回退、注册释放/重载、主题与非自身行不变的回归检查。
- 同步旧规范的 DOM 限制；在当前受管 0.2.2-rc.1 环境构建部署并验证第二次构建无变化，不自动重启、发布或推送。
- 未提供图标槽的旧宿主只保留默认图标，页面仍通过原 section 槽工作；不承诺旧宿主显示自定义图标。

## Capabilities

### New Capabilities

- `settings-navigation-icons`: 四个自研插件使用官方图标槽的共同契约与生命周期。

### Modified Capabilities

- `dsh-memex-settings-ui`: 替换强制 marker 的旧要求，改为官方同 id 图标槽。
- `dsh-magpie-connector`: 鸟形图标接入迁移到官方槽，移除按文案识别导航行的要求。
- `auto-model-routing`: E 字形改由官方槽渲染，移除 marker 清理与 DOM 定位要求。

## Impact

涉及四个 package 的客户端图标组件、注册入口、相关样式与测试，以及对应当前规范。不修改 Host 业务、持久化数据、凭据、路由身份和第三方插件。不引入运行时依赖，不自动发版或更改版本 pin。验证使用受管 DSH 0.2.2-rc.1；旧宿主保留默认图标需通过无槽注入不影响 section 的测试证明。
