## Why

`-s write`（以及在 Pet 设置页点「可写」）在这台部署上**永远不可能成功**，而且失败原因被替换成一句无从下手的话。两次实测证据：

- 飞书侧：2026-09-16 00:58:56 在答疑群 @bot 发 `-s write`，00:58:59 收到 `控制命令执行失败，请稍后重试。`；Host 日志只有 `control-command` + `control refused: control-failed`。设置页同一动作显示的是真实原因：`修改 locus 权限：缺少所有者已确认的 execution root；请先确认上下文锚点再提权。 已维持原 effective/read，未扩大权限。`
- 子会话日志（`session-680611d7`，群级 locus 的 child）在同一秒给出机制的完整证据：

  ```
  00:58:57.857 sandbox/mode {"mode": "workspace-write"}   ← Host 真的应用了
  00:58:57.925 sandbox/mode {"mode": "read-only"}          ← 68ms 后回滚
  ```

  即 `policy.apply` 成功、`verifyLocusLivePolicy` 拒绝、`restorePolicy` 回滚，抛 `WRITE_UNSUPPORTED`。01:01:46 用户重试，序列完全相同。

判据链（纯代码可判定）：

1. 写授权必须同时满足「所有者已显式确认执行根」与「live sandbox workspace root 与之精确一致」（`policy-verification.ts`，spec 亦如此要求）。
2. `contextAnchor.executionRoot` 的**唯一**写入点是 `management.ts` 的 `confirm-anchor`，其值只能来自 `PetLocusConfirmAnchorAction.executionRoot`（`wire.ts`）。
3. 客户端**唯一**的调用点 `settings.tsx` 的「确认执行根」按钮发送 `{action, ...fence, endpoint, projectResources: [], constraints: [], existence: 'unknown'}` —— **从不发送 `executionRoot`**；管理面也没有任何可填该值的输入或选择器。
4. 该调用仍然置 `status: 'confirmed'`（两个空数组已满足 `hasFacts`），于是按钮按 `contextAnchor?.status !== 'confirmed'` 判断而**消失**；且投影里的 `workspace.executionRoot` 从不被填充（`index.ts` 的 workspace resolver 只返回 title/path，并注明「Display-only，永不构成执行根授权」）。

结论：闸门要求的值在整条产品路径上没有任何可达写入点，而 UI 在第一次点击后连入口都收走 —— 与仓库 `docs/notes/dsh-plugin-integration-pitfalls.md` 第 7 节「判据要求的值真实系统从不产生」同型，也与本仓 10.13 条目当年的失败模式（只修了判定侧、未修事实供给侧）同型。

## What Changes

- **宿主解析出可确认的执行根**：locus 视图新增/填充 Host 解析到的执行根候选（子会话不可变 `cwd`，缺失时回退主会话 `cwd`；DSH 契约明确 session cwd 就是 `workspace-write` 的边界，`sandboxPolicy.resolve()` 回读的 `workspaceRoot` 即该值）。这只提供**候选**，不构成授权：授权仍由每次核验的 root 相等关系派生。
- **管理面把候选作为确认内容**：执行根行展示该候选；「确认执行根」按钮发送它；按钮不再因为「已 confirmed 但缺根」而消失——只要锚点仍没有 `executionRoot`，所有者就仍能确认它。
- **飞书控制面回真实且可行动的原因**：提权失败不再被折叠成 `控制命令执行失败，请稍后重试。`，而是指出「需要先确认执行根 / 已确认根与宿主回读范围不一致」等确定性原因，并指向确认入口。这句话本来就该说（spec：拒绝提权时「提示需先确认上下文锚点」），当前实现把提示丢了。
- 非破坏性：不改持久 schema、不改 wire 字段（`workspace.executionRoot` 与 `confirm-anchor.executionRoot` 早已存在，只是无人填），不放宽任何安全判据——`read` 仍然是默认，`write` 仍要求两个独立事实同时成立。

**明确不做**：不因为「点了确认」就直接授予 write；不让管理面或模型把任意路径写成执行根；不引入「已存储授权」这种会过期的标记。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-locus-collaboration`：（1）写授权需求补充「管理面 SHALL 以宿主解析出的执行根作为可确认事实，且缺根时 SHALL 保留确认入口」的可判定场景，把所有者意图这一半变成可完成的动作；（2）提权拒绝在**飞书控制面**也 SHALL 给出可行动原因并指向确认入口，而不只是一句重试提示。

## Impact

- `packages/dsh-pet/src/host/locus/management.ts`：会话描述增加执行根候选，locus 视图填充 `workspace.executionRoot`。
- `packages/dsh-pet/src/index.ts`：把 session header 的 `cwd` 透给描述器。
- `packages/dsh-pet/src/client/locus-view.ts` + `settings.tsx`：候选展示、确认请求构造（纯函数）、按钮可见性条件。
- `packages/dsh-pet/src/host/locus/control.ts`：权限变更错误分类映射为可行动文案。
- 测试：`locus-management`、`client`/`locus-view`、`locus-control` 三处补回归；`policy-verification` 的既有 fail-closed 用例不变（判定侧不改）。
- 用户可见影响：设置页能真正完成「确认执行根 → 提权」，飞书侧 `-s write` 失败时能看到原因与去处。
