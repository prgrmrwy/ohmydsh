## Test Plan

All 128 `#### Scenario:` entries across the four delta specs (`pet-lark-channel`, `pet-locus-collaboration`, `pet-locus-intent-triage`, `pet-locus-doc-comments`) map 1:1 to a named vitest test under `packages/dsh-pet/test/`. The test name is always `spec Scenario "<scenario name>"`. When the same scenario name occurs in two capabilities and the two tests share a file, the capability is appended in parentheses.

This table is a live ledger. During apply, flip each row from 🔴 to 🟢 when its test passes. verify blocks on any row still red.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | 启用 channel 后启动订阅 | packages/dsh-pet/test/channel-subscription.test.ts | spec Scenario "启用 channel 后启动订阅" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | 单连接同时承载群消息与评论 | packages/dsh-pet/test/channel-service.test.ts | spec Scenario "单连接同时承载群消息与评论" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | compact 群消息与既有准入兼容 | packages/dsh-pet/test/channel-event.test.ts | spec Scenario "compact 群消息与既有准入兼容" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | 卡片消息静默丢弃 | packages/dsh-pet/test/channel-pipeline.test.ts | spec Scenario "卡片消息静默丢弃" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | 停止时回收整个进程组 | packages/dsh-pet/test/channel-subscription.test.ts | spec Scenario "停止时回收整个进程组" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | stderr 原文不落盘 | packages/dsh-pet/test/channel-subscription.test.ts | spec Scenario "stderr 原文不落盘" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | 内部重连不推进水位 | packages/dsh-pet/test/channel-subscription.test.ts | spec Scenario "内部重连不推进水位" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | lark-cli bot 身份不可用 | packages/dsh-pet/test/channel-subscription.test.ts | spec Scenario "lark-cli bot 身份不可用" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | 升级后默认不消费事件 | packages/dsh-pet/test/channel-service.test.ts | spec Scenario "升级后默认不消费事件" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | Channel 关闭时为配对临时订阅 | packages/dsh-pet/test/channel-pairing-service.test.ts | spec Scenario "Channel 关闭时为配对临时订阅" | 🟢 green |
| specs/pet-lark-channel/spec.md → 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触 | 配对结束后按运行原因回收 | packages/dsh-pet/test/channel-pairing-service.test.ts | spec Scenario "配对结束后按运行原因回收" | 🟢 green |
| specs/pet-lark-channel/spec.md → 未通过准入的入站消息保持飞书侧静默但 Host 可诊断 | Channel 关闭时收到消息 | packages/dsh-pet/test/channel-pipeline.test.ts | spec Scenario "Channel 关闭时收到消息" | 🟢 green |
| specs/pet-lark-channel/spec.md → 未通过准入的入站消息保持飞书侧静默但 Host 可诊断 | 非 allowlist 用户 @ Bot | packages/dsh-pet/test/channel-pipeline.test.ts | spec Scenario "非 allowlist 用户 @ Bot" | 🟢 green |
| specs/pet-lark-channel/spec.md → 未通过准入的入站消息保持飞书侧静默但 Host 可诊断 | 评论范围无法判定 | packages/dsh-pet/test/channel-service.test.ts | spec Scenario "评论范围无法判定" | 🟢 green |
| specs/pet-lark-channel/spec.md → 未通过准入的入站消息保持飞书侧静默但 Host 可诊断 | 目标群调用因权限失败 | packages/dsh-pet/test/channel-lark.test.ts | spec Scenario "目标群调用因权限失败" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 无其它连接时启动 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "无其它连接时启动" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 旧 bus 在空闲期内 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "旧 bus 在空闲期内" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 他方持续占用连接 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "他方持续占用连接" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 监督器重启时上一条连接尚未释放 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "监督器重启时上一条连接尚未释放" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 连接计数接口暂时失败时退避重试 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "连接计数接口暂时失败时退避重试" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 连接计数接口持续失败 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "连接计数接口持续失败" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 启用时 IM 前置条件被阻断 | packages/dsh-pet/test/channel-service.test.ts | spec Scenario "启用时 IM 前置条件被阻断" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | dry-run 报告 unknown 时照常启用 | packages/dsh-pet/test/channel-service.test.ts | spec Scenario "dry-run 报告 unknown 时照常启用" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 门禁等待期间停用 channel | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "门禁等待期间停用 channel" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | Host 启动恢复已启用 channel 时执行 dry-run | packages/dsh-pet/test/channel-service.test.ts | spec Scenario "Host 启动恢复已启用 channel 时执行 dry-run" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 评论事件未开通不影响 IM | packages/dsh-pet/test/channel-service.test.ts | spec Scenario "评论事件未开通不影响 IM" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 单实例锁被占用 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "单实例锁被占用" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | lark-cli 版本过低 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "lark-cli 版本过低" | 🟢 green |
| specs/pet-lark-channel/spec.md → 事件连接独占在拉起订阅前被证明 | 就绪超时 | packages/dsh-pet/test/channel-connection-gate.test.ts | spec Scenario "就绪超时" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 统一关联主会话子会话与飞书入口 | 同一研发主会话服务多个现场 | packages/dsh-pet/test/locus-repository.test.ts | spec Scenario "同一研发主会话服务多个现场" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 统一关联主会话子会话与飞书入口 | 同群话题关联不同主会话 | packages/dsh-pet/test/locus-controller.test.ts | spec Scenario "同群话题关联不同主会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 统一关联主会话子会话与飞书入口 | 子会话不能作为绑定源 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "子会话不能作为绑定源" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 统一关联主会话子会话与飞书入口 | 既有群入口键不变 | packages/dsh-pet/test/locus-repository.test.ts | spec Scenario "既有群入口键不变" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 统一关联主会话子会话与飞书入口 | 文档与群标识不串键 | packages/dsh-pet/test/locus-admission.test.ts | spec Scenario "文档与群标识不串键" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 统一关联主会话子会话与飞书入口 | 规范化不丢失文档前缀 | packages/dsh-pet/test/locus-repository.test.ts | spec Scenario "规范化不丢失文档前缀" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 群级引用触发消息 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "群级引用触发消息" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 话题回复留在原话题 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "话题回复留在原话题" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 文档评论回复回到触发评论 | packages/dsh-pet/test/locus-doc-finish.test.ts | spec Scenario "文档评论回复回到触发评论" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 文档回复目标与入口不符 | packages/dsh-pet/test/locus-doc-finish.test.ts | spec Scenario "文档回复目标与入口不符" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 升级需离线迁移并先备份 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "升级需离线迁移并先备份" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 未迁移时 v16 拒绝打开 | packages/dsh-pet/test/migration-guidance.test.ts | spec Scenario "未迁移时 v16 拒绝打开" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | v15 拒绝打开 v16 库 | packages/dsh-pet/test/pet-storage-backend.test.ts | spec Scenario "v15 拒绝打开 v16 库" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | turn 结束不完成请求 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "turn 结束不完成请求" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 相对等待受绝对上限约束 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "相对等待受绝对上限约束" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 超时自动开放下一条 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "超时自动开放下一条" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 完成与超时竞争 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "完成与超时竞争" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 迟到 finish 不消费下一条 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "迟到 finish 不消费下一条" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 发送确认未知不重放 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "发送确认未知不重放" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | Host 重启恢复未过期 current | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "Host 重启恢复未过期 current" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | Host 重启处理遗留 finishing | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "Host 重启处理遗留 finishing" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 私聊与群消息交错 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "私聊与群消息交错" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 旧代际迟到结算 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "旧代际迟到结算" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 宿主重启无法证明关联 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "宿主重启无法证明关联" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 同名入口仍可区分 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "同名入口仍可区分" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 名称不可得时不猜测 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "名称不可得时不猜测" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 短码不是身份 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "短码不是身份" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 文档入口短码确定且与群可区分 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "文档入口短码确定且与群可区分" | 🔴 red |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 多个文档入口短码互不相同 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "多个文档入口短码互不相同" | 🔴 red |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 同前缀的评论入口短码可区分 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "同前缀的评论入口短码可区分" | 🔴 red |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 文档标题不可得 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "文档标题不可得" | 🔴 red |
| specs/pet-locus-collaboration/spec.md → 自动主会话按群建立且只使用 default workspace | Project 群先行 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "Project 群先行" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 自动主会话按群建立且只使用 default workspace | 首次消息补齐 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "首次消息补齐" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 自动主会话按群建立且只使用 default workspace | 重复初始化 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "重复初始化" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 自动主会话按群建立且只使用 default workspace | default 不可用 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "default 不可用" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 自动主会话按群建立且只使用 default workspace | 文档首次评论建立文档专属主会话 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "文档首次评论建立文档专属主会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 唯一命中的整词引用成为真实提醒 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "唯一命中的整词引用成为真实提醒" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 裸 open_id 引用也成为真实提醒 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "裸 open_id 引用也成为真实提醒" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 同名歧义不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "同名歧义不改写" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 非成员名字与词内 @ 不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "非成员名字与词内 @ 不改写" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 非成员 open_id 不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "非成员 open_id 不改写" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 已是标记形式则不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "已是标记形式则不改写" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 成员表不可读时仍能发出 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "成员表不可读时仍能发出" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 注入说明平台写法 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "注入说明平台写法" | 🔴 red — carried forward; regression |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 文档回复不渲染 @ | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "文档回复不渲染 @" | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 受理动作自述会开工 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "受理动作自述会开工" | 🔴 red — carried forward; regression |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 受理成功后转到执行目标会话 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "受理成功后转到执行目标会话" | 🔴 red — carried forward; regression |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 导航后仍能分辨投递结局 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "导航后仍能分辨投递结局" | 🔴 red — carried forward; regression |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 缺少导航能力时受理照常完成 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "缺少导航能力时受理照常完成" | 🔴 red — carried forward; regression |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 受理失败不导航 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "受理失败不导航" | 🔴 red — carried forward; regression |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 请求执行不触发界面导航 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "请求执行不触发界面导航" | 🔴 red — carried forward; regression |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 话题待办跳回原话题 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "话题待办跳回原话题" | 🔴 red — existing test, re-run after change |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 话题身份不可证时退化 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "话题身份不可证时退化" | 🔴 red — existing test, re-run after change |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 会话已归档时不可跳转 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "会话已归档时不可跳转" | 🔴 red — existing test, re-run after change |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 退役 locus 的待办仍在列表中 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "退役 locus 的待办仍在列表中" | 🔴 red — existing test, re-run after change |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 文档评论待办跳到文档 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "文档评论待办跳到文档" | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 管理面呈现待办并提供由固定标识派生的跳转 | 文档 URL 不可得 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "文档 URL 不可得" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 全文评论进入文档级入口 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "全文评论进入文档级入口" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 划词评论进入评论级入口 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "划词评论进入评论级入口" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 重启后再投递排队中的划词评论 | packages/dsh-pet/test/locus-doc-redelivery.test.ts | spec Scenario "重启后再投递排队中的划词评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 划词评论下的后续回复留在同一入口 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "划词评论下的后续回复留在同一入口" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 划词评论先于文档级 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "划词评论先于文档级" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 知识库文档以底层 token 为根 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "知识库文档以底层 token 为根" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 评论查询一次失败后重试成功 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "评论查询一次失败后重试成功" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 评论查询重试期间停用 channel | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "评论查询重试期间停用 channel" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 无法判定全文或划词 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "无法判定全文或划词" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 非 docx 评论 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "非 docx 评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 非 allowlist 成员在已授权文档提问 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "非 allowlist 成员在已授权文档提问" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 非 allowlist 成员首次 @ 未初始化文档 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "非 allowlist 成员首次 @ 未初始化文档" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | shell 档文档拒绝他人 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "shell 档文档拒绝他人" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 划词评论先建立时也披露 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "划词评论先建立时也披露" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 建立回执披露提问范围 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "建立回执披露提问范围" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 未 @bot 的评论 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "未 @bot 的评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 来自 agent 或 bot 的评论 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "来自 agent 或 bot 的评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 同一回复重复到达 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "同一回复重复到达" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 长线程中的触发回复 | packages/dsh-pet/test/channel-lark-drive.test.ts | spec Scenario "长线程中的触发回复" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 触发回复正文不可得 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "触发回复正文不可得" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 全文评论绑定已知会话 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "全文评论绑定已知会话" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 文档改绑后已有划词评论不迁移 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "文档改绑后已有划词评论不迁移" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 划词评论内绑定只影响该评论 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "划词评论内绑定只影响该评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 非 allowlist 控制命令 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "非 allowlist 控制命令" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 文档评论回复回到触发评论 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "文档评论回复回到触发评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 回复目标与入口不符 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "回复目标与入口不符" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 过期的反馈 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "过期的反馈" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 表情接口失败 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "表情接口失败" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 评论回复发送结果未知 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "评论回复发送结果未知" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | shell 档直接调用评论或文档写命令 | packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts | spec Scenario "shell 档直接调用评论或文档写命令" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档子会话的工具面 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "文档子会话的工具面" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档 Delivery 不调用 IM 接口 | packages/dsh-pet/test/doc-comment-im-scoping.test.ts | spec Scenario "文档 Delivery 不调用 IM 接口" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 触发者姓名查询失败 | packages/dsh-pet/test/doc-comment-im-scoping.test.ts | spec Scenario "触发者姓名查询失败" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档待办跳转 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "文档待办跳转" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | IM 入口不受影响 | packages/dsh-pet/test/doc-comment-im-scoping.test.ts | spec Scenario "IM 入口不受影响" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | 读取当前评论线程与文档 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "读取当前评论线程与文档" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | 内容中嵌入指令 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "内容中嵌入指令" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | 无 current Delivery 时读取 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "无 current Delivery 时读取" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | bot 失去文档读取权限 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "bot 失去文档读取权限" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 管理面呈现文档入口且不提供新建入口 | 文档与评论嵌套呈现 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "文档与评论嵌套呈现" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 管理面呈现文档入口且不提供新建入口 | 标题不可得 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "标题不可得" | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → 管理面呈现文档入口且不提供新建入口 | 无建立控件 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "无建立控件" | 🔴 red |

## Coverage Notes

### What the initial-state labels mean
- **🔴 red**: a new scenario, or a carried-forward scenario whose THEN changes in this change. This covers the channel scenarios rewritten for the `+subscribe` transport: "启用 channel 后启动订阅", "Channel 关闭时为配对临时订阅" and "配对结束后按运行原因回收". The test must be written, or rewritten, so that it fails against the current code for the right reason.
- **🔴 red — carried forward; regression**: the scenario text is unchanged from the current spec, or reworded only. The MODIFY re-states the full current requirement, and anvil requires a named test for every scenario. Most of these have an existing test whose title does not yet carry the `spec Scenario "…"` name. During apply:
  - add the scenario name to the existing test; or, if none exists, write one;
  - check that it fails if the behaviour is removed, for example by temporarily inverting an assertion or reverting the guarded line, then restore it;
  - flip the row to 🟢 once it passes on the new code.

  These rows matter because the transport and endpoint changes touch shared code paths: subscription, admission, endpoint keys, delivery and mentions. They are the regression net.
- **🔴 red — existing test, re-run after change**: `ledger-view.test.ts` already names four intent-triage scenarios. Re-run them after the jump-target change. A new doc branch must not alter thread or chat classification.

### Test infrastructure needed (built in tasks group 1)
- **`test/fixtures/lark-subscribe/`**: compact `+subscribe` lines.
  - `im.message.receive_v1`: text, post, quoted reply (`reply_to`), topic (`thread_id` + `root_id`), multi-mention.
  - `interactive` raw envelope.
  - `drive.notice.comment_add_v1`: add_comment whole, add_comment anchored, add_reply, docx inside a wiki, sheet, `is_from_agent`.
  - Sources: spike captures `p1`/`w1`/`c2`/`p2`, redacted, with ids replaced by fixed fakes. IM field shapes follow lark-cli v1.0.97 `processor_im_message.go`; drive shapes follow `processor_generic.go`.
- **`test/fixtures/lark-drive/`**: `+batch-query-comments` responses.
  - `is_whole` true and false; `quote`; replies; `has_more`.
  - Paginated `+list-replies` pages.
  - `+add-reply` success, error and timeout.
  - `+react-reply` success and error.
  - `+inspect` success (title, url) and failure.
  - `docs +fetch` markdown, with an embedded instruction line.
- **A fake lark-cli process factory**: extend the existing `FakeChild` in `channel-subscription.test.ts`.
  - Two-level shim→native process group, so tests can assert group SIGTERM and that no native process is left as an orphan.
  - Scripted stderr lines: `Connected.`, `[SDK Info] connected to wss://…access_key=AK&ticket=TK`, `trying to reconnect`, and the lock-held JSON error.
  - Scripted exit codes.
- **A fake gate port**, so each gate is unit-testable without spawning a process:
  - version string;
  - dry-run JSON for the enable/reconnect check (`ok` / `unknown` / `blocked` per precondition);
  - a scripted sequence of `online_instance_cnt` readings and errors;
  - a controllable clock, used for the 2 s polling and the 40 s gate wait;
  - for "评论查询一次失败后重试成功": a scripted comment-query port (fail, then succeed) with the same clock driving the 2 s / 5 s retry delays.
- **Storage version fixtures**: a v15-stamped sqlite medium with IM loci, and a v16-stamped one with IM and doc loci. Use them for `migrate-cli`, `pet-storage-backend` and `migration-guidance`.
- **A leak sentinel for "stderr 原文不落盘"**: capture every Host log sink, every persisted row and the diagnostics API output, then assert that none of them contains `AK`, `TK` or `wss://`.

### Scenarios that need a specific assertion style
- **"文档 Delivery 不调用 IM 接口"**: record every lark-cli argv the fake client receives across accept, deliver and finish. Assert there are no `im` subcommands, IM `api` paths, or chat member/history calls.
- **"无建立控件"**: render the management view model, enumerate its interactive controls, and assert that none accepts a URL, token or session id input.
- **"内容中嵌入指令"**: assert that the line appears only inside the tool-result text block, after the fixed untrusted label, and is absent from the system and user messages in the composed turn.
- **"重启后再投递排队中的划词评论"**: use the real `LocusRepository`, reopened on the same `MemoryMedium`, and the real controller `dispatchNext`. A stubbed dispatch would repeat the pitfalls §11 "both layers green" trap. A counting fake `LarkClient` must record zero `queryDocComment` calls. Compare only the four comment facts named in the scenario (scope, quote, trigger text, sender), because the routing preamble and the readability line legitimately differ after a restart.
- **"多个文档入口短码互不相同" / "同前缀的评论入口短码可区分"**: use the literal ids from the spec. The expected comment codes are `cmt·5186` and `cmt·0665`.

### Non-executable checks
None. Every scenario has a code-level test. The specs also gate on `openspec validate pet-locus-doc-comments --strict`, but that does not replace any scenario test.

### Live/manual acceptance (not a substitute for the tests above)
The tasks file includes a final live acceptance on a disposable Feishu app, not the production dsh-pet app. It repeats E1, E3 inverted (Pet's single connection plus a probe), E8, E12 and E15 against the built package. It is recorded in `verify.md` and does not flip any row in this table.
