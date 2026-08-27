# 归档说明：已探索但不采用

- **归档日期**: 2026-08-27
- **归档时任务状态**: 77/82
- **归档原因**: 架构路线变更，**非实施失败、非放弃**
- **决策记录**: `docs/adr/ADR-0003-adopt-cockpit-over-semantic-federation.md`
- **后继项目**: 独立项目 `dsh-cockpit`（含其自身 OpenSpec）

## 为什么以 77/82 归档

剩余 5 项全部依赖真实部署或消耗模型订阅，而非实现缺失：

- `9.3` 多客户端并发（需真实 model turn）
- `10.2` 真实 prompt/stream/tool/approval/model switch（消耗 VM 自有 Claude 订阅）
- `10.6` 切 `enabled:true` 后的真实部署（幂等已在 `enabled:false` 下验证）
- `10.7` 重启现有 Host 并刷新 `http://127.0.0.1:3080`
- `10.8` 最终验收报告（依赖上述结果）

本 change **从未部署到真实 `~/.dsh`**：`dsh.yaml` 中 `dsh-federation` 全程
`enabled: false`。因此归档时使用 `--skip-specs`，其 delta specs **未**提升为
current specs——一个未采用且未部署的路线不应污染 `openspec/specs/`。

## 这份归档的价值

它是一份**完整的可行性证据**，不是废弃代码：

1. 语义联合 Host 路径**技术上可行**，77 项任务含真实 OpenSSH 隧道、真实 rc.2
   双流、真实远端重启重连、浏览器 envelope 驱动的远端 session reorder 等实测。
2. 记录了 10 个经独立只读评估以反例证伪后修复的真实缺陷（见 commit
   `5060459` 与 `checking/` 下报告），其中安全与清理类修复已作为资产迁移。
3. 记录了该路径的**真实成本结构**——两个钉死上游 commit 的 compatibility
   patch，以及“中央一旦要操作远端就必须自行承担联合 ID／命令路由／写 ledger／
   generation 对账”这一连锁。这是 ADR-0003 决策的直接依据。

## 若未来重新考虑“一棵树”

前提是明确需要**多机器同时展开**及其衍生的跨机并排对照——这是本路径唯一换到
而驾驶舱换不到的收益。届时应重读：

- `design.md` 第 3 节「语义联合 Host，而不是多 Client Runtime 或 iframe」及其
  Alternatives（当时已评估 iframe 与单 Runtime 切换，并记录了否决理由）
- `design.md` 第 9 节（Workspace Embed 复用官方子树的取舍）
- ADR-0003 的实测证据表，特别是 **rc.2 单消费者语义不抢占服务端事件流**这一
  已证伪结论——它是驾驶舱路径成立的关键，也修正了本 change 设计期的一个假设

## 资产迁移

已加固并迁往 `dsh-cockpit` 复用的模块，清单见 ADR-0003「资产处置」一节。
未迁移部分随本归档保留为历史证据，不再维护。
