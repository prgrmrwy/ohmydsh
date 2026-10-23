## 1. 工具

- [x] 1.1 在 `packages/auto-model-routing/test/subagent-tool.test.ts` 增加场景测试：指定模型时只推荐 effort（Astra 四档为 low/low/medium/high，不采用 `childRoutes`）、指定模型不可用时不换模型（不在允许列表、provider 不符、不在目录）、指定模型且 MANUAL 时不判档；观察到失败
- [x] 1.2 `route_subagent` 增加可选参数 `model`（描述写明“已指定模型时传入，只推荐 effort”），按 design D1–D4 实现，使 1.1 通过

## 2. skill 与环境级指令

- [x] 2.1 先改 `packages/auto-model-routing/test/content.test.ts` 与 `tests/agent-instructions-dispatch.test.mjs`，要求出现“只指定模型”/“只指定了模型”的规则；观察到失败
- [x] 2.2 改 `skills/subagent-model-routing/SKILL.md` 第 1 条为三种情况，改 `instructions/dsh-home.md` 派发步骤，使 2.1 通过；指令中仍不含模型名与 effort 值

## 3. 验证

- [x] 3.1 运行插件包 typecheck/test、`npm test`、`openspec validate subagent-route-explicit-model --strict`
  - 顺带修复既有构建错误：`src/client/route-picker.ts` 触发按钮 `onKeyDown` 参数缺类型（TS7006，来自 f3b7b903），否则插件无法构建、部署。
  - `npm test` 仍有 8 个隔离夹具中的 sync 失败（auto-model-routing 与 dsh-openspec 在临时仓库内 build 失败），改动前后数量相同，与本 change 无关；真实 `node scripts/sync.mjs` 构建与部署成功。
- [ ] 3.2 `node scripts/sync.mjs` 部署并确认第二次运行无变化；新会话 AUTO 下请求“用指定模型派一个只读评审子会话”，核对 `route_subagent` 收到 `model`、子会话请求头的 model 与 effort 与工具返回一致
  - 部署已完成（第一次 36 项变更，第二次无变化，已部署的 `lib/subagent-tool.js` 与 skill 含新规则）；新会话实测需重启 DSH 后由用户进行，未完成。
