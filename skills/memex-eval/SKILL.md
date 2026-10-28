---
name: memex-eval
description: 运行或读取 dsh-memex 固定虚构自检：检查评估链路（召回、回答、写回、裁判、资源清退）在受控输入下能否跑通并如实记录。用户说「跑一下 memex 自检」「memex eval selftest」「看自检报告」时使用。这是工具自检，不能用于有效性评估。
whenToUse: 用户想确认 memex 评估链路是否可用，或读取已有自检报告时。不用于回答「memex 有没有用」——那需要另行设计的业务评估，见方法论文档。
---

# memex 固定虚构自检

## 这是什么，不是什么

- 是**固定虚构自检**：内置三道虚构题（Know / 过期知识 Act / 写回），每题跑有记忆、无记忆两个条件，共六个条件。
- **不能用于有效性评估**：裁判未校准，题目固定且不轮换，结果不代表 Memex 效果，不计算收益、区间或显著性。
- 不接受自定义题目、仓库、记忆库或 suite 路径；`--suite` 等参数会被直接拒绝。
- 方法论原则的去向见 `packages/dsh-memex/docs/evaluation-methodology-mapping.md`。

## 运行自检（需要用户明确同意）

运行会创建 6 个普通会话和 1 个裁判父会话，并**调用真实模型**。必须先把以下副作用讲给用户，得到明确同意才运行，不要自行启动：

- 最多 12 次裁判请求；被测会话自发创建的后代数量与成本无法预先限定。
- 被测普通会话不是安全沙箱，可读宿主上的真实文件；越界访问与请求路线只做**事后**审计，发现即判为环境污染并停止，已发出的请求无法追回。
- 选择模型会异步改变全局默认模型；工具**不会自动恢复**，只保存原值并持续提醒，请用户自己在日常模型选择里检查并恢复。
- 测试根会话只归档并静止，不销毁；资源释放无法证明时整轮停止并保留现场，需要人工检查。

确认授权且完成部署后，在用户自己的交互终端运行（不要把认证 URL 发进会话或命令行）：

```bash
dsh-memex-eval-selftest --tested <provider/model[@effort]> --judge <provider/model[@effort]>
```

命令先展示六条件预算和风险，须输入 `RUN FIXED SELFTEST`；之后提示隐藏粘贴官方 Host 启动 URL，经原有根页面认证换取仅保存在内存的 cookie。只接受 loopback、原 authority；不扫描日志、不读取浏览器 cookie、不持久化凭据、不另开服务器。`--help` 不认证也不创建轮次。无 TTY 时拒绝认证，不用 argv/env 绕过。模型失败、断连或提交不确定均不自动重试；保留输出的 round/request 身份，检查私有账本后再决定处理。

普通执行每条件软监测 128 次根/后代模型请求与 120 秒墙钟，观察超限取消；不是精确截止或成本硬屏障。所有语义 unknown/缺证时 selftest 非零，行为 fail 但证据收齐可以返回 0。

显式安全续跑：`dsh-memex-eval-selftest --resume <round-uuid>`，输入 `RESUME FIXED SELFTEST`。只在同一 dispatcher 连续持有原资源句柄、旧普通 attempt 已完整退休、没有未知 prompt 提交且未开始评分时可创建新 attempt；完成结果和历史目录保留。已开始/失败/unknown 裁判不重试，跨 Host、取消或活资源都拒绝。状态中的旧 unhealthy/uncertainRequest 是原请求历史，不会删除或改写；新续跑 request 的 durable result 独立保存。先确认默认模型标记后不可再续跑；需结束全部执行后才人工确认。

只查 Host 状态：`dsh-memex-eval-selftest --status <round-uuid>`。手动在日常 GUI 检查并按需恢复默认模型后，用 `dsh-memex-eval-selftest --confirm-default-review <round-uuid>`，输入 `I REVIEWED THE DEFAULT MODEL` 记录确认；只写本轮确认标记，绝不写模型默认值。旧轮次 pending 会阻止新注册并列出原值/当前值提示。资源释放未知仍需人工处理，确认默认值不等于释放资源。

`evalSelftest:true` 由受管 patch 配置，仅将运行根 fallback 关闭、nomem/judge memory 关闭声明并入实际 resolver，不覆盖用户声明；预检仍核对实际 Host 路由。缺 controller、AUTO routing 或支持的 persistence 服务时失败关闭。

## 读取报告（只读，可直接运行）

```bash
dsh-memex-eval-report --root ~/.dsh-memex-eval/selftest --round <round-uuid>
```

- 只读：不连接 Host、不调用模型、不写文件。
- 退出码：`0` 全部判据收齐；`1` 有 unknown、缺证、配置不符或环境污染；`2` 参数或证据文件错误。
- 找不到命令说明本机还没部署 dsh-memex，请用户先 `dsh build`，不要自己拼路径。

## 解读纪律

1. `unknown`、缺证、配置不符都**不是通过**，也不能当作失败去推断行为。
2. 「配对观察」只描述本次结果是否相同，不是改善或收益。
3. 引文逐字匹配只证明出处存在，不证明语义支持。
4. 报告列出的「默认模型待确认」需要用户手动核对；离线报告读不到当前默认值。
