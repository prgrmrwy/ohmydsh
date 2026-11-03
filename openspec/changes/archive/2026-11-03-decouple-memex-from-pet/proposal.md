## Why

Memex 固定自检当前依赖 Pet 提供的 Team 创建窗口修复，两个集成测试还直接加载 Pet launcher。前序独立验证已证明：使用官方 DSH 0.2.0-rc.2 的裁判局部工具投影、原有执行 guard 与最终请求门禁，可以在保留 Team 的情况下取得同等隔离保证，应将该方案落实到插件。

## What Changes

- 裁判子会话使用官方 scoped `system-prompt/assemble` 接口过滤已知九项 Team 工具展示；保留全部真实请求身份、上下文、route/schema 核验和执行 guard，未知工具仍拒绝。
- Memex 测试默认使用自身声明的官方依赖，移除 Pet launcher 和 compat 路径断言；允许显式指定任意已存在的 Host package.json 作附加回归，不自动发现 Pet。
- 在既有裁判测试中启用真实原版 Team，并保留无 Team 的成功场景；完整六条件测试继续覆盖清退、取消、预算与恢复。
- 补齐单包运行所需的官方开发依赖和 UI 测试依赖，维护根 lockfile；补充独立运行与验证说明。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dsh-memex-integration`：新增官方宿主独立运行与测试装配要求，明确裁判局部工具投影及严格执行/请求边界。

## Impact

- 涉及 `packages/dsh-memex/src/eval/judge-boundary.ts`、集成测试、开发依赖、README 和根 lockfile。
- 不修改卡片、scope、冻结评分协议、历史轮次或模型默认值语义；不增加运行时 Pet/Team 依赖。
- Pet 的通用 Team 修复仍由 Pet 自身使用方决定去留，本 change 不删除它；原 evaluation-harness change 保留独立状态。
- 用户已于 2026-11-03 要求按正常流程正式解除依赖。本 change 范围为实现、离线验证、本地提交及按仓库流程受管构建物化；不发布、不推送、不重启日常 Host。
