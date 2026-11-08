## 1. 官方槽迁移

- [x] 1.1 将 Pet 爪印迁移为 settings.section.icon 的 dsh-pet 贡献，移除旧 observer/marker/CSS；以 Pet 客户端回归测试及 typecheck/build 验证图案、size 和入口不变。
- [x] 1.2 将 Memex 书本迁移为 settings.section.icon 的 dsh-memex 贡献，删除样式中的 marker/伪元素；以 Memex 客户端测试及 typecheck/build 验证单色继承与页面注册。
- [x] 1.3 将 Magpie 鸟形迁移为 settings.section.icon 的 dsh-magpie-connector 贡献，复用许可资源且移除旧 DOM 适配；以 Magpie 测试及 typecheck/build 验证同名其它行不受影响。
- [x] 1.4 将 AUTO E 字形迁移为 settings.section.icon 的 auto-model-routing 贡献，移除旧图标专用 observer/样式；以 AUTO 测试及 typecheck/build 验证页面和芯片注册不变。

## 2. 生命周期与集成回归

- [x] 2.1 更新所有受新增注册影响的 mock，按 name/id 选择 section 而非数组位置；运行四包相关客户端测试验证未破坏现有入口。
- [x] 2.2 使用已安装官方 slots/renderer 证明 span 包装下同 id 图标替换默认字形，未匹配 id 保持默认，卸载/重载后只有一个贡献；缺图标槽时 section 仍注册且无 DOM fallback，以集成测试通过为准。
- [x] 2.3 检查中英文、深浅主题、选中态与宿主 size，确认四行各一个原图标，导航标签与点击不变；浏览器检查若无法执行则明确记录为未验收，不以 jsdom 冒充视觉通过。（已通过真实注册器 + jsdom 的中英文、主题属性、选中/点击、size 检查；自动真实 GUI 视觉未验收：agent-browser 不可用，当前无 Chrome MCP；部署后用户手动查看并反馈“看起来可以了”，随后授权归档提交推送。）

## 3. 规范与部署验证

- [x] 3.1 将本 change 的 delta 合并至 current specs，核对修改要求只涉及导航图标；执行 openspec validate migrate-settings-navigation-icons --strict 验证。
- [x] 3.2 对最终快照运行四包相关测试、typecheck/build、npm run check:artifacts，并审阅完整 diff，确认没有旧设置图标 DOM 适配、用户数据/Host 行为改动或新依赖。
- [x] 3.3 经新的 apply 请求实施完成后，从主 checkout 执行 dsh build，连续第二次验证无变化，确认部署客户端含官方图标槽且不含旧图标 marker；不重启、不提交、不发布或推送，记录实际验证结果。
