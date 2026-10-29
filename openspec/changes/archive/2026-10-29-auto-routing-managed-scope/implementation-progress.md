# 实施进度与接缝阻塞

## 已执行

- Worktree dependency mode 已经通过 ws promote 转 mutable。
- 在 worktree `.probe-auto-scope` 隔离安装公开 pin 的 DSH 0.2.0-rc.2 / Cordis 4.0.4；不修改根 manifest/lock。
- 新增 `packages/auto-model-routing/scripts/probe-managed-identity.mjs`，只装配官方服务/工具及 fake adapter，global fetch 禁止网络。
- 最终命令 `node packages/auto-model-routing/scripts/probe-managed-identity.mjs .probe-auto-scope` exit 0，但该 exit 仅表示反例断言成立，不代表接缝通过。

## 实测结果

官方 ordinary 与 fresh teammate 的 tools/execute ALS 窗口内，先直接调用官方 `subagents.startContinuable` 创建 plugin-service-branch，再执行实际工具。两类旁支均发出 subagent/catalog，其 childId 匹配 startup 候选、parentSession 与 ALS 父身份。探针输出 `FAIL_SOURCE_ISOLATION`。这是允许使用的等价 catalog-producing 服务直建旁支，没有改宿主或 compat。

限制：当前装配没有观察到 pre-step/fake adapter 请求（calls=0），fresh teammate 返回 TEAM_PROVISIONING_CONFLICT。因此 catalogBeforeStep=false 表示未观察到 step，不能解读为 catalog 晚于 step；首轮时序与真实请求透传尚未验证。早期探针还修正过 startContinuable 参数形状，并避免重复使用持久 session id，这些失败不算产品缺陷。

## 修订后的继续点（2026-10-28）

上述探针否定了 catalog 能证明官方工具独占来源的旧 gate；它没有证明首轮时序、请求透传或 fresh teammate 创建成功。用户随后明确接受同窗口同父 startup 插件旁支可能一并受管，D1 已改为在 agent/created 以 ALS + parentSession + startup 绑定，不再使用 catalog，也不再以旁支隔离成功作为启用门槛。

业务代码尚未实施，原任务完成声明不因此增加。后续按修订后的 proposal、design 与 delta 推进，并验证窗口外插件透传、同窗口旁支一并受管、父快照、首次请求及恢复行为；不得把本探针 exit 0 或该用户决定写成这些行为已通过验收。

## 实施进度（2026-10-29 00:50）

已实现：注册表去 `transports`/`hasProvider`/`providers`，能力槽按目录与父前缀解析；`chooseChildRoute` 四步退化链；policy-host 受管判定移到 `agent/created(startup)`、写 `parentSelection`、无记录原样放行、fork 放行、Jev 失败/needs-context/模式变化/中断改为 unsupported+告警、已有 route 每次请求复核实时门禁；policy-store provider 改字符串、状态组合校验、`create` 强制父快照；settings-host 按 provider 读目录；route_subagent 去 provider 枚举与 family、fallback/needs-context/取消区分；state 对子会话短路 `{applicable:false}`、childRouting 附 scopeNote、根 state 带 childNotice；client 子会话不渲染芯片并停轮询、面板与 toast 显示未路由告警；skill 与 `instructions/dsh-home.md` 改为预览可选。

验证（实际运行）：package `npm run typecheck` 0、`npm run build` 0、vitest 30 文件 244 通过；根 `npm test` pass 638 / fail 0 / skipped 2；`npm run check:artifacts` 通过。

未完成：test-plan 74 行尚未逐行以 `AMR-xxx` 命名测试并翻 green；已有回归与新增测试覆盖了核心场景，但逐场景账本、verify.md、主 spec 同步尚未做。`.probe-auto-scope/` 为未跟踪的隔离探针依赖，收尾前删除。
