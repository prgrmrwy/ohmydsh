## 1. 模式词汇与映射

- [x] 1.1 `LocusSandboxMode` 收敛为 `'read-only' | 'danger-full-access'`，并将"no wider mode is representable"的注释改写为本次显式决策的说明（指向 ADR-0005）
- [x] 1.2 `modeFor()`：write → `danger-full-access`（回滚路径共用）
- [x] 1.3 `index.ts` 管理面 scope 路径的模式映射与回读同步

## 2. 写档核验

- [x] 2.1 `verifyLocusLivePolicy`：write 的期望模式改为完全访问；删除执行根相等与锚点撤销判定
- [x] 2.2 诊断改写：拒绝提权的原因是"宿主未接受/未保持完全访问模式"，不再出现"工作根不一致"
- [x] 2.3 漂移检测保留：live 模式不符即按既有路径暂停该入口并诊断
- [x] 2.4 read 档判据与既有约束一字不动

## 3. 呈现与审计

- [x] 3.1 客户端权限标签改为「可写（完全访问）」，按钮 title 与权限行写明"整机无边界、该入口成员共享"
- [x] 3.2 执行根行改为上下文说明（不再是提权前置），保留候选展示与确认入口
- [x] 3.3 审计沿用 `locus_permission_audit`（同提交写入 desired/effective/grantedBy/verifiedAt），无 schema 变更

## 4. 决策记录

- [x] 4.1 `docs/adr/ADR-0005-locus-write-grants-full-access.md`：显式安全决策、被取代的 design 条款、替代方案与否决理由、后果（含负面）
- [x] 4.2 change 的 proposal/design/spec delta 与本 ADR 相互引用，避免决策只存在于对话里

## 5. 测试与验证

- [x] 5.1 `locus-policy-verification`：write 期望完全访问；模式不符拒绝；read 档不变；锚点缺失/撤销不再影响判定
- [x] 5.2 `locus-permission-mutation`：apply 收到 `danger-full-access`；回滚回到 `read-only`；失败路径不变
- [x] 5.3 客户端/路由：权限文案与 title 断言（含"完全访问"与"入口成员共享"）
- [x] 5.4 削弱验证：把映射改回 `workspace-write`、把期望模式改回旧值、去掉文案后果说明时，对应用例必须失败
- [x] 5.5 运行 `packages/dsh-pet` typecheck 与 vitest、仓库 `npm test`、`check:artifacts`、`openspec validate --strict`，与改动前基线对比无新增失败
- [x] 5.6 记录剩余未验证项：真实 worktree 写入与降权后拒绝为实机验收，本 change 不冒充已完成
- [ ] 5.7 部署与实机验收（需所有者批准，**不自动重启**）：`dsh build` 后由所有者重启，再按 design 的 Migration Plan 验收
