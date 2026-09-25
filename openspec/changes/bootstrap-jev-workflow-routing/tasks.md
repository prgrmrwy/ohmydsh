## 1. 冻结社区资源与宿主接缝

- [x] 1.1 审查并精确 pin `@jkudish/jev-mcp@0.6.0`、`spec-superflow@2.0.1` 与 Anvil 上游 commit，记录 license、npm integrity/源码哈希、Node 要求、网络面、凭据面、维护活跃度、升级复核点和移除路径
- [x] 1.2 在固定 DSH 0.1.5 runtime 中核实普通 Agent 的 MCP/外部工具真实装配接缝：进程由谁启动、工具注册到哪个 scope、取消/dispose 如何传播、环境如何 allowlist；以真实 `ctx.tools.schemas()` tool surface、typed mock 调用与 dispose 后注销证明生效，普通 Agent request header 在部署后由 6.1 继续验收
- [x] 1.3 核实 OpenSpec 项目级 schema 的原样安装与按 change `--schema anvil` 选择路径，以及 spec-superflow 在 DSH 中的原生 skill/CLI 安装路径；明确两者与现有 Worktree Session、OpenSpec archive、受控合入的职责边界
- [x] 1.4 DSH 已确认存在可靠通用 MCP 接缝，因此不复制 Jev 业务逻辑；同时记录其 ambient-env 限制，并固定后续只增加负责最小子进程环境与信号转发的窄 launcher

## 2. 可复现分发与可逆安装

- [x] 2.1 扩展 manifest/sync 数据模型以声明第三方 Jev MCP、OpenSpec schema 与独立 workflow 资源的精确来源、启用状态和部署目标；非法/浮动来源在任何物化前失败
- [x] 2.2 原样物化 Anvil 到 OpenSpec 官方 user schema 目录（默认 `~/.local/share/openspec/schemas/anvil`），由 ohmydsh 管理、供 checkout/worktree 共享；增加与 pinned 上游内容的漂移校验并运行 `openspec schema validate anvil`；保持 `openspec/config.yaml` 默认 `spec-driven` 不变
- [x] 2.3 按上游原生分发形态物化 spec-superflow 及其 skills/CLI，验证版本与入口可发现；仅挂载完整上游 skills 目录，不安装 hooks/phase guard，也不自动调用 `ssf isolate/finish`
- [x] 2.4 物化 Jev MCP 与最窄 launcher，确保包版本/integrity 可核对、启停可逆、连续 sync 幂等，且 disabled/缺凭据时 bridge 动态禁用、普通 Agent 保持 fail open
- [x] 2.5 补 sync/manifest/漂移/禁用/幂等测试，覆盖三类资源的验证、健康检查、回滚、来源身份与安全重试；真实连续 sync 已验证第三次无变化

## 3. 凭据、网络与失败边界

- [x] 3.1 为 Jev 子进程建立单变量 `TYPESAFE_API_KEY` 凭据注入路径：生成配置只动态读取本机进程环境，最窄 launcher 给实际 Jev 子进程仅传 `TYPESAFE_API_KEY` 与固定 `JEV_PROVIDER=typesafe`；值不进入仓库、命令参数或部署账本
- [x] 3.2 bridge 配置有界 tool-call timeout/reconnect，真实 MCP seam 已验证 AbortSignal 与 dispose 生命周期；shadow policy 对歧义失败不重试并将缺 key、401/403、429、5xx、网络、超时、取消、malformed response 规范化为有限枚举，任何错误都强制 `needs-review`，原始错误不进入记录
- [x] 3.3 单测验证 launcher 不展开完整父环境或项目 `.env`、只传 key 与固定 provider；bridge 在缺凭据时动态 disabled，启动错误 fail open，shadow recorder 仅接受有限错误枚举且不持久化 provider 原始错误
- [ ] 3.4 用户在本机安全配置已有 TypeSafe key 后执行一次 live Jev typed-decision probe，记录版本、候选、结构校验、延迟、usage 与脱敏结果；不把 key 或请求全文写进证据

## 4. Shadow workflow router

- [x] 4.1 新增普通 DSH skill `jev-workflow-router`，只在 Agent 已到达“是否进入 change / 选择流程”的决策点时使用；定义 `direct`、`standard-openspec`、`anvil`、`spec-superflow` 的稳定描述与版本化候选清单
- [x] 4.2 实现调用前确定性规则：用户显式选择优先、已有 change 沿用、非实施请求不强迫建 change、未健康候选移除、现有安全/Worktree/合入规则不可降级
- [x] 4.3 实现两步 shadow 判断：先判 direct 与正式流程，再在 standard/anvil/spec-superflow 间调用 Jev；保留 escape hatch、完整概率、置信度、winner margin 与 requirement checks
- [x] 4.4 实现调用后策略：未知/缺失/低置信度/低 margin/escape/故障统一 `needs-review`，本期禁止自动创建 change、选择 schema、调用 `ssf`、开始 apply 或向用户制造必须响应的中断
- [x] 4.5 用表驱动中英文 fixture 覆盖解释/调研、小修、普通 feature、多模块 planned、安全/迁移/持久化/并发、已有 change、显式选路、候选不可用、Worktree Session 不兼容和冲突门禁；断言 shadow/反事实推荐均不改变由既有权威确定的实际控制流

## 5. 本地评估记录与隐私

- [x] 5.1 定义版本化 shadow record，只保存匿名 id、裁剪特征、候选版本、推荐分布、置信度/margin、状态、延迟/usage、规范化错误与实际 route/覆盖来源；禁止全文、附件、diff、源码正文和原始 provider 错误
- [x] 5.2 将记录放入 `$DSH_HOME` 的受管本地状态目录，不进 Git、不注入会话上下文；实现并发安全追加、大小/条数上限、禁用停止写入、脱敏汇总导出和显式清理
- [x] 5.3 实现实际 route 的事后关联：用户显式选择、现有 Agent 最终路径或 existing-change 作为标签；无法可靠关联时保持 unknown，不猜测
- [x] 5.4 测试恶意/超长文本、路径、URL、邮箱、token-like 串、附件元数据和 provider 错误不会进入持久记录；损坏记录不阻止普通对话

## 6. 真实集成验收与分期门槛

- [ ] 6.1 已用当前普通 Agent 的真实 v3 request context 验证：缺 key 时 16 个 request header 均无 Jev tools 且原 40-tool surface 不变；修复生成 row 必须使用 `insert` 后，真实 skill-catalog 出现 router 与全部 9 个 spec-superflow skills；当前 existing change + prepared Worktree Session 全程未重路由/建第二 worktree/合入/归档。仍需安全配置 replacement key 并重启后验证 Jev tool 可见且 live typed 调用成功
- [x] 6.2 验证三条候选入口：临时 standard change 为 `spec-driven` 且项目默认不变；临时 Anvil change 显式解析为 pinned project schema；spec-superflow 精确包的 CLI 入口与九个原始 skill 均可发现/加载，但在当前 Worktree Session 中按确定性安全规则不执行 `isolate/finish`
- [ ] 6.3 已完成 16-case 人工标注中英文 synthetic fixture，并实现/验证只输出 aggregate 的版本化 report（完整混淆矩阵、加权成本、needs-review/失败率、p50/p95、usage、覆盖告警；无定价时成本明确 unavailable）；当前真实 prospective router records 为 0，禁止读取历史 prompt 回填，仍需在 live Jev 接通后积累若干真实 vibe shadow 样本
- [x] 6.4 在文档中固定 Phase 2 准入：样本量与关键类别覆盖达标、无高代价漏判、服务失败不影响对话、隐私审计通过且用户显式批准；本 change 不实现 advisory UI 或自动选路
- [x] 6.5 演练关闭与回滚：临时从 manifest 禁用 router/Jev/Anvil/spec-superflow 并连续 sync 两次，确认受管 schema/launcher/package/patch/skill 均撤销、标准 OpenSpec 可新建、existing change 可读且运行 Host 不受影响；隔离 shadow clear 成功；恢复原 manifest 后连续 sync 再次幂等。未触发任何 Worktree Session 生命周期动作
- [x] 6.6 运行相关聚焦测试、根 `npm test`（178 total / 176 pass / 2 profile-dependency skips / 0 fail）、`npm run check:artifacts`、两次 `node scripts/sync.mjs`（均 no changes）、本 change strict validate 与 `git diff --check` 并记录结果；全仓 strict validate 的唯一失败为无关既存 change `pet-locus-independent-agent-inquiries`，已明确分开报告
