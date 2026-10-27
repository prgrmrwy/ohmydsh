# 可判定性 lint

逐条检查oracle，不合格项保留并标FLAG，不能为提高通过率丢弃。

- 条件是否给定：角色、数据、入口和前置是否足够复现？缺URL可标needs-input，但不得推断权限。
- 输入是否为可执行动作，而不是“正常使用”？
- expected是否客观：可见文字、DOM属性、URL、请求或明确视觉基准？“体验好/正常/漂亮”不可直接自动判定。
- 粒度是否一条结论：多编号项拆分；宿主/remote/后端等不同契约层不混判。
- 实现/diff不是oracle。只能补WHERE的地方写reviewer_notes，expected_source=implementation时标expected_unverified。
- 工具动作成功不等于业务后果；点击/输入后必须有可观测后果与回读。

产出lint_pass_rate、FLAG列表、manual/partial/visual_inspect降级列表。无结构化来源或通过率低于80%，说明不可给自动验收资格。阶段1展示后等用户确认，影响仅限有问题的检查点，不用一个局部缺口整体堵住其他独立范围。
