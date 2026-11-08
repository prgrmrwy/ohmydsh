## Test Plan

所有路径都相对于 `packages/dsh-auto-model-routing/`。测试名沿用包内惯例 `spec Scenario "<场景名>"`，方便用 grep 追溯到 spec。

状态说明：
- 🔴 red：新增的场景，或 THEN 有改动的既有场景。实施前必须先写出测试，并且确认它因为正确的原因失败。
- 🟢 existing：既有场景，THEN 没有改。直接用现有测试做回归，实施期间必须一直保持通过。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/auto-model-routing/spec.md → 判档预设注册表 | 内置预设满足注册表约束 | test/presets.test.ts | spec Scenario "内置预设满足注册表约束" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设注册表 | 约束检查能发现不合格预设 | test/presets.test.ts | spec Scenario "约束检查能发现不合格预设" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设发布后不可变 | 内置预设与锁定表一致 | test/presets.test.ts | spec Scenario "内置预设与锁定表一致" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设发布后不可变 | 内容漂移使锁定测试失败 | test/presets.test.ts | spec Scenario "内容漂移使锁定测试失败" | 🟢 green |
| specs/auto-model-routing/spec.md → 内置判档预设 | 缺省预设与变更前规则逐字节相同 | test/presets.test.ts | spec Scenario "缺省预设与变更前规则逐字节相同" | 🟢 green |
| specs/auto-model-routing/spec.md → 内置判档预设 | 每个内置预设都有文档 | test/presets.test.ts | spec Scenario "每个内置预设都有文档" | 🟢 green |
| specs/auto-model-routing/spec.md → effort-as-verification 判断内容 | 新预设文本含关键分界 | test/presets.test.ts | spec Scenario "新预设文本含关键分界" | 🟢 green |
| specs/auto-model-routing/spec.md → effort-as-verification 判断内容 | 新预设不改变引擎档位 | test/preset-sampling.integration.test.ts | spec Scenario "新预设不改变引擎档位" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 主判断进行中切换预设 | test/preset-sampling.integration.test.ts | spec Scenario "主判断进行中切换预设" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 子任务在创建后、首次判断前切换预设 | test/preset-sampling.integration.test.ts | spec Scenario "子任务在创建后、首次判断前切换预设" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 预览进行中切换预设 | test/preset-sampling.integration.test.ts | spec Scenario "预览进行中切换预设" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 预览与 fresh 子任务独立采样 | test/preset-sampling.integration.test.ts | spec Scenario "预览与 fresh 子任务独立采样" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 非用户回合不重判 | test/preset-sampling.integration.test.ts | spec Scenario "非用户回合不重判" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设的采样与归属 | 测试连接使用所选预设 | test/settings-host.test.ts | spec Scenario "测试连接使用所选预设" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设评估脚本 | 未知预设提前拒绝 | test/eval-live.test.ts | spec Scenario "未知预设提前拒绝" | 🟢 green |
| specs/auto-model-routing/spec.md → 判档预设评估报告 | 报告记录实验条件 | test/eval-live.test.ts | spec Scenario "报告记录实验条件" | 🟢 green |
| specs/auto-model-routing/spec.md → 无策略版本 | 新写入不含版本字段 | test/policy-host.integration.test.ts | spec Scenario "新写入不含版本字段" | 🟢 existing |
| specs/auto-model-routing/spec.md → 无策略版本 | 旧绑定的 label 响应不暴露历史版本键 | test/host.integration.test.ts | spec Scenario "旧绑定的 label 响应不暴露历史版本键" | 🟢 existing |
| specs/auto-model-routing/spec.md → 无策略版本 | 源码与文案不含版本 | test/package-output.test.ts | spec Scenario "源码与文案不含版本" | 🟢 green |
| specs/auto-model-routing/spec.md → 无策略版本 | 旧子会话记录恢复不比较版本 | test/policy-host.integration.test.ts | spec Scenario "旧子会话记录恢复不比较版本" | 🟢 existing |
| specs/auto-model-routing/spec.md → 无策略版本 | 切换预设不改变已绑定子任务与已作出的决定 | test/preset-sampling.integration.test.ts | spec Scenario "切换预设不改变已绑定子任务与已作出的决定" | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 请求内容受限 | test/host.integration.test.ts | spec Scenario "请求内容受限" | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 上一轮上下文截断、取末段并脱敏 | test/context.test.ts | spec Scenario "上一轮上下文截断、取末段并脱敏" | 🟢 existing |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 脱敏覆盖常见形态且不误伤正文 | test/context.test.ts | spec Scenario "脱敏覆盖常见形态且不误伤正文" | 🟢 existing |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 首个用户回合不带上一轮上下文 | test/host.integration.test.ts | spec Scenario "首个用户回合不带上一轮上下文" | 🟢 existing |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 启用 execution 的预设加入固定行 | test/preset-sampling.integration.test.ts | spec Scenario "启用 execution 的预设加入固定行" | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 自主主任务不被断言为逐条复核 | test/preset-sampling.integration.test.ts | spec Scenario "自主主任务不被断言为逐条复核" | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 设置中的未知预设回落到缺省预设 | test/preset-sampling.integration.test.ts | spec Scenario "设置中的未知预设回落到缺省预设" | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 等待期间切换模式丢弃结果 | test/host.integration.test.ts | spec Scenario "等待期间切换模式丢弃结果" | 🟢 existing |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 不跟随重定向 | test/jev.test.ts | spec Scenario "不跟随重定向" | 🟢 existing |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 源码不含本地分类与其它出站 | test/content.test.ts | spec Scenario "源码不含本地分类与其它出站" | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 凭据从存储读取且换 key 立即生效 | test/host.integration.test.ts | spec Scenario "凭据从存储读取且换 key 立即生效" | 🟢 existing |
| specs/auto-model-routing/spec.md → Jev 判断请求与脱敏 | 期限按设置生效 | test/jev.test.ts | spec Scenario "期限按设置生效" | 🟢 existing |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 保存普通设置 | test/settings.test.ts | spec Scenario "保存普通设置" | 🟢 existing |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 非法设置整体拒绝 | test/settings.test.ts | spec Scenario "非法设置整体拒绝" | 🟢 green |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 设置文件损坏 | test/settings.test.ts | spec Scenario "设置文件损坏" | 🟢 green |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 选择并保存判档预设 | test/settings-section.dom.test.ts | spec Scenario "选择并保存判档预设" | 🟢 green |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 策略说明来自规则文件与注册表 | test/settings-section.dom.test.ts | spec Scenario "策略说明来自规则文件与注册表" | 🟢 green |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | key 的只读来源与迁移 | test/settings-host.test.ts | spec Scenario "key 的只读来源与迁移" | 🟢 existing |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 独立保存结果与不泄漏 | test/settings-section.dom.test.ts | spec Scenario "独立保存结果与不泄漏" | 🟢 existing |
| specs/auto-model-routing/spec.md → 自动模型路由设置页 | 导航图标只作用于本区块 | test/nav-icon.dom.test.ts | spec Scenario "导航图标只作用于本区块" | 🟢 existing |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 新旧记录并存 | test/feedback.test.ts | spec Scenario "新旧记录并存" | 🟢 existing |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 快照记录作出决策时的预设 | test/preset-sampling.integration.test.ts | spec Scenario "快照记录作出决策时的预设" | 🟢 green |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 活跃决策跨越大量其它判断仍保留归属 | test/preset-sampling.integration.test.ts | spec Scenario "活跃决策跨越大量其它判断仍保留归属" | 🟢 green |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 新旧事件格式混读 | test/feedback.test.ts | spec Scenario "新旧事件格式混读" | 🟢 existing |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 修改撤销 | test/label-button.dom.test.ts | spec Scenario "修改撤销" | 🟢 existing |
| specs/auto-allocation-feedback/spec.md → 评估记录可追溯 | 手动及新回合隔离 | test/host.integration.test.ts | spec Scenario "手动及新回合隔离" | 🟢 existing |

## Coverage Notes

- 共 47 个场景：29 个 🔴（新增要求与新增场景，加上 6 个 THEN 有改动的既有场景），18 个 🟢 existing。这 18 条既有测试的测试名，已在 2026-11-06 用 grep 逐条核对过，都能在表中所列文件里精确匹配到。实施时第一步先运行一遍全量测试，记下基线：这 18 条必须全部通过。
- **THEN 有改动、要先改成 red 的既有测试**：
  - 「源码与文案不含版本」：断言 `lib/rubric.json` 不存在，哈希改为核对新路径；
  - 「请求内容受限」：questions 改取 `reasoning-depth`，并断言没有 `Execution:`；
  - 「源码不含本地分类与其它出站」：URL 主机白名单加入预设来源的主机 `claude.dev`；
  - 「非法设置整体拒绝」：改为 999/8001/1500.5 必须拒绝，1000/6000/8000 必须接受，另加 `preset` 非法值；
  - 「设置文件损坏」：增加未知 `preset` 的情况；
  - 「策略说明来自规则文件与注册表」：所选预设改为 `effort-as-verification`，并检查来源链接属性。
  「首个用户回合不带上一轮上下文」的 THEN 只是在 GIVEN 里写明了预设，期望字节不变，所以仍记为 existing。
- **共享工具**：
  - `test/fake-jev.ts` 增加"挂起凭据解析"的钩子（返回一个由测试控制何时 resolve 的 Promise），给三个"进行中切换"场景用；
  - `test/host-harness.ts` 支持写入设置 `preset`，以及以子会话完成通知开启非用户回合；如果已有对应能力，直接复用。
- `test/eval-live.test.ts`：
  - 先在临时副本里执行一次 `npm run build`，参照 `package-output.test.ts` 的隔离构建方式，确保 `lib/context.js` 存在；
  - 再用 `node --import <桩模块> eval/live.mjs` 运行；桩模块替换 `globalThis.fetch`，并把调用记录写到测试临时目录；
  - 全程不发任何网络请求，不需要真实 key。
- 「活跃决策跨越大量其它判断仍保留归属」里的"disposed 后不再保留"：用 `agent/disposed` 之后，`appliedDecision(id)` 返回 undefined，并且再绑定时不产生快照来断言，不读取模块私有状态。
- 本 change 不需要 `N/A — non-executable` 的行；文档只有存在性检查，已经由 `presets.test.ts` 覆盖。
