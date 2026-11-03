## Context

DSH pin 为 0.2.0-rc.2。Team 创建监听早于 subagent descriptor，可能在 child own scope 安装九项工具；allow:[] 仅过滤继承工具。前序独立实验已完成 81 个官方 DSH 包的安装、815 pass/1 live skip、额外 19 项 Team 边界、完整六条件自检和模块解析审计。这里将候选落入正式源码，所有最终结果重新验证，不把实验结果当提交快照的证明。

原 evaluation-harness change 尚未归档，正式 integration spec 未包含其全量内容。本 change 只向已有 dsh-memex-integration 增加宿主独立性要求，不代为合并或归档原 change。

## Goals / Non-Goals

Goals：Memex 自持裁判隔离；测试默认使用官方依赖，支持显式外部 Host 图回归；严格边界与生命周期保持。

Non-Goals：修复 Team roster、删除 Pet 自身补丁、改变评分协议/历史数据、移除 AUTO 的既有 MANUAL 服务契约、发版/推送/重启。

## Decisions

1. 仅在 exact child 创建监听中安装 scoped assembly waterfall，删除已知九项 Team schema。原执行 guard、complete prompt/context suppression、最终真实请求门禁全部保留。相比搬运 Team patch 或另造裁判运行时，此方案使用公开接口且生产改动只落在既有边界。
2. 只排除已知 Team 名称；未知工具继续触发最终拒绝，避免无条件隐藏装配污染。Team 分类仍可能错误，隔离不宣称修复通用 Team 行为。
3. 测试从包自身 package.json 解析依赖；通过 MEMEX_TEST_HOST_PACKAGE 允许显式、存在的绝对文件选择附加 Host 图。共享最小解析 helper，保证 LLM 私有 loop-request 身份与宿主实例一致；不自动猜测路径。
4. 默认裁判 runtime 测试装配真实官方 Team，复用既有 19 个安全/成功场景，另保留无 Team 场景，不复制整套测试。补齐官方 rc.2 开发依赖和 jsdom/react-dom，不添加 runtime Team 依赖。
5. 原集成测试里的 compat 路径和修复后 roster 断言改为版本/图身份及裁判实际行为断言，保留六条件、八回合、十二裁判、作业释放、取消竞态、预算与恢复全部检查。

## Risks / Trade-offs

- 新版 Team 增加工具 → 未知名称由最终门禁拒绝；升级 pin 时重新核查名单，不能静默扩大隔离范围。
- 工具仅从展示中排除但仍注册 → 现有 scoped 执行 guard 拒绝其它工具，生命周期由原有 finally dispose 收尾；补真实 Team 下执行负例。
- 多份 LLM 导致 WeakSet 品牌不一致 → 集成测试转发所选图的真实 LLM 导出，新增解析 helper 不导入业务 SDK。
- 外部图能掩盖默认依赖问题 → 官方默认全包与独立无 Pet 安装为必验，外部图只作补充。

## Migration Plan

先补测试并确认目标行为 RED，再落入局部隔离和独立依赖接线；验证全包、构建、typecheck、独立官方图和现有兼容图，完成整体评审与规范同步。本地提交后按仓库流程从主 checkout 受管构建两次，更新部署产物并验证第二次无变更；运行中的日常 Host 等用户决定是否重启。回滚可撤销此提交再受管构建，历史轮次与库内容无需迁移。

## Open Questions

无待用户决策的实现问题。真实 provider/日常 Host 验收不属于本次授权范围，应在结果中明确披露。
