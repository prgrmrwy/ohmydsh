## Test Plan

评审门槛：第 4 轮 APPROVE_WITH_CHANGES，定向复核 CHANGES_APPLIED: yes。🟢 表示同名测试存在且在 2026-10-29 全量运行中通过（见 verify.md）。

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 官方工具创建的子会话受管 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "官方工具创建的子会话受管"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 插件直接创建的子会话原样放行 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "插件直接创建的子会话原样放行"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | MANUAL 时创建的子会话在切到 AUTO 后仍放行 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "MANUAL 时创建的子会话在切到 AUTO 后仍放行"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | fork 子会话与父会话一致 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "fork 子会话与父会话一致"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 孙会话以直接父会话为锚 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "孙会话以直接父会话为锚"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 创建期间根会话离开 AUTO 则不受管 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "创建期间根会话离开 AUTO 则不受管"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 恢复通知不重写已有绑定 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "恢复通知不重写已有绑定"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 工具窗口外创建的插件子会话不被接管 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "工具窗口外创建的插件子会话不被接管"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 同窗口同父插件旁支一并受管且如实说明 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "同窗口同父插件旁支一并受管且如实说明"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | provider 与父配置在绑定边界同步采样 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "provider 与父配置在绑定边界同步采样"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 新初始记录缺少父快照被拒 | `packages/auto-model-routing/test/policy-store.test.ts` | `spec Scenario "新初始记录缺少父快照被拒"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 受管子会话范围 | 受管子会话完整性问题仍拒绝 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "受管子会话完整性问题仍拒绝"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 能力槽可用时按能力选模 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "能力槽可用时按能力选模"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | provider 没有能力槽模型时保持父模型 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "provider 没有能力槽模型时保持父模型"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 父模型不在允许列表时不改写 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "父模型不在允许列表时不改写"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | depth effort 不可得时用父会话 effort | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "depth effort 不可得时用父会话 effort"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 父会话 effort 也不可用时不改写并告警 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "父会话 effort 也不可用时不改写并告警"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 子任务 Jev 失败不改写 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "子任务 Jev 失败不改写"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 显式维度不可用时不替换 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "显式维度不可用时不替换"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 只显式 effort 时能力槽须支持该 effort | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "只显式 effort 时能力槽须支持该 effort"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 不改写的记录在重启后不重判 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "不改写的记录在重启后不重判"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 矛盾的记录组合被拒绝 | `packages/auto-model-routing/test/policy-store.test.ts` | `spec Scenario "矛盾的记录组合被拒绝"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 冷恢复时初始决策中断 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "冷恢复时初始决策中断"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 已有 route 实时门禁失败仍拒绝 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "已有 route 实时门禁失败仍拒绝"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由退化链 | 子判断期间模式往返使旧结果失效 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "子判断期间模式往返使旧结果失效"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务未路由告警 | 未路由告警可见且只提示一次 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "未路由告警可见且只提示一次"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务未路由告警 | 告警不泄漏任务文本且开关关闭不弹出 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "告警不泄漏任务文本且开关关闭不弹出"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话不显示 AUTO 芯片 | 子会话不渲染芯片且停止轮询 | `packages/auto-model-routing/test/child-chip.dom.test.ts` | `spec Scenario "子会话不渲染芯片且停止轮询"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话不显示 AUTO 芯片 | 带旧 AUTO 状态的子会话不被改写 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "带旧 AUTO 状态的子会话不被改写"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话不显示 AUTO 芯片 | 状态读取失败的普通会话保持原行为 | `packages/auto-model-routing/test/child-chip.dom.test.ts` | `spec Scenario "状态读取失败的普通会话保持原行为"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | 内置注册表可构造且不含 provider 知识 | `packages/auto-model-routing/test/strategies.test.ts` | `spec Scenario "内置注册表可构造且不含 provider 知识"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | 冲突的注册表拒绝构造 | `packages/auto-model-routing/test/strategies.test.ts` | `spec Scenario "冲突的注册表拒绝构造"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | effort 起点按模型名查找且保持原结果 | `packages/auto-model-routing/test/strategies.test.ts` | `spec Scenario "effort 起点按模型名查找且保持原结果"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | effort 边界保持原结果 | `packages/auto-model-routing/test/strategies.test.ts` | `spec Scenario "effort 边界保持原结果"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | 新增家族只需新增策略 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "新增家族只需新增策略"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | 记录中的家族已不在注册表 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "记录中的家族已不在注册表"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | 家族知识只有一个来源 | `packages/auto-model-routing/test/content.test.ts` | `spec Scenario "家族知识只有一个来源"` | 🟢 green |
| specs/auto-model-routing/spec.md → 模型家族策略注册表 | 未登记的 provider 不被枚举拒绝 | `packages/auto-model-routing/test/subagent-tool.test.ts` | `spec Scenario "未登记的 provider 不被枚举拒绝"` | 🟢 green |
| specs/auto-model-routing/spec.md → 内置模型家族策略 | 内置子路由与原行为一致 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "内置子路由与原行为一致"` | 🟢 green |
| specs/auto-model-routing/spec.md → 内置模型家族策略 | 能力槽只在父 provider 内解析 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "能力槽只在父 provider 内解析"` | 🟢 green |
| specs/auto-model-routing/spec.md → 内置模型家族策略 | 能力槽须与父模型前缀相同 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "能力槽须与父模型前缀相同"` | 🟢 green |
| specs/auto-model-routing/spec.md → 手动隔离与失败可见 | AUTO 不改主 provider/model | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "AUTO 不改主 provider/model"` | 🟢 green |
| specs/auto-model-routing/spec.md → 手动隔离与失败可见 | 子失败不换模且可见 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "子失败不换模且可见"` | 🟢 green |
| specs/auto-model-routing/spec.md → Magpie 兼容不扩大权限与能力范围 | GPT 主子保持同 transport 及支持的 effort | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "GPT 主子保持同 transport 及支持的 effort"` | 🟢 green |
| specs/auto-model-routing/spec.md → Magpie 兼容不扩大权限与能力范围 | 更新全局目录不能扩大父 captured allowlist | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "更新全局目录不能扩大父 captured allowlist"` | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 各状态码映射为闭集类别 | `packages/auto-model-routing/test/host.integration.test.ts` | `spec Scenario "各状态码映射为闭集类别"` | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 停用后不再调用 Jev 且不改写 | `packages/auto-model-routing/test/host.integration.test.ts` | `spec Scenario "停用后不再调用 Jev 且不改写"` | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户重新点 AUTO 清除停用 | `packages/auto-model-routing/test/host.integration.test.ts` | `spec Scenario "用户重新点 AUTO 清除停用"` | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户取消不是失败 | `packages/auto-model-routing/test/host.integration.test.ts` | `spec Scenario "用户取消不是失败"` | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 凭据与响应体不泄漏 | `packages/auto-model-routing/test/host.integration.test.ts` | `spec Scenario "凭据与响应体不泄漏"` | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 子任务判断失败不停用根会话 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "子任务判断失败不停用根会话"` | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | 无效会话被拒绝且无副作用 | `packages/auto-model-routing/test/endpoints.test.ts` | `spec Scenario "无效会话被拒绝且无副作用"` | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | 只修改目标会话 | `packages/auto-model-routing/test/endpoints.test.ts` | `spec Scenario "只修改目标会话"` | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | label 响应以绑定是否存在区分 | `packages/auto-model-routing/test/label-button.dom.test.ts` | `spec Scenario "label 响应以绑定是否存在区分"` | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | 子会话状态返回不适用 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "子会话状态返回不适用"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话派发时机写入环境级指令 | 环境级指令含派发规则且不含模型名 | `tests/agent-instructions-dispatch.test.mjs` | `spec Scenario "环境级指令含派发规则且不含模型名"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话派发时机写入环境级指令 | 指令不要求把预览结果当显式参数 | `tests/agent-instructions-dispatch.test.mjs` | `spec Scenario "指令不要求把预览结果当显式参数"` | 🟢 green |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | 干净安装获得唯一 skill | `packages/auto-model-routing/test/bundled-skill.integration.test.ts` | `spec Scenario "干净安装获得唯一 skill"` | 🟢 green |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | skill 只含当前用法 | `packages/auto-model-routing/test/content.test.ts` | `spec Scenario "skill 只含当前用法"` | 🟢 green |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | 旧部署迁移无重复来源 | `tests/auto-model-routing-sync.test.mjs` | `spec Scenario "旧部署迁移无重复来源"` | 🟢 green |
| specs/auto-model-routing/spec.md → 插件安装自包含配套 skill | 插件禁用撤销 skill 与工具 | `tests/auto-model-routing-sync.test.mjs` | `spec Scenario "插件禁用撤销 skill 与工具"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 切换到不支持的主模型自动锁定 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "切换到不支持的主模型自动锁定"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 不支持模型的请求不再导致整轮失败 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "不支持模型的请求不再导致整轮失败"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 芯片锁定态与悬停提示 | `packages/auto-model-routing/test/lock.dom.test.ts` | `spec Scenario "芯片锁定态与悬停提示"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 切回受支持模型后恢复可切换 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "切回受支持模型后恢复可切换"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 支持范围判定只依据注册表 | `packages/auto-model-routing/test/routing.test.ts` | `spec Scenario "支持范围判定只依据注册表"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 主模型支持范围与不可用锁定 | 支持范围内映射不可得不阻断请求 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "支持范围内映射不可得不阻断请求"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | Magpie 自动子路由 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "Magpie 自动子路由"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 决策与执行 | 未登记 provider 的 GPT 主会话可以派子任务 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "未登记 provider 的 GPT 主会话可以派子任务"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由预览工具 | AUTO 下返回推荐且保留显式维度 | `packages/auto-model-routing/test/subagent-tool.test.ts` | `spec Scenario "AUTO 下返回推荐且保留显式维度"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由预览工具 | MANUAL 与不可用路由 | `packages/auto-model-routing/test/subagent-tool.test.ts` | `spec Scenario "MANUAL 与不可用路由"` | 🟢 green |
| specs/auto-model-routing/spec.md → 子任务路由预览工具 | 预览失败与取消的区分 | `packages/auto-model-routing/test/subagent-tool.test.ts` | `spec Scenario "预览失败与取消的区分"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 的双 Magpie 精确 transport 兼容 | 新旧 Magpie 子实例保持精确身份并恢复 | `packages/auto-model-routing/test/policy-host.integration.test.ts` | `spec Scenario "新旧 Magpie 子实例保持精确身份并恢复"` | 🟢 green |
| specs/auto-model-routing/spec.md → AUTO 的双 Magpie 精确 transport 兼容 | 未注册家族的 Magpie 模型需显式模型与可验证 effort | `packages/auto-model-routing/test/subagent-tool.test.ts` | `spec Scenario "未注册家族的 Magpie 模型需显式模型与可验证 effort"` | 🟢 green |

## Coverage Notes

- 测试名统一为 `spec Scenario "<场景名>"`（参数化场景带后缀）；一个测试文件中的同名测试即该行的命名测试。
- 「同窗口同父插件旁支一并受管且如实说明」：离线测试宿主没有 subagents 服务，旁支用窗口内 `agents.create` 构造，只覆盖 fresh `spawn_teammate` 路径；`subagents.startContinuable` 旁支的同等行为由 `scripts/probe-managed-identity.mjs` 在真实官方包上证实其满足绑定条件（未进入模型请求）。
- 「已有 route 实时门禁失败仍拒绝」覆盖 effort 上限降低与目录不可用（各含重启）；允许列表撤销由 `routeUsable` 单元路径覆盖，测试宿主的允许列表服务为固定注入。
- 「恢复通知不重写已有绑定」以在工具窗口内补发 `source: resume` 的 `agent/created` 模拟恢复通知。
- 覆盖：74/74。
