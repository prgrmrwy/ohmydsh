# 实施与验证

2026-10-26，GPT 系 `codex/gpt-6.1-sol` 在受管 worktree 本地实施；未部署、未重启、未合并。

## 完成
- D012：连续两个 baseline 用户回合，第二个无新 request/header，仍绑定新主决策并引用有效头 seq；外层 waterfall 把实际 effort 改为 high 时拒绝绑定。旧实现上第一例 RED（label 返回空），修复后通过。
- 事实账本：exposed/manual-switch 首次追加、决策级去重、重启回放、与绑定和显式反馈隔离；observe 参数/无绑定/子会话/重复/磁盘失败边界测试通过。
- MANUAL：真实 RPC 路由测试覆盖 invalidate 前捕获、回合中途、回合结束、重复切换、无效请求与新决策替换。
- 曝光：React DOM + fake IntersectionObserver/clock 覆盖连续 3 秒、离开视口重置、页面隐藏、失焦、清理、未绑定与 legacy 排除。不是浏览器真实可见性验收。
- 报告：实际回合号、后续用户回合、有效曝光时间窗、五类互斥、parent 取消、后续非用户回合中止、旧记录及尾段不完整。既有 CLI 只读权限测试保持通过。

## 检查
- package typecheck：通过。
- package vitest：33 文件，242 测试通过。中间一次全套运行失败，随后变更路径的 56 个测试以及完整 242 个测试重跑均通过；未据此声称没有潜在时序不稳定。
- package build：通过，仅已有 tsdown external/模块格式提示。
- 仓库 npm test：622 项，620 通过、0 失败、2 跳过。
- check:artifacts、git diff --check、OpenSpec strict：通过。

## 本地审查
核对 source -> applied main -> message binding -> observation/RPC -> append-only facts -> report 全链。
- 主决策与子 latest 隔离；只有 recommended 候选允许无新头回退确认，failed/unsupported 不重试确认。
- MANUAL 捕获在 invalidate 之前、追加在响应成功之后。
- 浏览器时间不可信任：事实 at 由 Host 产生；报告排除继续之后的曝光。
- 继续查找预先按回合索引，不在每次调用上重复扫描全部用户回合。
- 无新增模型调用、定时任务或策略回灌；无新增依赖。

## 尚未完成
任务 5.3：需用户确认部署/重启时机，在既有 3080 GUI 验证反馈图标、真实曝光事实及 implicit-ok。未上传或回填真实会话数据；未运行生产用量报告。当前分支比主 checkout 旧，不能直接从此 worktree 跑全仓 sync。
