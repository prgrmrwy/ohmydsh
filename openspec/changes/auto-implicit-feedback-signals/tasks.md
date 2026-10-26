## 1. 账本

- [ ] 1.1 先写测试（`test/feedback.test.ts`）：写入四类事实后可按决策读回；同类事实重复写入只保留首条；事实不改变 `lookup` 返回的绑定与显式反馈；混合旧完整记录、显式反馈与事实行，重启读取结果一致。验证：在旧实现上失败。
- [ ] 1.2 在 `src/feedback.ts` 中实现 `type:'fact', version:1` 事件的 schema、读取折叠、`fact()` 写入（查重）与 `facts()` 读取。验证：1.1 通过，既有 feedback 测试不变。

## 2. Host 侧事实

- [ ] 2.1 先写正式宿主集成测试（`test/policy-host.integration.test.ts`）：已应用决策回合完成后有 `turn-end:completed`；用户中止得到 `aborted-user`；父会话取消得到 `aborted-other`；下一条用户消息写 `continued`；结束后切 MANUAL 写 `manual-switch`，下一回合开始后再切不写；MANUAL 回合与子会话不写任何事实。验证：在旧实现上失败。
- [ ] 2.2 在 `src/policy-host.ts` 实现 `turnDecision`/`awaiting` 状态与结束类别映射，暴露供 `setMode` 调用的切换钩子；在 `src/index.ts` 的 `setMode` 成功分支调用。写入失败只记 warn。验证：2.1 通过。
- [ ] 2.3 新增 RPC `auto-model-routing.observe`（`src/endpoints.ts`、`src/index.ts`）：参数非法 400；无已应用绑定返回空且不写；有绑定按决策写一次 `exposed`。验证：端点单测覆盖三种情况与重复调用。

## 3. 客户端曝光

- [ ] 3.1 先写 DOM 测试（`test/label-button.dom.test.ts`）：可见且前台持续 3 秒调用一次 observe；1 秒后离开视口不调用；页面隐藏期间不计时；调用后不再重复；无已应用决策时不挂观察。验证：在旧实现上失败。
- [ ] 3.2 在 `src/client/label.ts` 实现 IntersectionObserver + 可见性/焦点计时，组件卸载时清理。验证：3.1 通过，既有 label 测试不变。

## 4. 报告

- [ ] 4.1 先写测试（`test/` 下报告用例）：覆盖规范中的五类互斥归类、旧数据全部 `unobserved`、“曝光且有显式评价”对照计数，以及正文与 sessionId 不泄漏。验证：在旧实现上失败。
- [ ] 4.2 在 `src/usage-report.ts` 实现 `implicit` 字段与新增 caveats；同步包内 `auto-model-routing-report` skill 对新字段的解读说明。验证：4.1 通过，既有报告与只读权限测试不变。

## 5. 文档与交付

- [ ] 5.1 更新 `docs/feedback-evaluation.md`：事实事件格式、四类事实口径、五类归类与局限。
- [ ] 5.2 运行包内 typecheck、vitest、build；`openspec validate auto-implicit-feedback-signals --strict`。验证：均退出码 0。
- [ ] 5.3 `dsh build` 物化并重启 DSH（需用户确认时机），在 3080 GUI 发一条 AUTO 消息，停留 3 秒后继续下一回合，只读核对账本中出现 `exposed`、`turn-end`、`continued` 三条事实。验证：记录在 verification.md，不提交原始账本内容。
