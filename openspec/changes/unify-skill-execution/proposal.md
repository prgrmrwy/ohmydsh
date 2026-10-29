## Why

核心启动器已迁到 Node，但 ws 与 memex 报告 skill 仍以 Bash 作为默认入口，原生 Windows 无法直接使用相同流程。统一辅助入口和原生测试，避免文档重新引入 Bash 依赖。

## What Changes

- 两个 skill 提供独立、可部署的 Node 入口；旧 sh 只转发参数。
- 保留 CLI 查找优先级、退出码、参数边界、memex 多库和 eval-* 排除行为。
- Windows 解析真实 JS/native exe，不执行 cmd/ps1 shim，不安装依赖。
- 文档改用 Node；原生无 Bash 测试覆盖这两个辅助入口。

## Capabilities

### New Capabilities
- `cross-platform-skill-execution`: ws/memex 辅助入口的跨平台发现、调用、错误和多库合同。

### Modified Capabilities

无。核心启动器的平台适配保持现状。

## Impact

skills/ws、skills/memex-recall-report、tests、Node test driver。无新依赖、不改工具授权、不自动部署/重启、不清理worktree。保留已有严格门禁警告。
