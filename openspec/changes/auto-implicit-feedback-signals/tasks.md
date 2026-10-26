## 0. 修复配置未变回合不绑定（D012）

- [ ] 0.1 先写正式宿主集成测试（`test/host.integration.test.ts`）：AUTO 下连续两个用户回合判断都是 baseline，断言第二回合没有新的 `request/header`，且其最后一条回复的 `label` 查询返回 policy-v2 绑定（含 `snapshot.requestSeq`），`state` 的决策状态为 applied；另加一例：实际配置被改成与判断不一致时，第二回合不绑定。验证：在旧实现上第一例失败。
- [ ] 0.2 按 design D0 修改 `src/policy-host.ts`：配置未变时以 `session.requestHeader()` 确认已应用并绑定；保留有新请求头时的原逻辑。验证：0.1 通过，既有 host/policy-host 集成测试不变。
- [ ] 0.3 BACKLOG D012 状态改为已修复，注明本 change。

## 1. 账本

- [ ] 1.1 先写测试（`test/feedback.test.ts`）：写入 `exposed` 与 `manual-switch` 后可按决策读回；同类事实重复写入只保留首条；事实不改变 `lookup` 返回的绑定与显式反馈；混合旧完整记录、显式反馈与事实行，重启读取结果一致。验证：在旧实现上失败。
- [ ] 1.2 在 `src/feedback.ts` 中实现 `type:'fact', version:1` 事件的 schema、读取折叠、`fact()` 写入（查重）与 `facts()` 读取。验证：1.1 通过，既有 feedback 测试不变。

## 2. Host 侧事实

- [ ] 2.1 先写测试：`observe` 端点（`test/endpoints.test.ts`）参数非法 400；无已应用绑定返回空且不写；有绑定按决策写一次 `exposed`，重复调用不新增。`setMode` 钩子（走真实 `auto-model-routing.setMode` RPC 路由的集成测试，含路由里先执行的 `invalidate`）：已应用决策的回合进行中切 MANUAL 写一次；回合结束后切 MANUAL 写一次；`setMode` 失败不写；下一个 `request/header` 之后再切不写；MANUAL 回合与子会话不写。验证：在旧实现上失败。
- [ ] 2.2 在 `src/policy-host.ts` 暴露 `appliedDecision(sessionId)`；在 `src/endpoints.ts`、`src/index.ts` 新增 RPC `auto-model-routing.observe`；在 `setMode` 路由中于 `invalidate` 之前读出已应用决策，响应成功且目标为 MANUAL 时写事实。写入失败只记 warn。验证：2.1 通过。

## 3. 客户端曝光

- [ ] 3.1 先写 DOM 测试（`test/label-button.dom.test.ts`）：可见且前台持续 3 秒调用一次 observe；1 秒后离开视口不调用；页面隐藏期间不计时；调用后不再重复；无已应用决策时不挂观察。验证：在旧实现上失败。
- [ ] 3.2 在 `src/client/label.ts` 实现 IntersectionObserver + 可见性/焦点计时，组件卸载时清理。验证：3.1 通过，既有 label 测试不变。

## 4. 报告

- [ ] 4.1 先写测试（`test/` 下报告用例）：`readSession` 记录每个调用的实际回合号、每个回合的 `turn/end` 类别、用户发起的回合及其开始时间；覆盖规范中的五类互斥归类、父会话取消不算负向、尾段不完整归 `inconclusive`、事后翻看不算看过、后续非用户回合被中止计为负向、旧数据全部 `unobserved`、“有效曝光且有显式评价”对照计数，以及正文与 sessionId 不泄漏。验证：在旧实现上失败。
- [ ] 4.2 在 `src/usage-report.ts` 实现实际回合号、回合结束类别映射、继续时间与有效曝光推导、`implicit` 字段与新增 caveats；同步包内 `auto-model-routing-report` skill 对新字段的解读说明。验证：4.1 通过，既有报告与只读权限测试不变。

## 5. 文档与交付

- [ ] 5.1 更新 `docs/feedback-evaluation.md`：事实事件格式、两类运行时事实与两类推导事实的口径、五类归类与局限、“决策所在回合”（实际回合号）与“有效曝光”（早于继续时间）的定义。
- [ ] 5.2 运行包内 typecheck、vitest、build；`openspec validate auto-implicit-feedback-signals --strict`。验证：均退出码 0。
- [ ] 5.3 `dsh build` 物化并重启 DSH（需用户确认时机），在 3080 GUI 发一条 AUTO 消息，停留 3 秒后继续下一回合，只读核对账本中出现 `exposed`，并跑一次报告确认该决策归入 `implicit-ok`。验证：记录在 verification.md，不提交原始账本内容。
