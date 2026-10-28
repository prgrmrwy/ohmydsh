## 执行边界

第三轮 APPROVE_WITH_CHANGES，RC1/RC2 已经独立复核，CHANGES_APPLIED: yes。本文件是实施准备，不是实施授权。所有任务尚未开始，需用户另行明确启动 apply。

依赖顺序如下。各组测试名与编号以 test-plan.md 为准。每个场景先写测试并确认因缺少目标行为而红（非导入/语法失败），再实现，再重构；已有原行为回归不得伪造失败。每个具名测试通过后及时将 test-plan 的对应行改绿。

## 1. 固定资源与独立路径

- [x] 1.1 写失败测试 EVAL-005–011：受信固定资源、嵌套链接/内容替换/已有目标拒绝、唯一 cwd 派生与 personal 关闭；补硬链接、异常文件、派生尾段碰撞边界。
- [x] 1.2 实现固定三题资源及发布哈希校验、分阶段独占物化、无 clone 的 Git 初始化与实际 Host scope 预检适配；只使用独立测试目录，不改真实库。
- [x] 1.3 重构；运行资源/路径测试与现有 scope、workspace-decisions、settings 回归，保持全绿。

## 2. 冻结与持久身份

- [x] 2.1 写失败测试 EVAL-012–013、021–023：冻结实际输入、旧输入删除后的重建、输入损坏拒绝、创建响应丢失、Host 侧后代登记、turn-end 后 jobs 未停。
- [x] 2.2 实现 round 实际输入快照与哈希、私有 raw 身份账本及公共哈希登记、稳定指定 sessionId 与请求幂等；保留失败现场，不复用路径。
- [x] 2.4 写失败测试 EVAL-057–061：failed/缺证据停止、测试根归档静止而非销毁、精确 owner 过滤及连续释放证据；验证不误取消 unowned、drain后末次清inbox和可信结算保留记录。
- [x] 2.5 实现首资源前事件订阅与 Host generation、sticky unhealthy、归档测试根/cancel/whenIdle、可信 completed/killed 释放证明与正式后代 drain；不把 terminal/空列表当证明。
- [x] 2.3 重构；运行冻结/身份测试和遥测回归。

## 3. Host 桥与默认值只读披露

> 3.1/3.3 未勾：要求验证“鉴权/Origin/未认证拒绝”（EVAL-032），该拒绝由 DSH Connection 层施加，只能在运行中的 Host 上验证，需部署授权。memex 侧不变量（无自建监听、桥只挂在 Connection rpc handler）已离线测试。

- [ ] 3.1 写失败测试 EVAL-019–020、030–034：未知字段/任意模型证据路径、鉴权/Origin、父会话已用、超时断连、dispose 失败、硬中断下次告警及无恢复写操作。
- [x] 3.2 实现固定轮次注册/状态/评分/取消与 readDefaultModel 的窄接口；参数从受信冻结计划取得，沿用 Connection 防线；Host 拥有 AbortController 和 run 清退，禁止任意默认值写回。
- [ ] 3.3 重构；运行桥与默认值测试，验证 Host authority/跨源/未认证拒绝和日常会话无副作用，不把 Connection 认证说成 socket 本机来源证明。

## 4. 裁判真实组合与首次请求门禁

- [x] 4.1 用真实 Cordis/agent-loop/spawn/tools 与 mock LLM 写失败集成测试 EVAL-024–029：structured_output 成功、own subagent、恶意证据、后置 assemble、错误 live owner、无关会话正常；确认 adapter 0 调用断言确实红。
- [x] 4.2 实现最小 native judge preset 的真实 setup mount；创建窗口登记精确对象、child scoped execution guard；Host/root llm/stream 检查实际冻结请求、sessionId、agents.get 精确对象与 isOwnedBy，route/schema/消息来源均绑定冻结协议。
- [x] 4.3 重构；真实依赖集成全绿。若需要缺失的 core 接口或 gate 时序不可成立，停止并回到设计评审，不替换成只测传参的 mock。

## 5. 顶层执行、固定标题与递归审计

- [x] 5.1 写失败测试 EVAL-014–018：默认 AUTO 关闭并回读、主代递归配置与成本、seed 去重、默认标题 provider 共装零辅助请求、rename 失败不发题。
- [x] 5.2 实现普通顶层执行、首 prompt 前 user-pinned 固定非题面标题、MANUAL 与逐请求核验、递归事件/写入/成本归属；保持事后外发审计限制的披露。
- [x] 5.3 重构；运行标题/runtime/lineage 集成与现有 lifecycle 回归，日常标题仍正常。

## 6. 全文证据、评分与写回

- [x] 6.1 写失败测试 EVAL-035–042：多帧完整结果/缺帧、空白引文、实际消费覆盖、Act 分支与端到端分母、no/unknown 优先级、写回独立分母、成功写入的因果顺序。
- [x] 6.2 实现完整日志解析及递归身份去重、冻结选段协议、引文来源检查、分支聚合和成功写入时序分类；不从引文存在推断语义正确，不外发 reasoning。
- [x] 6.3 重构；运行证据/评分/写回及现有 weekly-insights 多帧/seed 回归。

## 7. 预算、续跑与 CLI

- [x] 7.1 写失败测试 EVAL-001–004、043–044：六条件确认/拒绝任意 suite/取消零会话、已知越界污染、配对裁判预算、活资源拒绝续跑；额外测 forced-failed 孤儿 job 与 interrupt accepted 但队列未清退。
- [x] 7.2 实现 selftest CLI、冻结计划预算、软上限监测、保守续跑及资源核验；所有不确定清退停止自动化，给 raw 身份和待处理说明，未知提交不自动重发。
- [x] 7.3 重构；运行 CLI/plan/lifecycle 全套及 package typecheck。

## 8. 报告与消费端过滤

- [x] 8.1 写失败测试 EVAL-045–048、051–056：确定性报告/全部 unknown 非零、同结果控制保留、三消费端过滤、坏登记后备、只读与旧归属契约。
- [x] 8.2 实现离线 Markdown 自检报告、实际覆盖与限制说明、原始 token 分类和默认值待确认；接线 recall-report、report.sh、weekly-insights 的归根/cache 前过滤，复用哈希。
- [x] 8.3 重构；运行 package recall/telemetry 回归与仓库 weekly-insights 测试，确认无网络/业务日志读取。

## 9. 文档、受管配置和发布接线

> 9.3 未勾：仓库级“每个 markdown 链接指向已跟踪路径”检查要求新增的 skills/memex-eval 与 presets/memex-eval-judge 已被 git 跟踪；用户未要求提交，故未 git add。已用 intent-to-add 临时验证该失败仅因未跟踪（随即撤销）。提交后复跑即可勾选。selftest CLI 尚无 bin 与真实 Host 传输（属 3.2 managed runner 接线）。

- [x] 9.1 写失败测试 EVAL-049–050 及打包/配置检查：长期原则未删且去向如实、CLI 可执行与固定数据随包、judge preset/目录声明及 skill 的 managed wiring。
- [x] 9.2 接入 bin、fixture 发布资源、所需精确兼容依赖、judge preset 和 memex-eval skill；仅修改 manifest 真相源，保留未迁移方法论，补自检用途/风险/手动恢复说明。
- [ ] 9.3 重构；运行类型、构建、打包资源检查、方法论与 managed-assets 回归。不得在此任务顺带部署或重启日常 GUI。

## 10. 验证与交付（需单独 live/部署授权）

- [ ] 10.1 核验 61 个场景测试均已映射且通过，补充测试不能替代映射测试；执行 package test/typecheck/build、相关仓库测试、严格 OpenSpec 校验及 diff 检查，保存轻量真实日志摘要。
- [ ] 10.2 如用户授权部署，从主 checkout 按受管 build 流程物化并连续第二次验证幂等；由用户决定重启日常 Host，不启动替代服务器冒充当前 GUI。
- [ ] 10.3 如用户明确授权真实模型运行，展示六条件及裁判预算/默认值副作用后执行固定自检；验收裁判工具面/标题零调用/实际模型/资源清退/流量排除，逐项给证据。未经授权不运行，不将 mock 测试称 live 通过。
- [ ] 10.4 实施完成后按 anvil 生成 verify.md；未获 live 授权或任一验收未完成则明确列未验，不归档冒充完成。后续业务评估、校准、统计与 B051 继续保留，不标为本次实现完成。
