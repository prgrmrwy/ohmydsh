# 本地全范围复核

2026-10-24；首轮为当前执行者本地复核。随后用户明确授权独立只读审查，已由 gpt-6-astra/medium 完成全范围审查及一次聚焦修复复核。范围为本 change 的现有 staged 提案与本轮全部 tracked/untracked package 改动；无 commit/merge/push、无 SSF 状态迁移、无部署。

## 默认升级增量复核（2026-10-25）

用户明确授权默认替换与移除版本入口，覆盖先前不推广决定。执行者本地复核settings默认解析、已有无policy配置、显式legacy回滚、UI仅显示有效映射、主请求epoch与状态、工具预览及指导。修改legacy测试fixture显式标记回滚，不将旧tier响应当新depth响应；增加缺省配置主状态/异步撤销覆盖，保持原有190测试通过。官方无policy配置 ordinary/fresh teammate+冷恢复探针通过。部署后3080真实GUI无版本开关、无旧映射编辑；原文件未改写，部署SettingsStore读取有效policy-v2。未新增独立reviewer，不将原独立PASS延伸到此增量。真实收益对照仍无结论。

## 已修复发现

1. **Important：Jev Choice 强制 string。** `String(choice)` 可使数组伪装合法标签；改为类型检查，测试拒绝数组，并忽略未请求维度，避免多余字段破坏独立判断契约。
2. **Important：切换策略时旧状态泄漏。** v2 state/setMode 曾包含 legacy 的最近档位与 history；改为剔除旧字段，专门测试 v2 仅呈现新 depth/effort，不触发全局模型选择同步。
3. **Important：全局 allowlist 不应扩大父会话快照。** 初始路由额外核验父 session 存在的官方 model-selection-policy；负例证明失配不发请求。
4. **Important：未完成决策恢复/取消/模式竞态不可重新分类后续消息。** 初始 pending 只在当前创建生命周期使用；恢复未完成记录 fail closed，取消与模式变化停止而非继承。自然卸载清理 pending。
5. **Important：应用证据不能只看 middleware 返回值。** 从实际 request/header 的 event data 比较并记录；另一个 request hook 改写时测试记录 failed。

## 独立评审与修复复核（18:38–18:51）

- 独立首审确认：宿主注入上下文被当作子任务外发（P1）；主模式往返切换没有撤销 v2 runtime（P2）；路由记录丢失时旧子会话可能静默继承（P2）。均已新增回归并修复。
- 输入使用官方 user source 过滤；主模式以 epoch 撤销旧异步结果和请求；已绑定 child 另写 `.bound` sidecar，记录缺失时停止，不误拦从未路由的 MANUAL child。
- 聚焦独立复核发现自定义 session binding 事件不能通过官方未知事件读取门槛，给出 fail，不冒称独立复核通过。随后本地修复为插件 sidecar，完全移除自定义事件；官方持久化整链关闭/重建宿主恢复已重新通过。
- 最后一次完整验证：typecheck、29 文件/184 测试、build、official ordinary + fresh teammate 冷恢复探针通过。sidecar 最终修复由独立 gpt-6-luna/high 聚焦复核，结论 PASS；其静态复核通过，但自身 `pnpm exec vitest` 因找不到命令而失败，未冒称独立复跑测试通过。测试与整链通过证据来自主会话。
- sidecar 是双份最小身份证据，不承诺整个插件状态目录同时删除后的检测，也不承诺旧版没有 marker 的记录丢失检测。没有修改宿主或 compat。

## Magpie 增量本地复核（2026-10-25）

执行者对 transport/家族映射、store schema、设置目录、preview 调用端及官方工具探针逐项本地检查；未另行派发独立 reviewer，先前独立 PASS 不延伸为此次增量审查结论。主要发现并修复：关闭 v2 后持久路由仍需 Magpie 目录，故 request replay 使用显式策略目录，不依赖 legacy catalog。

验证：typecheck、29 文件/190 测试、build，通过；官方 ordinary/fresh teammate 两种 transport 探针（原形及 `--magpie`）均全宿主冷恢复通过。严格 OpenSpec 与 diff check 通过。真实网关生成、真实 effort 消费、额度及保留集质量仍未验证；不部署、不调用本地 Claude/codex，也不添加额外模型 SDK。

## 已检查

- 原 rubric/默认四档映射、旧设置稀疏存储、MANUAL 不外发、新 v2 显式启用。
- 主固定模型，effort 独立；子显式约束优先、选定路径不足则停止。
- 官方 tools/execute 异步生命周期与 exact child ID，不使用 prompt 匹配绑定、不改宿主。
- 恢复记录不含原任务与凭据，严格 schema、哈希文件名、0600/0700、随机临时文件原子替换。
- official fresh ordinary/teammate 工具→provider→生产插件→fake adapter→完整宿主恢复；非仅 unit mocks。
- README、skill、支持矩阵明确区分 recommended/applied/真实任务验收。

## 保留边界

- 原子替换不是跨进程冲突锁；此实现假设同一宿主拥有该 child。未做断电、并行进程或磁盘故障注入。
- 整链的 allowlist 为合成服务 seam；真实 preset-scoped modelSelectionSettings 与 GUI 未验，不声称已部署组合通过。
- fork unsupported；未知工具名/远端路径不宣称拦截；真实子模型任务收益、返工与总成本未知。
- 所有 applied 都只是 request config 匹配，不是调用成功或 provider 实际内部 effort 消费证明。
- 4.2 部分仅真实 Jev 完成，真实子模型链未获预算；4.3 实际任务对照未运行；4.4 独立评审与最后 sidecar 聚焦复核已通过；不因此勾选真实调用/质量对照任务。

复核结论：在默认关闭、未部署、上述边界可见的试验开发范围内可以交付本地代码；不建议推广默认。最终检查结果见 package 的 policy-v2-development 文档。
