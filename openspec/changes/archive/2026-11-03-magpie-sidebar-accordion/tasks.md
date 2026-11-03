# 任务

## 1. 实现

- [x] 1.1 `SidebarUsage.ts`：展开改为流内手风琴（同一卡片渲染摘要或明细），删除覆盖层与占位
- [x] 1.2 `SidebarUsage.ts`：只有标题行可切换；正文与双箭头去交互；刷新 `stopPropagation`
- [x] 1.3 `styles.ts`：删 `.dmg-sidebar-expanded` 绝对定位，新增 `.dmg-sidebar-detail` 限高滚动；标题行 `cursor:pointer`

## 2. 测试

- [x] 2.1 更新 `sidebar-usage.test.tsx`：标题行展开/收起、正文与双箭头不展开、明细渲染全部上游
- [x] 2.2 包内 typecheck + vitest 全绿

## 3. 文档与截图

- [x] 3.1 README 截图：新增 `docs/usage.png` / `docs/usage.en.png`（额度卡），刷新 `settings.png` / `settings.en.png`（含侧栏额度开关）
- [x] 3.2 更新 `docs/SCREENSHOTS.md` 登记表与 README 图片引用
- [x] 3.3 CHANGELOG 0.6.1、`dsh.yaml` 版本与说明

## 4. 验收与归档

- [x] 4.1 `npm run typecheck`、`npm test`、`npm run build`、仓库 `npm test`、`check:artifacts`
- [x] 4.2 隔离 preview 真机验收（展开顶上去、列表不被覆盖）
- [x] 4.3 归档 change、同步 spec、合入 main、推远端
