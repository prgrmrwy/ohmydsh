## 1. host 设置字段

- [x] 1.1 `settings.ts`：`Settings.sidebarUsage?: boolean`（缺省 false）
- [x] 1.2 `runtime.ts`：`writeSettings` 的 next 保留该字段；`savePreferences` 支持并写入该字段；`settingsView` 响应返回 `sidebarUsage`
- [x] 1.3 `routes.ts`：设置补丁允许 `sidebarUsage`，严格校验 boolean（非布尔 400）
- [x] 1.4 测试：写入 true 后 GET 可见；`"yes"`/`1` 被拒绝且不落盘

## 2. 客户端纯函数与数据层

- [x] 2.1 `sidebar-view.ts`：`weeklyWindow(card)`（周窗口 → 最紧 → display/无限）、`usedLevel(used)`、`formatAge(readAt, now)`、`formatResetShort(resetsAt, now)`、`sidebarRows(cards)`（网关顺序）
- [x] 2.2 `sidebar-api.ts`：60s TTL 缓存 + `loadCards()` / `refreshAll()`（无单卡刷新、无定时器）
- [x] 2.3 `view-model.ts`：`SettingsView.sidebarUsage?: boolean`
- [x] 2.4 测试 `test/sidebar-view.test.ts`：周窗口判定/回退、70/90 边界、相对时间、短重置格式、顺序

## 3. 侧栏组件

- [x] 3.1 `SidebarUsage.tsx`：常驻卡（5 行 + 双箭头，无分割线）、展开覆盖层（同宽、向上长高）、rail icon（tooltip）与 320px 浮层；单一刷新入口
- [x] 3.2 `styles.ts`：`dmg-sidebar-*`（无 border、仅阴影；tabular-nums；warn-label 文字色）
- [x] 3.3 `locales.ts`：新增 zh/en 键（标题、周窗口说明、读取失败、空/无权/未配置、展开/收起、刷新、当前、重置、余额、旧读数、未重新读取）
- [x] 3.4 `index.ts`：注册 `sidebar.footer.action`（id `magpie-usage`，order 10，按 `wide` 分形态），读取 `sidebarUsage` 决定是否渲染
- [x] 3.5 `SettingsPage.ts`：新增「侧边栏额度」面板与开关（写入 `{sidebarUsage}`）
- [x] 3.6 测试 `test/sidebar-usage.test.tsx`：关闭不渲染不请求；5 行 + 双箭头；展开后列表容器高度不变；rail 只有 icon；单一刷新；失败行文案

## 4. 校验与收尾

- [x] 4.1 `npm run typecheck`（package）
- [x] 4.2 `npm test`（package，全量保持绿）
- [x] 4.3 `npm run build`（package）
- [x] 4.4 版本 0.6.0；CHANGELOG、README/README.zh、`dsh.yaml` 条目说明同步
- [x] 4.5 仓库级 `npm run check:artifacts` 与 `npm test`

## 5. 待补（环境限制）

- [x] 5.1 `ws promote` 后用隔离 `DSH_HOME`（port 3255）+ loopback mock 网关 + chrome-headless-shell 156 走 CDP 实测：常驻卡 5 行（body 113px）、展开原位长高、收起后 icon+320px 浮层、设置开关即时增删卡片（无需刷新）、浅色/深色均正常；`Usage limit reset 1 time` 单复数、`max · just now` 文案已按实测修正。截图只作本次验收证据，未提交。
- [x] 5.2 仓库级 `npm test`：**700 passed / 0 failed / 7 skipped**（`zstd` 缺失跳过）；`node scripts/check-tracked-artifacts.mjs` 通过。此前 worktree 内 `tsc: not found` 为共享依赖缓存所致，`ws promote` 后恢复。
