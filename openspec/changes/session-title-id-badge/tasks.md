## 1. 规格与实现（徽标形态）

- [x] 1.1 `title-locator.ts`：定位标题区（header 内含 crumb 按钮的 nav + 其 parentElement 插入点）；删除「disabled 当前标题」定位
- [x] 1.2 `wiring.ts`：新增 `sessionSnippet`（去 `session-` 前缀取前 6 位）、徽标创建/更新/接线（自有标记 + 内联样式 + tooltip 完整 id + hover pointer）；删除标题 wireTitle/reconcile 逻辑
- [x] 1.3 `index.ts`：reconcile 改为「定位标题区 → 徽标存在即更新 / 缺失即创建+接线；无标题区则清除残留徽标」；ctx.effect 清理补徽标移除
- [x] 1.4 版本 0.1.0 → 0.1.1（package.json、CHANGELOG、README、dsh.yaml version/note）

## 2. 测试

- [x] 2.1 `test/title-locator.test.ts`：定位 crumb nav / 插入点父容器 / 无 header·无 nav·无 crumb 均返回 null
- [x] 2.2 `test/wiring.test.ts`：`sessionSnippet` 推导；徽标幂等插入/更新（会话切换改文本与复制目标）；点击复制完整 id；剪贴板失败静默；无标题区时清理残留徽标

## 3. 构建与验证

- [x] 3.1 `npm run typecheck` + `npm run build` 通过；`npm test`（vitest 20/20）全部通过
- [x] 3.2 隔离 DSH_HOME sync 连续两次幂等（含 D003 绕过刷新后 `no changes`）；仓库级 `npm test`（81/81）/ `npm run check:artifacts` 通过
- [x] 3.3 openspec validate 通过

## 4. 收尾

- [ ] 4.1 合并部署后 headless 真机复核：徽标可见（6 位）、点击复制完整 id + toast、标题恢复官方 disabled
- [ ] 4.2 归档 change `session-title-id-badge`，主 spec（MODIFIED 合并）与 B018 记录同步
