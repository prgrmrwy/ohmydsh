# Locus 工作区分离验收修正（2026-11-04）

所有者在真机验收中确认：干活主会话留在 nexus 等来源工作区，locus 主会话归 DSH Pet，子会话保留来源项目读取能力。原规范和实现都让主子会话与干活会话同工作区；本次同步修正规范和实现，不新增 compat 补丁。

## 宿主约束与实现

- 官方 rc.2 `dsh-workspace` 的 `attachSession` 会核验不可变 header cwd 与 workspace path 的物理路径相等，无法只改侧栏归属。
- 官方 `dsh-subagent` 的 `childSessionMeta` 让 child 继承父 cwd。因此 locus 主会话创建、挂载与 cwd 使用已注册的 DSH Pet，child 继承该运行目录。
- `locus_mains.workspaceId` 记录主会话运行归属；`loci.workspaceId` 仍为干活项目。Host 从持久入口解析来源项目根，业务 prompt 明示项目绝对路径。
- 读取守卫保留父/子/sandbox 运行根一致性与 realpath 边界检查，允许根单独取来源项目。Pet/DSH/附件状态仍拒绝，运行 cwd 不构成读取授权；省略路径的搜索在真实 cwd 被拒，不改写工具参数。缺失来源工作区或项目目录拒绝发布。
- 标题模板为 `[locus] <干活主会话名>`，无标题用干活会话短码。
- resolver 与 controller 共用含 Pet 工作区归属的可用性判断；旧工作区中的 M 在下一条授权消息到来、入口空闲时复用现有 M 替换协议，保留旧会话与历史，不重放旧 Delivery。无需数据版本升级或离线迁移。

## 回归证据

- 新工作区/项目守卫测试先在旧代码上运行：6 failed / 13 passed，原因为跨工作区返回被拒及 Pet cwd 与私有根重叠。生产命名断言另在旧模板上确认 1 failed / 4 passed。
- `npm run build --workspace=dsh-pet`、`npm run typecheck --workspace=dsh-pet`：通过。
- `npm exec --workspace packages/dsh-pet -- vitest run --reporter=dot`：198 个测试文件通过、2 个跳过；2933 passed / 4 skipped。
- 最后仅修改标题模板后，`locus-three-tier-entity`、`locus-controller`、`loader-composition`、`locus-host-wiring` 四组定向回归：100 passed。
- Host wiring 新例覆盖 Pet cwd 下首个 child 的项目读取/私有根拒绝，以及为同一 child 重建 agent scope 后相同边界。它采用真实 Cordis/Tools/Pet 入口与原生契约替身，不代表真实 Host 重启验收。
- `npm test`：703 passed / 3 skipped；`npm run check:artifacts`：通过。
- `openspec validate locus-three-tier-structure --strict`：通过；`openspec validate --specs`：54 passed。

## 现场边界

修复前最后一次现场日志已出现 `collab: established`，能证明前一轮空间建立故障已经越过；不能单凭此认定业务回复成功。本次源码验证没有发送真实飞书消息。部署后仍须核验新 M 的侧栏归属、旧入口迁移和实际回复，任务 27.3/27.4 保持未完成。
