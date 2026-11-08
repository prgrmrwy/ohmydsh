# Design

## Context

动机见 proposal.md。现有 open-produced.ts 从 sessions.list.cwd 拼接相对路径；Panel.tsx 仅展示 basename。官方 DSH 0.2.2-rc.1 的 workspaceFiles.stat/readBytes 在 wire 上传 SessionId，由 Host 决定实际解析根与权限，返回 absolutePath；fileActions.save 支持授权 read(signal) 回调和 Web download，保留原始字节并管理 Blob URL。当前 main spec 对产出基线的窗口限定已落后于实现。真实 GUI 发现 Host 工具集合拿不到 Agent 工具展示器时，完整日志产出文件为空；本次将客户端既有 first-party mutation 词表移到 shared，在缺展示器时用于 Host 基线，并要求已成功完成的工具结果。工具识别范围保持不变，同步纠正当前 spec 的基线描述。

## Goals / Non-Goals

**Goals:** 路径展示、复制、打开与下载共用 Session 文件解析，复用官方权限、字节上限和下载生命周期。反馈留在对应文件行，可访问且不扩大链接流量。

**Non-Goals:** 目录打包、批量下载、任意路径输入、保存位置选择、额外服务器路由、变更现有文件发现范围。

## Decisions

1. 类型依赖官方 gateway/workspace-files/file-actions；客户端运行时从 ctx.get 取得现有服务，不复制 Host 文件读取实现。无新增网络目的地。相比增加 Connection RPC + node:fs，官方实现保留会话身份和权限语义。
2. 每个文件行负责一次 stat，缓存于组件生命周期，展示 Host absolutePath 和可复制路径。编辑器使用 stat.absolutePath，删除原 cwd 拼接逻辑；查不到时保留记录路径、显式报错。文件路径作为原始字符串传递，不编码、不 URL 化、不替换斜杠，因此中文、空格、#、%、POSIX/Windows 路径由 Host 统一处理。
3. 下载在点击时调用官方 readBytes(sessionId, 已解析路径或原始路径, {}, signal)，完整读取后确认未取消且 offset=0/eof=true；把 Uint8Array 作为 Blob 交给 fileActions.save(..., 'download')。使用返回 absolutePath 的 basename 作建议名，由官方 fileActions 完成跨平台文件名净化。Blob 不猜测 MIME，避免把 PDF/ZIP 错标为 application/octet-stream 后被官方重命名为 .bin。保留默认完整文件 cap（当前 32 MiB），超限明确提示，不实现分片组装。
4. 文件行以 sessionId+path 标识；切换或卸载 abort 路径/下载请求，过期结果不更新 UI；下载读取观察组件 signal，交付 Blob 的 read 回调同时观察组件和官方 fileActions 的 signal，避免取消后开始保存。使用行内 status/alert 和禁用忙碌按钮，避免把浏览器 requested 误报 saved。
5. Panel 以会话 key 重挂载，避免前一会话列表在 effect 更新前短暂泄漏。基线请求与重试在取消后不再应用。
6. 官方交付卡片提供 `deliverables.file.actions` 列表插槽，直接注册一个独立下载按钮。由标准 `sessionId/useChat` 与 actionUrl 中的原始 seq/index，在官方 Turn Location 的 `deliverables.presented` 数据中精确查找文件；不能按展示顺序、basename 或 DOM 文本猜路径。此插槽只公开原生动作 URL，不公开文件路径；0.2.2 的 /client 类型入口也未导出对应 Turn data 类型，读取时验证必要字段，避免引入私有深层 import。按钮复用原字节下载逻辑、取消与忙碌状态，用官方 contextMenus.notify 反馈；忽略表示 Host 桌面的 available 位，下载不调用原生打开动作。此扩展完全在客户端，刷新后生效，不要求重启 Host。Cordis 要求在使用者 fiber 显式注入 remote 及 remote.workspaceFiles、fileActions、contextMenus 等服务；卡片和面板均使用插件自身的 Context 调用服务，不能借用未声明这些依赖的工作台 tab Context。

## Risks / Trade-offs

- 完整读取使用内存且受官方 cap 限制 → 复用默认限制并给出超限反馈；大文件流式下载另行设计。
- Clipboard API 在不安全上下文/权限拒绝下不可用 → 路径始终可选中，复制失败明确提示。
- 元数据不是事务快照 → 每次下载重新读取文件，不承诺读取期间并发修改的快照一致性。
- 每行一次 stat 有请求成本 → 只针对已发现产出文件，卸载取消，不引入 watch 或轮询。
- 官方服务缺失 → 路径原文仍可见，操作显示能力不可用，不回退未授权读取。

## Migration Plan

提升本地包与 manifest 版本，构建并测试；经 dsh build 同步部署，第二次验证幂等。无需数据迁移，回滚对应源码/版本再 build。Host 不由本任务擅自重启；GUI 生效与浏览器验收状态单独报告。
