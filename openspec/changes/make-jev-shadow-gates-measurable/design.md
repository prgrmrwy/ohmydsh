## Context

见 `proposal.md`。当前 schema v1 只记录有界任务特征、推荐、usage 和整数 `latencyMs`；`0` 同时承担“未测量”占位。报告无法区分真实样本与 synthetic fixture，并且没有稳定 latency 覆盖。因此门禁虽保守，却不能随真实使用收敛。

约束：记录仍位于本机受管状态目录；不能读历史 prompt 回填；不能增加自由文本或把 provenance 发送给 Jev；不记录或推断语言；Phase 1 必须继续零执行权威；旧记录不能因 schema 升级被丢弃或错误补值。

## Goals / Non-Goals

**Goals:**

- 让每个 Phase 2 强制数据维度具有有界、可测试的采集路径。
- 兼容读取 schema v1，并在报告中明确区分 legacy unknown 与新记录的已知值。
- 让准入结论由逐项 gate status 机械导出，缺失证据永远不通过。
- 保持 records 的隐私、大小、权限、并发写和清理不变量。

**Non-Goals:**

- 不启用 advisory UI 或自动路由。
- 不修改候选集、阈值、成本矩阵或 Jev prompt 内容。
- 不读取历史会话或迁移旧记录中的未知事实。
- 不加入外部定价服务；external cost 仍可 unavailable，并需要用户接受后续报告。

## Decisions

### D1. 新写 schema v2，兼容读取 v1，不原地迁移

新记录使用 `schemaVersion: 2`；reader 接受 v1/v2，将 v1 缺失字段投影为 `unknown`/`unavailable`。文件名可继续沿用既有受管路径，以避免双文件锁与 retention 语义；下一次原子写会序列化兼容后的记录，但不得把 legacy unknown 冒充为实测值。

替代方案是批量读取 session history 回填，被隐私规则禁止；另起文件则会让标签、retention 和报告跨文件复杂化，收益不足。

### D2. provenance 是本地记录元数据，不是 Jev feature

`sampleProvenance` 为 `real-vibe|synthetic-fixture|unknown`，普通 Agent 真实决策点固定 real-vibe，测试 fixture 必须显式 synthetic-fixture。它写入 recorder，但不进入 classify/decide context。

语言类别不采集、不推断、不报告，也不设中英文配额。自由文本、locale、session id 和 prompt hash 均不记录。

### D3. latency 使用显式 availability

记录结构使用 `{ availability: measured|unavailable, milliseconds: number|null }`。调用点以单调时钟包围本次完整 shadow sequence；只有真正测到且大于等于零时才标 measured。provider 未返回 latency 不是问题，因为本地 wall duration 可测；离线 fixture 可显式提供 measured 值。legacy `latencyMs > 0` 可兼容为 measured，`0` 保守为 unavailable。

替代方案继续用 magic zero 会混淆真实极快调用与缺失值，也无法计算覆盖率。

### D4. report 单独报告 real-vibe eligibility 和 gate statuses

总体诊断可包含所有 records，但 Phase 2 dataset/quality 分母只使用 `sampleProvenance=real-vibe` 且可靠标注的合格记录；synthetic 只证明实现，不贡献真实覆盖。provenance、route、高代价类别、版本、candidate availability 都生成 breakdown；不生成语言 breakdown。每个 gate 输出 `pass|fail|unavailable`，整体只有全部 pass 时才可成为 `eligible-for-user-approval`；由于本 change 不承载用户的 Phase 2 批准，运行时仍不改变模式。

### D5. 价格接受保持显式外部输入边界

现阶段没有可信价格模型，报告继续标记 external cost unavailable。未来可由单独 change 提供版本化价格输入或由用户审阅 usage 后明确接受。此次不伪造价格，也不删除该门槛。

## Risks / Trade-offs

- **[Agent 忘记填新字段]** → recorder 默认 unknown/unavailable，report fail closed；skill 示例和测试要求普通调用提供字段。
- **[schema v1/v2 同文件重写]** → 保留版本字段与兼容测试，未知事实不提升为已知。
- **[wall latency 包含 Agent/tool transport 开销]** → 这正是用户感知的 shadow call 成本；固定定义为完整 shadow sequence，并在报告中声明口径。
- **[所有数据门槛通过但价格仍 unavailable]** → 继续不准入，直到后续报告由用户明确接受。

## Migration Plan

1. 先添加 v1/v2 正反兼容、隐私和 gate tests。
2. 升级 recorder schema、normalizer、aggregate report 和 skill 说明。
3. 用临时 `$DSH_HOME` 验证 v1 读取、新 v2 写入、混合 retention/label/report。
4. 运行 focused/full tests、strict OpenSpec validation 和两次 sync 幂等检查。
5. 部署后新样本开始贡献可测维度；旧样本继续显示 unknown/unavailable。
6. 回滚代码不会删除记录；v2 对旧 reader 不可读，因此回滚前保留文件，或清理 shadow state 后重新开始。Phase 1 行为不受影响。
