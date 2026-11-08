## Context

动机见 proposal.md。当前受管 DSH 为 0.2.2-rc.1，官方 types 声明独立 `settings.section.icon`（root/list/inline），组件 owner props 为 size、active。shell 在 span 内按 section id 过滤该槽，无贡献时渲染 navIcon 默认值。旧插件用 button 伪元素加图形，Pet/Memex/Magpie 仅隐藏直接子 SVG；AUTO 虽隐藏后代 SVG，仍会留下包装层占位。

## Goals / Non-Goals

**Goals:** 四个现有插件使用同一个官方契约，不改变图案、页面身份、标签或顺序，移除图标专用 DOM 依赖。

**Non-Goals:** 不设计新图标、不修改宿主与第三方插件，不改变 Host 数据、发版、推送或自动重启；不为旧宿主继续维护 DOM 兼容。

## Decisions

1. 在各插件现有 nav-icon 模块保留小型纯图标组件，在客户端入口使用 `ctx.slots.inject('settings.section.icon', () => ctx.slots.register(...))`，id 与原 section 完全一致。使用现有注入生命周期，不添加手工 effect 注册或跨包公共抽象。替代方案是修复 CSS 选择器，但继续依赖宿主 DOM，故不采用。
2. Pet 保留 emoji，用内联 span 按 size 设置几何；Memex、AUTO 使用现有 SVG 路径的纯 React SVG，stroke/fill 为 currentColor；Magpie 复用已有鸟形资源，以组件自身的 mask 显示，不向导航按钮注入 CSS，不复制整份超长鸟形路径。
3. 删除旧 marker/observer/伪元素规则与注释。保留文件路径而替换导出，避免无必要移动。原本按文字查找行、重复同名歧义等测试改为按稳定 id 的槽贡献测试。
4. 验证至少覆盖真实 span 包装的同 id 替换、未匹配 id 默认回退、size/主题继承、释放与重复 apply，以及缺图标槽但 section 可用。优先使用已安装官方 slots/renderer 测试能力，不用只检查 CSS 字符串作为双图标修复证据。
5. 不主动提高整个插件的 DSH 下限。缺图标槽时 `slots.inject` 等待，不应影响独立 section 注册；实施时必须用官方注册生命周期证明这一点，不能只依赖 mock。若证明失败，需停下报告兼容性差异，不静默声明兼容。

## Risks / Trade-offs

- [现有 mock 假定第一条注册必是 section] → 核对全部注册调用方，测试按 name/id 选择，不依赖数组位置。
- [混用 React 18/19 与宿主运行体] → 不新增依赖，沿用各包现有 React 工具链，运行各包 typecheck/build 与相关测试。
- [旧宿主不显示自定义图标] → 明确降级为默认齿轮，保留设置页面，不维护旧 DOM fallback。
- [浏览器缓存旧客户端] → 构建后检查部署 bundle，刷新现有 GUI 验证；未实际浏览器验收不得声称已视觉通过。

## Migration Plan

先实现/验证四个客户端与测试，再合并 delta 至当前 specs。执行相关 package 测试、typecheck、build，严格 OpenSpec 校验与 tracked artifacts 检查。计划呈现后，用户已通过“开始实施”确认，按此计划实施。实施完成后从主 checkout 执行 dsh build 并连续再跑一次检查幂等，不重启 Host。回滚仅恢复本次客户端与规范变更后重新构建，用户数据不迁移。
