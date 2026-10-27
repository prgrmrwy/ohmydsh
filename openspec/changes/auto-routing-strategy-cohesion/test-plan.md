## Test Plan

Every scenario in `specs/` maps to one named test. The test name is the literal string `spec Scenario "<scenario name>"` and appears in the vitest/node:test title, so the mapping can be checked mechanically by name. Paths are relative to the repository root.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 新旧记录并存 | packages/auto-model-routing/test/feedback.test.ts | spec Scenario "新旧记录并存" | 🔴 red |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 新旧事件格式混读 | packages/auto-model-routing/test/feedback.test.ts | spec Scenario "新旧事件格式混读" | 🔴 red |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 修改撤销 | packages/auto-model-routing/test/label-button.dom.test.ts | spec Scenario "修改撤销" | 🔴 red — carried forward; regression |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 手动及新回合隔离 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "手动及新回合隔离" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 家族策略注册表 | 内置注册表可构造且允许跨 provider 共用前缀 | packages/auto-model-routing/test/strategies.test.ts | spec Scenario "内置注册表可构造且允许跨 provider 共用前缀" | 🔴 red |
| specs/auto-model-routing/spec.md → 家族策略注册表 | 冲突的注册表拒绝构造 | packages/auto-model-routing/test/strategies.test.ts | spec Scenario "冲突的注册表拒绝构造" | 🔴 red |
| specs/auto-model-routing/spec.md → 家族策略注册表 | effort 起点按模型名查找且保持原结果 | packages/auto-model-routing/test/strategies.test.ts | spec Scenario "effort 起点按模型名查找且保持原结果" | 🔴 red |
| specs/auto-model-routing/spec.md → 家族策略注册表 | effort 边界保持原结果 | packages/auto-model-routing/test/strategies.test.ts | spec Scenario "effort 边界保持原结果" | 🔴 red |
| specs/auto-model-routing/spec.md → 家族策略注册表 | 新增家族只需新增策略 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "新增家族只需新增策略" | 🔴 red |
| specs/auto-model-routing/spec.md → 家族策略注册表 | 记录中的家族已不在注册表 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "记录中的家族已不在注册表" | 🔴 red |
| specs/auto-model-routing/spec.md → 家族策略注册表 | 家族知识只有一个来源 | packages/auto-model-routing/test/content.test.ts | spec Scenario "家族知识只有一个来源" | 🔴 red |
| specs/auto-model-routing/spec.md → 内置家族策略 | 内置子路由与原行为一致 | packages/auto-model-routing/test/routing.test.ts | spec Scenario "内置子路由与原行为一致" | 🔴 red |
| specs/auto-model-routing/spec.md → 内置家族策略 | 未给出家族且 provider 有多个家族时不猜测 | packages/auto-model-routing/test/subagent-tool.test.ts | spec Scenario "未给出家族且 provider 有多个家族时不猜测" | 🔴 red |
| specs/auto-model-routing/spec.md → 无策略版本 | 新写入不含版本字段 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "新写入不含版本字段" | 🔴 red |
| specs/auto-model-routing/spec.md → 无策略版本 | 旧绑定的 label 响应不暴露历史版本键 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "旧绑定的 label 响应不暴露历史版本键" | 🔴 red |
| specs/auto-model-routing/spec.md → 无策略版本 | 源码与文案不含版本 | packages/auto-model-routing/test/package-output.test.ts | spec Scenario "源码与文案不含版本" | 🔴 red |
| specs/auto-model-routing/spec.md → 无策略版本 | 旧子会话记录恢复不比较版本 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "旧子会话记录恢复不比较版本" | 🔴 red |
| specs/auto-model-routing/spec.md → 旧配置与旧记录只读兼容 | 旧映射配置不影响路由并在保存时移除 | packages/auto-model-routing/test/settings.test.ts | spec Scenario "旧映射配置不影响路由并在保存时移除" | 🔴 red |
| specs/auto-model-routing/spec.md → 旧配置与旧记录只读兼容 | 提交旧映射字段被拒 | packages/auto-model-routing/test/settings.test.ts | spec Scenario "提交旧映射字段被拒" | 🔴 red |
| specs/auto-model-routing/spec.md → 旧配置与旧记录只读兼容 | 旧判档账本不再增长且标注参数被拒 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "旧判档账本不再增长且标注参数被拒" | 🔴 red |
| specs/auto-model-routing/spec.md → 旧配置与旧记录只读兼容 | 决策记录只容忍已知的历史键 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "决策记录只容忍已知的历史键" | 🔴 red |
| specs/auto-model-routing/spec.md → 旧配置与旧记录只读兼容 | 绑定标记存在但记录缺失或损坏 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "绑定标记存在但记录缺失或损坏" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由预览工具 | AUTO 下返回推荐且保留显式维度 | packages/auto-model-routing/test/subagent-tool.test.ts | spec Scenario "AUTO 下返回推荐且保留显式维度" | 🔴 red |
| specs/auto-model-routing/spec.md → 子任务路由预览工具 | MANUAL 与不可用路由 | packages/auto-model-routing/test/subagent-tool.test.ts | spec Scenario "MANUAL 与不可用路由" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 的双 Magpie 精确 transport 兼容 | 新旧 Magpie 子实例保持精确身份并恢复 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "新旧 Magpie 子实例保持精确身份并恢复" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 的双 Magpie 精确 transport 兼容 | 未注册家族的 Magpie 模型需显式模型与可验证 effort | packages/auto-model-routing/test/subagent-tool.test.ts | spec Scenario "未注册家族的 Magpie 模型需显式模型与可验证 effort" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 步骤被拒时不请求 Jev | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "步骤被拒时不请求 Jev" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 首轮真实领取序列只取用户消息 | packages/auto-model-routing/test/input.test.ts | spec Scenario "首轮真实领取序列只取用户消息" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 多条用户消息按序拼接并截断 | packages/auto-model-routing/test/input.test.ts | spec Scenario "多条用户消息按序拼接并截断" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 同回合与重试复用决定 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "同回合与重试复用决定" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 非用户回合沿用上一 depth | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "非用户回合沿用上一 depth" | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与 Jev 输入 | 子会话不走主会话判断 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "子会话不走主会话判断" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 请求内容受限 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "请求内容受限" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 上一轮上下文截断、取末段并脱敏 | packages/auto-model-routing/test/context.test.ts | spec Scenario "上一轮上下文截断、取末段并脱敏" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 脱敏覆盖常见形态且不误伤正文 | packages/auto-model-routing/test/context.test.ts | spec Scenario "脱敏覆盖常见形态且不误伤正文" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 首个用户回合不带上一轮上下文 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "首个用户回合不带上一轮上下文" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 等待期间切换模式丢弃结果 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "等待期间切换模式丢弃结果" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 不跟随重定向 | packages/auto-model-routing/test/jev.test.ts | spec Scenario "不跟随重定向" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 源码不含本地分类与其它出站 | packages/auto-model-routing/test/content.test.ts | spec Scenario "源码不含本地分类与其它出站" | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 凭据从存储读取且换 key 立即生效 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "凭据从存储读取且换 key 立即生效" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 期限按设置生效 | packages/auto-model-routing/test/jev.test.ts | spec Scenario "期限按设置生效" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 芯片与状态面板 | 芯片注册在速度芯片左侧 | packages/auto-model-routing/test/client.test.ts | spec Scenario "芯片注册在速度芯片左侧" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 芯片与状态面板 | 面板展示本回合状态且无历史 | packages/auto-model-routing/test/client.test.ts | spec Scenario "面板展示本回合状态且无历史" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 芯片与状态面板 | 停用状态在芯片与面板可见 | packages/auto-model-routing/test/client.test.ts | spec Scenario "停用状态在芯片与面板可见" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 芯片与状态面板 | 悬停面板显示最近一次决策分布 | packages/auto-model-routing/test/client.test.ts | spec Scenario "悬停面板显示最近一次决策分布" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 芯片与状态面板 | 芯片样式与悬停面板 | packages/auto-model-routing/test/client.test.ts | spec Scenario "芯片样式与悬停面板" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 芯片与状态面板 | 切换模式只调用插件接口 | packages/auto-model-routing/test/client.test.ts | spec Scenario "切换模式只调用插件接口" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 决策提示 | 主会话判断提示 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "主会话判断提示" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 子任务判断提示 | packages/auto-model-routing/test/toast.dom.test.ts | spec Scenario "子任务判断提示" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 主决策在请求前后的状态 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "主决策在请求前后的状态" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 完全显式的子任务决策可见 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "完全显式的子任务决策可见" | 🔴 red |
| specs/auto-model-routing/spec.md → 决策提示 | 开关关闭或判断失败不提示 | packages/auto-model-routing/test/toast.dom.test.ts | spec Scenario "开关关闭或判断失败不提示" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 决策提示 | 提示只显示一次且 3 秒消失 | packages/auto-model-routing/test/toast.dom.test.ts | spec Scenario "提示只显示一次且 3 秒消失" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 保存普通设置 | packages/auto-model-routing/test/settings.test.ts | spec Scenario "保存普通设置" | 🔴 red |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 非法设置整体拒绝 | packages/auto-model-routing/test/settings.test.ts | spec Scenario "非法设置整体拒绝" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 设置文件损坏 | packages/auto-model-routing/test/settings.test.ts | spec Scenario "设置文件损坏" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 策略说明来自规则文件与注册表 | packages/auto-model-routing/test/settings-section.dom.test.ts | spec Scenario "策略说明来自规则文件与注册表" | 🔴 red |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | key 的只读来源与迁移 | packages/auto-model-routing/test/settings-host.test.ts | spec Scenario "key 的只读来源与迁移" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 独立保存结果与不泄漏 | packages/auto-model-routing/test/settings-section.dom.test.ts | spec Scenario "独立保存结果与不泄漏" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 导航图标只作用于本区块 | packages/auto-model-routing/test/nav-icon.dom.test.ts | spec Scenario "导航图标只作用于本区块" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | Magpie 自动子路由 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "Magpie 自动子路由" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 同次主请求同步官方 effort 与 defaults | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "同次主请求同步官方 effort 与 defaults" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 同步失败不丢本次请求 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "同步失败不丢本次请求" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 手动与子请求不污染默认 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "手动与子请求不污染默认" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主 effort 同步官方选择 | 异步解析期间切 MANUAL 不覆盖主请求 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "异步解析期间切 MANUAL 不覆盖主请求" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 模式与改写规则 | MANUAL 请求原样通过 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "MANUAL 请求原样通过" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 只改 effort | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "AUTO 只改 effort" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 切回 MANUAL 不复原 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "切回 MANUAL 不复原" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 结果同步到官方选择 | packages/auto-model-routing/test/selection.integration.test.ts | spec Scenario "AUTO 结果同步到官方选择" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 判档覆盖待生效手选 | packages/auto-model-routing/test/selection.integration.test.ts | spec Scenario "AUTO 判档覆盖待生效手选" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 快速切回 AUTO 不恢复旧决定 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "快速切回 AUTO 不恢复旧决定" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 重复同模式设置无副作用 | packages/auto-model-routing/test/state.test.ts | spec Scenario "重复同模式设置无副作用" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 旧状态文件可读 | packages/auto-model-routing/test/state.test.ts | spec Scenario "旧状态文件可读" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 新会话按默认模式创建 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "新会话按默认模式创建" | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 修改默认模式不影响已有会话 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "修改默认模式不影响已有会话" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 各状态码映射为闭集类别 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "各状态码映射为闭集类别" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 停用后不再调用 Jev 且不改写 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "停用后不再调用 Jev 且不改写" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户重新点 AUTO 清除停用 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "用户重新点 AUTO 清除停用" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户取消不是失败 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "用户取消不是失败" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 凭据与响应体不泄漏 | packages/auto-model-routing/test/host.integration.test.ts | spec Scenario "凭据与响应体不泄漏" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Host 端点边界 | 无效会话被拒绝且无副作用 | packages/auto-model-routing/test/endpoints.test.ts | spec Scenario "无效会话被拒绝且无副作用" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Host 端点边界 | 只修改目标会话 | packages/auto-model-routing/test/endpoints.test.ts | spec Scenario "只修改目标会话" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → Host 端点边界 | label 响应以绑定是否存在区分 | packages/auto-model-routing/test/label-button.dom.test.ts | spec Scenario "label 响应以绑定是否存在区分" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 切换到不支持的主模型自动锁定 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "切换到不支持的主模型自动锁定" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 不支持模型的请求不再导致整轮失败 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "不支持模型的请求不再导致整轮失败" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 芯片锁定态与悬停提示 | packages/auto-model-routing/test/lock.dom.test.ts | spec Scenario "芯片锁定态与悬停提示" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 切回受支持模型后恢复可切换 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "切回受支持模型后恢复可切换" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 支持范围判定只依据注册表 | packages/auto-model-routing/test/routing.test.ts | spec Scenario "支持范围判定只依据注册表" | 🔴 red |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 支持范围内映射不可得不阻断请求 | packages/auto-model-routing/test/policy-host.integration.test.ts | spec Scenario "支持范围内映射不可得不阻断请求" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | 干净安装获得唯一 skill | packages/auto-model-routing/test/bundled-skill.integration.test.ts | spec Scenario "干净安装获得唯一 skill" | 🔴 red — carried forward; regression |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | skill 只含当前用法 | packages/auto-model-routing/test/content.test.ts | spec Scenario "skill 只含当前用法" | 🔴 red |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | 旧部署迁移无重复来源 | tests/auto-model-routing-sync.test.mjs | spec Scenario "旧部署迁移无重复来源" | 🔴 red |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | 插件禁用撤销 skill 与工具 | tests/auto-model-routing-sync.test.mjs | spec Scenario "插件禁用撤销 skill 与工具" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 输出白名单与错误不回显 | 损坏数据中的正文与路径不泄漏 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "损坏数据中的正文与路径不泄漏" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 账本关联 | 只计已绑定消息 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "只计已绑定消息" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 账本关联 | 同一决策跨多个请求 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "同一决策跨多个请求" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 分组与用量字段 | 缺失字段与部分出现 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "缺失字段与部分出现" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 分组与用量字段 | 缺快照记录独立成组 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "缺快照记录独立成组" | 🔴 red |
| specs/auto-routing-usage-report/spec.md → 覆盖与可见性 | 无请求头的缺口回合可见 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "无请求头的缺口回合可见" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 覆盖与可见性 | 无记录的 AUTO 会话 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "无记录的 AUTO 会话" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 覆盖与可见性 | 不带版本字段的绑定同样计入覆盖 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "不带版本字段的绑定同样计入覆盖" | 🔴 red |
| specs/auto-routing-usage-report/spec.md → 前后 effort 起点参照 | 旧版 AUTO 回合不算作参照 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "旧版 AUTO 回合不算作参照" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 前后 effort 起点参照 | 参照只含 effort 分布 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "参照只含 effort 分布" | 🔴 red — carried forward; regression |
| specs/auto-routing-usage-report/spec.md → 前后 effort 起点参照 | 不带版本字段的绑定确定同一分界 | packages/auto-model-routing/test/usage-report.test.ts | spec Scenario "不带版本字段的绑定确定同一分界" | 🔴 red |

## Coverage Notes

- **104 scenarios, 104 rows, none unmapped.** REMOVED requirements have no scenarios, and their tests are deleted with them (design D4). The tests deleted along with legacy are: `router.test.ts`, `label-report.test.ts`, `eval-runner.test.ts`, `route-picker.dom.test.ts`, `settings-states.dom.test.ts`, the tier cases in `effort.test.ts`, the mapping cases in `settings.test.ts` and `settings-section.dom.test.ts`, the legacy cases in `host.integration.test.ts`, and the legacy branches in `subagent-tool.test.ts` and `policy-host.integration.test.ts`.
- **What "carried forward; regression" means:** the behavior is unchanged, and an existing test already covers it, but that test's title does not yet carry the `spec Scenario "…"` name, or it still writes `policy: legacy`, asserts version fields, or is built on the deleted Router harness. During apply, rename these tests or move them onto the default-chain harness. **Expected values must stay the same.** They count as green only after renaming or migration, once they pass.
- **Equivalence oracle:** the expected values in "effort 起点按模型名查找且保持原结果", "effort 边界保持原结果" and "内置子路由与原行为一致" come from the 0.4.1 build output `packages/auto-model-routing/lib/policy-v2.js`, measured before this change (2026-10-28). Before apply starts, run the same inputs against `lib/` once more and save the results as the fixture `test/fixtures/routing-oracle-0.4.1.json`. The new tests read the expected values only from this fixture and never compute them again.
- **New test files:** `strategies.test.ts` (registry construction and lookup), `routing.test.ts` (renamed from `policy-v2.test.ts`), `package-output.test.ts`. The last one copies the package into a temporary directory, places the 0.4.1 legacy artifacts into `lib/`, runs `npm run build` and `npm pack --dry-run --json`, and checks the file list. It needs no network and does not write to the repository working tree.
- **Synthetic strategy injection:** `apply(ctx, { strategies })` (design D2). Tests for "新增家族只需新增策略" and "记录中的家族已不在注册表" use it to inject `deepseek` into the real AgentLoop harness of `policy-host.integration.test.ts` and restart it once. The assertion "no source changes outside the registry" is checked by the test: `git diff --name-only` against the build input of the same commit must not change. Equivalently, the test passes without modifying `src/`.
- **Root tests:** `tests/auto-model-routing-sync.test.mjs` covers "旧部署迁移无重复来源" and "插件禁用撤销 skill 与工具". Its manifest version changes to 0.5.0 along with the package. `tests/agent-instructions-dispatch.test.mjs` (environment-level instructions, out of scope) must stay green without modification.
- **Mechanical checks outside the ledger (not scenarios):** `npm run build`, `npm run typecheck` (if present), and `npm test` inside the package; `npm test` and `npm run check:artifacts` at the root; `openspec validate auto-routing-strategy-cohesion` (non-strict exits 0; strict exits 1 only because of requirement-length warnings and is reported truthfully); after archive, a scan of the merged main spec Purpose (design Risks / review M2).
