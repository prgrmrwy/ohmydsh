## 1. 候选执行根的宿主供给

- [x] 1.1 `createLocusSessionDescriber` 从冷读 `inspection.meta.cwd` 暴露会话工作目录（缺失/空白/非字符串一律省略，不猜）
- [x] 1.2 `locusView` 以「子会话优先、主会话回退、最后工作区」填充 `workspace.executionRoot`（候选，非授权）；`contextAnchor` 投影不变
- [x] 1.3 `index.ts` 把 session header 的 `cwd` 透给描述器（不引入第二份真相）

## 2. 管理面确认动作可达

- [x] 2.1 纯函数 `locusAnchorConfirmRequest(head)` 构造 `confirm-anchor` 请求：带宿主解析到的候选根；无可信候选时不带根（并测试钉住）
- [x] 2.2 设置页执行根行区分「已确认执行根」与「宿主解析到的候选」，未确认时展示候选
- [x] 2.3 确认按钮可见性改由「尚无 executionRoot」决定：已 confirmed 但缺根时仍可补确认（有回归用例）
- [x] 2.4 无候选时按钮禁用、说明原因，不猜路径、不静默降级为无根确认

## 3. 控制面回真实原因

- [x] 3.1 `safeControlError` 映射 `LocusPermissionMutationError`：`WRITE_UNSUPPORTED` 透出核验诊断并指向「Locus 管理」；`CHILD_SESSION_UNAVAILABLE`/`POLICY_APPLY_FAILED`/`POLICY_VERIFY_FAILED`/`PERSISTENCE_FAILED`/`POLICY_ROLLBACK_FAILED`/`LOCUS_NOT_CURRENT`/`LOCUS_NOT_FOUND`/`LOCUS_INVALID` 各给稳定中文；`LOCUS_BUSY` 维持稍后重试语义
- [x] 3.2 未知异常仍回落通用回执（不把任意 message 泄进群聊）；上述文案不含路径、会话 id、群 id 或凭据

## 4. 测试与验证

- [x] 4.1 描述器与投影：有 cwd 时带执行根、空白/非字符串省略、视图填子会话根、主会话回退、都无则省略
- [x] 4.2 客户端纯函数：候选存在时请求带该根；候选缺失/空白时不带根
- [x] 4.3 面板渲染（渲染 `LocusDetails`，因控件在折叠区内）：未确认、已确认缺根两种快照都仍渲染确认入口；已确认有根时不再渲染；无候选时按钮 disabled 并说明原因
- [x] 4.4 控制面：`WRITE_UNSUPPORTED` 回真实原因且不再出现「请稍后重试」；`CHILD_SESSION_UNAVAILABLE`/`POLICY_ROLLBACK_FAILED` 各自可辨；未知异常回落通用回执
- [x] 4.5 判定侧不变：`locus-policy-verification`（7）与 `locus-permission-mutation`（15）全绿，缺根/根不一致/显式撤销三类拒绝未放松
- [x] 4.6 验证：`tsc -p tsconfig.json` 通过、`tsc -p tsconfig.client.json` 仅剩本 worktree 缺依赖导致的 `client/index.tsx` 5 条既有报错；削弱三处修复（映射、可见性、候选供给）后 91 项中 8 项失败，恢复后 91/91；`packages/dsh-pet` 全量 vitest 与基线同形（5 个文件因缺依赖失败、2 项断言失败，通过数 2348 → 2362）；仓库 `npm test` 124 通过 / 0 失败；`check:artifacts` 与 `openspec validate --strict` 通过
- [x] 4.7 记录剩余未验证项：本机设置页「确认执行根 → 提权」与飞书 `-s write` 成功的端到端闭环只有在部署后的真实 Host 上才能确认，本 change 不冒充已完成
- [ ] 4.8 部署与实机验收（需所有者批准）：`dsh build` + 重启 `dsh web` 后按 4.7 验收
