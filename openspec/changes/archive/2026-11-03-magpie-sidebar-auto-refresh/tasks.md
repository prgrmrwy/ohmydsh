# 任务

## 1. host

- [x] 1.1 `Settings` 增加 `sidebarRefreshMinutes`；`writeSettings`/`settingsView` 透出（默认 5）
- [x] 1.2 `routes.ts` 允许 `sidebarRefreshMinutes`，校验 0–1440 整数，非法 400
- [x] 1.3 host 测试：默认值、写入持久化、非法值拒绝、0 表示关闭

## 2. client

- [x] 2.1 `sidebar-preference` 扩为 `{usage, refreshMinutes}`，hydrate 同时读取
- [x] 2.2 `SidebarUsage` 定时器：默认 5 分钟、0 关闭、隐藏暂停、卸载清理、静默失败
- [x] 2.3 设置页「Sidebar usage」面板增加分钟输入（0 = 关闭），写入并同步 store
- [x] 2.4 组件/设置页测试：定时读取、0 不读、非法输入回退

## 3. 文档与截图

- [x] 3.1 CHANGELOG 0.6.1、README/README.zh、`dsh.yaml` 说明
- [x] 3.2 刷新设置页截图（含自动刷新输入）与 README 图片引用、SCREENSHOTS.md 登记

## 4. 验收与归档

- [x] 4.1 package typecheck/test/build、仓库 test、check:artifacts
- [x] 4.2 隔离 preview 真机验收（自动刷新间隔生效、0 关闭）
- [x] 4.3 归档、同步 spec、合入 main、推远端
