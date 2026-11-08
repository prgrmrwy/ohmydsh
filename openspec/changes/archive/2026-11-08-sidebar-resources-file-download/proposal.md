# Proposal

## Why

跨机访问 DSH 时，「文档/资料」里的产出文件只可在远端编辑器查看，无法下载到当前浏览器所在设备；文件行只有文件名，且客户端拼接 cwd 会偏离会话的实际文件解析根。

## What Changes

- 产出文件展示 Host 按会话解析的完整路径，支持复制路径。
- 为每个产出文件增加「下载」操作，经官方 Session 文件读取和 fileActions 保存原始字节到浏览器所在设备。
- 在官方交付文件卡片右侧的 `deliverables.file.actions` 插槽添加下载按钮；没有远端桌面时也可用，点击卡片主体仍预览。
- 修复 Host 拿不到 Agent 工具展示器时，完整日志基线漏掉已有 write/edit 产出文件的问题；复用既有判定词表，只采集成功完成的调用。
- 打开编辑器沿用同一个 Host 解析路径；读取失败、超限和不可用能力显示可理解反馈。
- **BREAKING**: 本地插件 0.2.0 起要求 DSH >=0.2.2-rc.1，以使用官方 fileActions 原始文件保存服务。
- 会话切换或卸载时取消旧的路径查询和下载读取，避免跨会话结果污染。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `sidebar-session-resources`: 增加远端路径展示/复制与文件下载，统一打开和下载的会话路径语义。

## Impact

影响 packages/sidebar-session-resources 的 Web 半区、测试、中英文说明、依赖声明及 manifest 版本。复用 DSH 0.2.2-rc.1 官方 remote.workspaceFiles 和 fileActions，不新增 Host 文件接口、文件权限、外部服务或持久数据。不涉及目录打包、批量下载和浏览器本地保存目录控制。
