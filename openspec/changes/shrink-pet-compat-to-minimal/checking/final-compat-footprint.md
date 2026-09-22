# 最终 compat 规模对比

## 结果

| 指标 | 基线 | 最终 | 变化 |
|---|---:|---:|---|
| 被替换的上游包 | **7** | **1** | −6 |
| patch 文件 | 2 | 1 | −1 |
| hunks | **72** | **32** | −40 |
| 上游源文件 | 29 | 9 | −20 |
| 生成物磁盘 | **3.9 GB** | **2.2 GB** | −1.7 GB |
| 上游克隆 | 2 份 | 1 份 | −1 |
| overlay 投影通道 | 2 条（独立腐烂） | 1 条 | −1 |
| 能力 marker | 5 | 4 | −1 |

唯一剩余的被替换包：`@deepseek-ai/dsh-subagent`。

## 各批次贡献

| 批次 | 动作 | 包数 | hunks |
|---|---|---:|---:|
| 起点 | — | 7 | 72 |
| **批 A** | 移除 `isolateQueuedTurnClaim`（`core/agent`、`core/agent-loop` 回官方） | 5 | 64 |
| **批 B** | storage 改注册自有 backend（4 个 storage 包回官方，`compatDependencies` 退役） | **1** | **32** |
| 批 C | **核验不成立，不执行** | 1 | 32 |

## 保留的 4 个 seam

全部位于 `@deepseek-ai/dsh-subagent`：

| seam | 官方为何表达不了 |
|---|---|
| `settlementNotice: 'silent'` | 唯一抑制开关 `announced` 的语义是「该子代从未真正存在」；父非 idle 时官方走 `steer`，会插入父正在进行的轮次 |
| `createIdleContinuable` | `SubagentStartRequest.prompt` 必填，而 locus 创建是两阶段的，中间那段 child 必须存在但不能开工 |
| `contextMode:'independent-v1'`（含 durable `toolFilter`） | `composeFrom` 绑定父的 standing mount 实例；冷恢复需要子代**独立 mount** 自己的 preset 并核验 header |
| `withLiveContinuableChildSession` | 官方泛化 Session 路由**有意**不解析 continuation-owned child |

`toolFilter` 本身官方已支持，但与 `independent-v1` 共用 descriptor v5，无法单独摘除。

## 磁盘清理

删除已无引用的生成物（`build-storage.mjs` 已随批 B 移除，无任何构建器再引用它们）：

- `.storage-upstream/` —— 第二份上游克隆，1.7 GB
- `.storage-artifact-builds/` 与 `storage-artifacts` 符号链接

`.gitignore` 条目**保留**并注明原因：旧构建残留的目录不得被误提交。

清理后重建 launcher 成功（fingerprint `73ed72bf…`），`pet-locus-runtime-override` 7/7 通过。

## 仍然保留的机制

`hostRuntimeCompatibility` **保留**，因为仍有一个上游包需改实现。其不变量未放宽：

- 长期 `dsh web` Host 专用；build / plugin / dump-config 继续用官方精确 `dshVersion`
- `supportedDshVersion` 必须与 `dshVersion` 精确相等，不等即 fail closed
- 唯一依赖实例、package identity/provenance、能力 marker 全部校验后才发布
- 任一步失败不删除既有 `.launcher`，本次启动 fail closed，不静默回退官方 runtime

## 每次 DSH 版本跳变的成本变化

| | 基线 | 最终 |
|---|---|---|
| 需重新推导的 patch | 2 个 / 72 hunks / 29 文件 / 7 包 | 1 个 / 32 hunks / 9 文件 / 1 包 |
| 需重建的产物 | subagent + agent 对 + 4 storage + launcher | subagent + launcher |
| 需重跑的探针 | ~20 | 减去 storage 与 isolated-claim 两组 |
| 独立腐烂的投影通道 | 2 | 1 |

## 回归

| 项 | 结果 |
|---|---|
| 根测试 | **141 pass / 0 fail**（基线 134） |
| Pet 测试 | **2726 passed / 43 skipped**（基线 2696 / 43） |
| `check:artifacts` | 合规 |
| Pet build / typecheck | 通过 |
| `sync` 连续两次 | `no changes — deployment already matches manifest` |
