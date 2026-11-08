# Proposal

## Why

PR #32 的原生 Windows CI 在依赖安装后被既有的 POSIX 0700 检查阻塞。Windows 需要真实 SID/DACL 校验，不能通过跳过权限检查修复；独立安装的 Pet 也必须安全发布同一种含认证 URL 的停止发现文件。

## What Changes

- 为 launcher 的私有 patch/停止发现文件添加原生 Windows 创建和校验，保留 POSIX UID/mode 与文件身份检查。
- Pet 的停止发现文件发布/清理使用同一权限语义，但仍随 Pet 独立打包，不依赖仓库 launcher 路径。
- 在原生 Windows lane 加入真实 DACL、继承和 junction 的正反例，保留所有现有测试及鉴权/停机协议字段。
- 本 PR 已复用独立基线 #34 的推荐/最新 Node 24 矩阵纠正，不以移除 Windows lane 消除失败。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cross-platform-launcher`: 明确 launcher 私有文件以及与独立 Pet 生产者共享的停止发现文件权限契约，使用平台实际权限模型。

## Impact

内部文件系统 helper、三个 launcher 调用方、Pet 的 descriptor publisher/release 和相关测试；现有函数签名、StopDescriptor/wire/schema、Connection 鉴权和 freeze/drain/resume 责任不变。无新运行时依赖、无需改变 DSH pin 或部署实际 Host。不自动修复未知/过宽的既有 ACL；旧的不安全缓存仍拒绝使用。
