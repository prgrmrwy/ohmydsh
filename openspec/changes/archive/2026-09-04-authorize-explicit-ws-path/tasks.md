## 1. Regression Tests for the Authorization Seam

- [x] 1.1 添加失败测试：Agent 调用携带非空 `path` 且授权返回 `allowed-once` 时，目标按该路径解析而非调用 Session cwd。
- [x] 1.2 添加失败测试：授权返回 `rejected` 与 `cancelled` 时拒绝调用，且不触碰任何 Worktree Session 资源。
- [x] 1.3 添加失败测试：`ctx.approval` 缺失、答复 `unavailable` 或会话 policy 为 `never` 时确定性拒绝（fail closed）。
- [x] 1.4 添加回归测试：省略 `path` 与空字符串 `path` 时不发起授权询问，且 `status`/`promote`/`clean` 的既有解析与诊断逐字不变。
- [x] 1.5 添加回归测试：连续两次显式路径调用各自触发一次独立授权，不复用先前授权。

## 2. Confirmation-Gated Path Resolution

- [x] 2.1 在 `packages/worktree-session/package.json` 的 peerDependencies 中按现有 pin 风格加入 `@deepseek-ai/dsh-user-questions`。首版误用 `dsh-user-approval`，真机验证发现 `danger-full-access` preset 绑定 `approval: never`，请求在触达用户前即被自动拒绝，弹窗从不出现，已切换为用户提问能力。
- [x] 2.1a 在 `WS_TOOL_PARAMETERS` 中声明可选 `path`（描述含“绝对路径、每次需用户一次性授权”），更新工具描述，并同步调整断言其不存在的既有测试。
- [x] 2.2 在 `tool.ts` 中实现单一确认辅助函数 `askUser`：接收 `exec`（提供 `agent`、`signal`）与问题、细节，经 `ctx.get('userQuestions')` 发起 `ask()`，仅用户选中同意项才返回通过。
- [x] 2.3 询问文案包含确切 action 与完整路径，并说明这是一次性同意，且附带可点选的拒绝项；不含任何调用方特定措辞。
- [x] 2.4 触发条件严格复用现有判定 `path !== undefined && path !== ''`（提取为 `hasExplicitPath`），保持空字符串 wire 兼容语义。
- [x] 2.5 未获授权时返回明确诊断，指出原因是“显式路径未获用户授权”，不复用绑定缺失文案。

## 3. Per-Action Target Semantics

- [x] 3.1 `status`/`promote`：授权路径走既有 `MaintenanceTarget` 字符串分支（与 `dsh-ws` CLI 同一单 operation 语义），未授权时保持现有硬拒绝。
- [x] 3.2 `clean`：授权路径调用 `wsCleanRepository(repoPath, …)`，与主 checkout 普通 Session 发起的仓库级扫描完全一致，含 archived/active/dirty/in-flight/merge 安全门与批量汇总。
- [x] 3.3 `clean`：授权路径不能被证明为仓库主 checkout 时按既有诊断拒绝整次清理，不扫描不删除（由 `wsCleanRepository` 的 `discoverRepo` 既有校验保证）。
- [x] 3.4 保持绑定 Worktree Session 在无授权路径时仍被拒绝并提示切换到主仓 Session。

## 4. Safety, Audit and Compatibility Coverage

- [x] 4.1 添加测试：已授权但候选未通过 dirty/active/in-flight/未归档/未合并/schema 不支持等安全门时仍逐项拒绝，证明授权不构成豁免（`test/ws-authorized-path-clean.test.ts`，真实 Git fixture）。
- [x] 4.2 添加测试：授权询问与结果在调用会话日志中成对出现（`approval/asked` + `approval/decided`），且 reason 含确切路径（`test/ws-path-authorization-audit.test.ts`，使用真实 `ApprovalService`）。
- [x] 4.3 重跑既有 `wsClean`、`wsCleanRepository`、HTTP clean、CLI、source-binding、archive lifecycle 与 bin-entrypoint 测试，证明 operator 显式路径行为与单 operation 安全门未变（23 文件 147 通过 / 2 既有跳过）。
- [x] 4.4 确认 `dsh-pet` 无需代码改动：其 `index.ts` 已投影 `approval/asked`→`waiting-user`、`approval/decided`→`turn-start`，并由 `test/coordinator.test.ts` 既有用例覆盖。

## 5. Documentation and Verification

- [x] 5.1 更新 `skills/ws/SKILL.md`：以通用措辞说明“调用会话 cwd 不在目标仓库时，可用受信机制证实的仓库根作为 `path` 并接受用户一次性授权”，保持 ownership boundary 与 dry-run 先行约定不变。
- [x] 5.2 更新 `worktree-session` 架构文档，说明模型显式路径的授权通道与 operator CLI 的关系。
- [x] 5.3 运行 `packages/worktree-session` 的 build/typecheck/test 与仓库级 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs`（并验证第二次运行无变化），记录确切命令与结果。build/typecheck 通过；包测试 23 文件 149 通过；`npm test` 92/92；`check:artifacts` 合规；主仓 `node scripts/sync.mjs` 第二次运行报 `no changes — deployment already matches manifest`（幂等成立）。
- [x] 5.4 运行 `openspec validate authorize-explicit-ws-path --strict`（通过），复核 diff 无范围蔓延：仅 `worktree-session` 源码/测试/manifest、`skills/ws/SKILL.md`、架构文档与 lockfile 依赖声明；`dsh-pet` 零改动，operation schema、HTTP route、CLI 行为、远端分支、缓存与历史 Session 语义均未改变。
- [x] 5.5 在真实 Pet 流程中端到端验证一次 `ws clean`：先 `dry_run` 预览（未索取授权确认），再以显式 `path` 真实执行并由用户在会话中作答同意，闭环成功；授权仅对当次调用生效，既有安全门逐项照常评估。
