# 任务：侧栏额度自动刷新改为真实刷新

## 1. 客户端行为

- [x] 1.1 `SidebarUsage` 自动刷新 effect 改为 `refreshCards(api)`（`POST cards {all:true}`），成功才 `setView`，失败静默保留旧读数
- [x] 1.2 更新 `SidebarUsage` / `sidebar-api` 的说明注释，解释网关 GET 只读缓存、定时器必须走刷新
- [x] 1.3 单测：默认 5 分钟发一次 `POST cards {all:true}` 并更新读数、没有额外 `GET`
- [x] 1.4 单测：间隔 0 不刷新、页面隐藏不刷新、刷新失败保留旧读数且不显示错误

## 2. 规范

- [x] 2.1 delta spec 移除「侧边栏额度自动刷新」（定时只读缓存无法拿到新读数），新增「侧边栏额度定时刷新」，并同步修改「用量入口与颜色（AMD4）」「侧边栏卡片的展开、收起与读取」

## 3. 交付

- [x] 3.1 `dsh-magpie-connector` 版本升到 0.6.9，CHANGELOG 记录用户可见变化
- [x] 3.2 中英 README 的自动刷新说明改为「按间隔真实刷新（网关重读）」
- [x] 3.3 包内 `vitest run`（536 通过）、`typecheck`、`build`、仓库 `check:artifacts`、`tests/manifest-notes.test.mjs` 通过；仓库 `npm test` 的其余失败是 worktree 根依赖未 bootstrap 的既有环境问题（EACCES、launcher 报「根依赖不完整」），与本 change 无关
- [x] 3.4 归档本 change
